/**
 * Error sanitizer — the allowlist between a raw error and the wire.
 *
 * Nothing an error carries is trusted: `message` and `cause` routinely hold
 * tokens, SQL or payload fragments; `name` and function names can be built at
 * runtime; the first line(s) of `stack` repeat the message; frame filenames
 * can be tenant URLs or carry query strings and ids. Shape checks cannot tell
 * `CustomerAcmeError` from `TypeError`, so the output is allowlist-only:
 *
 * - the type is a built-in error name or one the app registered, else `Error`;
 * - frames keep line and column; a filename is kept only for a build artifact
 *   the bundler registered with a debug id, or a file the app listed exactly,
 *   rewritten to `app:///` so no host or tenant URL leaves the process;
 * - function names are never sent — symbolication restores them from the
 *   uploaded source maps, matched by debug id;
 * - the same for up to {@link MAX_CAUSES} causes.
 *
 * Messages are never sent.
 *
 * By default, server values are examined only after native brand checks
 * (`isNativeError` + `isProxy`); unverified values become `NonError`. Browser
 * values are not examined: objects become `Error`, primitives `NonError`.
 * Only OWN properties of verified errors are read, through descriptors.
 * A prototype's descriptors are read only when it is a built-in error
 * prototype, or, on the server, a custom prototype `isProxy` has cleared (to
 * confirm `name`/`message`/`code` are plain data before the runtime formats the
 * stack); a proxy prototype is never touched, and no prototype
 * accessor is called by those descriptor reads. With `formattedStacks`, the
 * browser's brand check may be a polyfill that runs getters. Stack access may
 * run the runtime's formatter, including any `Error.prepareStackTrace` hook
 * and whatever that calls.
 * The sanitizer itself never modifies globals and never calls
 * `toJSON`/`toString`.
 */

import type { StackFrame } from "@sentry/core";

export interface SanitizedException {
	type: string;
	frames: SanitizedFrame[];
	/**
	 * Sent location → the raw filenames it was rewritten from. Kept inside the
	 * process for debug-id lookup and to detect two files sharing a location.
	 */
	rawFilenames: Map<string, Set<string>>;
}

export type SanitizedFrame = Pick<
	StackFrame,
	"filename" | "abs_path" | "lineno" | "colno" | "in_app"
>;

export interface SanitizeOptions {
	/** Detects proxies without running traps (server: `node:util/types`). */
	isProxy?: (value: unknown) => boolean;
	/**
	 * Native error brand check that runs no traps (server: `isNativeError`).
	 * Without it the value is not inspected unless `formattedStacks` is set;
	 * then the runtime's `Error.isError`, captured at load, is used, and it
	 * may be a polyfill that runs getters.
	 */
	isNativeError?: (value: unknown) => boolean;
	/**
	 * Absolute path of the deployed app, used only to REWRITE a trusted file
	 * path to `app:///<relative path>`. It does not make a file trusted.
	 */
	filenameRoot?: string;
	/**
	 * Raw frame filenames the bundler registered with a debug id (the keys of
	 * Sentry's `getFilenameToDebugIdMap`). A registered file is a build
	 * artifact, so its location may be sent.
	 */
	registeredFiles?: { has(raw: string): boolean };
	/** Exact rewritten names (`app:///dist/worker.mjs`) the app vouches for. */
	trustedFiles?: ReadonlySet<string>;
	/**
	 * Read stacks the runtime formats lazily (V8, Gecko). Reading one runs the
	 * runtime's stack formatter, as `error.stack` does: Node's default, or any
	 * `Error.prepareStackTrace` installed in the error's realm, which may run
	 * arbitrary code. Without it a stack is read only when
	 * `inertStackDescriptors` holds and it is already plain data, and no code
	 * of the error or the runtime's formatting hooks runs.
	 */
	formattedStacks?: boolean;
	/**
	 * Set by the entry point from trusted runtime metadata: true where reading
	 * an error's `stack` DESCRIPTOR formats nothing (Node 22+, browsers with
	 * native `Error.isError`). Elsewhere (Node 20, Bun) the descriptor read
	 * itself formats the stack, so it is avoided unless `formattedStacks`.
	 */
	inertStackDescriptors?: boolean;
	/** Error class names the app vouches for, sent as the type as-is. */
	errorNames?: ReadonlySet<string>;
}

export const MAX_FRAMES = 50;
export const MAX_CAUSES = 3;
const MAX_STACK_LENGTH = 32_768;
const MAX_PROTOTYPE_DEPTH = 8;

/** Built-in and DOM-specified error names: fixed strings, never app data. */
export const BUILTIN_ERROR_NAMES: ReadonlySet<string> = new Set([
	"Error",
	"AggregateError",
	"EvalError",
	"InternalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
	"AbortError",
	"DataCloneError",
	"InvalidStateError",
	"NetworkError",
	"NotAllowedError",
	"NotFoundError",
	"NotSupportedError",
	"QuotaExceededError",
	"SecurityError",
	"TimeoutError",
]);
const FILENAME = /^[A-Za-z0-9_\-./@:~+%[\]]{1,512}$/;
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(?:(.*?)@)?(.+?):(\d+):(\d+)$/;
const URL_PREFIX = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** `Error.isError`: a brand check that is false for proxies and runs no traps. */
const NATIVE_IS_ERROR = (Error as { isError?: (value: unknown) => boolean })
	.isError;

/**
 * Gecko exposes `stack` as an accessor on `Error.prototype`; reading that
 * prototype's descriptor formats nothing on any engine. V8's own per-error
 * accessor is captured lazily (see `nativeOwnStackGetter`), because on some
 * engines merely reading an error's `stack` descriptor formats the stack.
 */
const NATIVE_PROTO_STACK_GETTER = Object.getOwnPropertyDescriptor(
	Error.prototype,
	"stack",
)?.get;

/** The realm's `Object.prototype`: never a proxy; its descriptors are only read. */
const OBJECT_PROTOTYPE: object = Object.prototype;

let nativeOwnStackGetterCache: (() => unknown) | null | undefined;

/**
 * V8's native `stack` accessor (Node 22+, Chromium), read from a fresh error.
 * Called only where `inertStackDescriptors` holds, so the read formats
 * nothing.
 */
function nativeOwnStackGetter(): (() => unknown) | undefined {
	if (nativeOwnStackGetterCache === undefined) {
		nativeOwnStackGetterCache =
			ownDescriptor(new Error("probe"), "stack")?.get ?? null;
	}
	return nativeOwnStackGetterCache ?? undefined;
}

/** `DOMException.prototype.name` is a native WebIDL getter, not a data property. */
const NATIVE_DOM_EXCEPTION_NAME_GETTER =
	typeof DOMException === "function"
		? Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
		: undefined;

/** Prototypes whose properties are the runtime's, never the app's. */
const BUILTIN_PROTOTYPES: ReadonlySet<object> = new Set(
	[
		Error,
		AggregateError,
		EvalError,
		RangeError,
		ReferenceError,
		SyntaxError,
		TypeError,
		URIError,
		typeof DOMException === "function" ? DOMException : undefined,
	]
		.filter((ctor) => typeof ctor === "function")
		.map((ctor) => (ctor as { prototype: object }).prototype),
);

export function sanitizeError(
	error: unknown,
	options: SanitizeOptions = {},
): SanitizedException[] {
	// Without a trusted brand check (the browser), even `Error.isError` may be a
	// polyfill that reads `Symbol.toStringTag` (core-js does, and disguises its
	// source as native code). So by default the value is not inspected at all;
	// `typeof` runs no code and only separates primitives from objects.
	if (!options.isNativeError && !options.formattedStacks) {
		return [
			{
				type:
					error !== null &&
					(typeof error === "object" || typeof error === "function")
						? "Error"
						: "NonError",
				frames: [],
				rawFilenames: new Map(),
			},
		];
	}
	const chain: SanitizedException[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (chain.length <= MAX_CAUSES && current !== undefined) {
		if (seen.has(current)) break;
		seen.add(current);
		const sanitized = sanitizeOne(current, options);
		chain.push(sanitized);
		if (!sanitized.frames.length && sanitized.type === "NonError") break;
		current = isErrorLike(current, options)
			? ownValue(current as object, "cause")
			: undefined;
	}
	return chain;
}

function sanitizeOne(
	error: unknown,
	options: SanitizeOptions,
): SanitizedException {
	if (!isErrorLike(error, options)) {
		return { type: "NonError", frames: [], rawFilenames: new Map() };
	}
	const name = readName(error as object);
	const stack = readStack(error as object, options);
	// The header to cut off is built from what the formatter itself read:
	// the name may live on a custom prototype (Node's own error classes).
	const header = (key: string, allowNumber = false) => {
		const resolved = plainData(error as object, key, options, allowNumber);
		return resolved.value === undefined ? undefined : String(resolved.value);
	};
	const type =
		typeof name === "string" &&
		(BUILTIN_ERROR_NAMES.has(name) || options.errorNames?.has(name))
			? name
			: "Error";

	const frames: SanitizedFrame[] = [];
	const rawFilenames = new Map<string, Set<string>>();
	if (typeof stack === "string") {
		for (const raw of parseFrames(
			stack,
			header("name") ?? "",
			header("message") ?? "",
			header("code", true),
		)) {
			const frame = sanitizeFrame(raw, options);
			if (frame.filename && raw.filename) {
				const raws = rawFilenames.get(frame.filename) ?? new Set<string>();
				raws.add(raw.filename);
				rawFilenames.set(frame.filename, raws);
			}
			frames.push(frame);
		}
	}
	// Stack strings list the newest frame first; Sentry wants oldest first.
	frames.reverse();
	return { type, frames, rawFilenames };
}

function isErrorLike(value: unknown, options: SanitizeOptions): boolean {
	if (value === null || typeof value !== "object") return false;
	const isNativeError = options.isNativeError ?? NATIVE_IS_ERROR;
	if (!isNativeError) return false;
	try {
		if (options.isProxy?.(value)) return false;
		return isNativeError(value);
	} catch {
		return false;
	}
}

function ownDescriptor(
	target: object,
	key: string,
): PropertyDescriptor | undefined {
	try {
		return Object.getOwnPropertyDescriptor(target, key);
	} catch {
		return undefined;
	}
}

/** An own DATA property. Accessors are not called. */
function ownValue(target: object, key: string): unknown {
	const descriptor = ownDescriptor(target, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/**
 * The built-in prototype directly behind `target`, or undefined for a custom
 * class prototype — which may be a proxy or carry getters, and is not read.
 */
function builtinPrototype(target: object): object | undefined {
	try {
		const prototype = Object.getPrototypeOf(target) as object | null;
		return prototype && BUILTIN_PROTOTYPES.has(prototype)
			? prototype
			: undefined;
	} catch {
		return undefined;
	}
}

function callNative(getter: () => unknown, target: object): unknown {
	try {
		return getter.call(target);
	} catch {
		return undefined;
	}
}

function readName(target: object): unknown {
	const own = ownDescriptor(target, "name");
	if (own) return "value" in own ? own.value : undefined;
	const prototype = builtinPrototype(target);
	const inherited = prototype && ownDescriptor(prototype, "name");
	if (!inherited) return undefined;
	if ("value" in inherited) return inherited.value;
	return inherited.get && inherited.get === NATIVE_DOM_EXCEPTION_NAME_GETTER
		? callNative(inherited.get, target)
		: undefined;
}

function readStack(target: object, options: SanitizeOptions): unknown {
	if (!options.inertStackDescriptors) {
		// Node 20 and Bun format the stack when its descriptor is merely read,
		// running any `Error.prepareStackTrace`. So nothing about `stack` is
		// touched by default, and with the opt-in only after the header fields
		// the formatter reads are known to be plain data.
		if (!options.formattedStacks || !headerFieldsArePlain(target, options)) {
			return undefined;
		}
		const own = ownDescriptor(target, "stack");
		return own && "value" in own ? own.value : undefined;
	}
	const own = ownDescriptor(target, "stack");
	if (own && "value" in own) return own.value;
	// A lazily formatted stack runs the runtime's formatter, including any
	// `Error.prepareStackTrace` of the realm the error came from, which cannot
	// be identified. Read only with the explicit opt-in.
	if (!options.formattedStacks || !headerFieldsArePlain(target, options)) {
		return undefined;
	}
	const getter = own
		? own.get === nativeOwnStackGetter()
			? own.get
			: undefined
		: // Gecko: the accessor lives on Error.prototype. Call the captured
			// native getter on the error rather than walking its prototype chain.
			NATIVE_PROTO_STACK_GETTER;
	return getter ? callNative(getter, target) : undefined;
}

/**
 * The formatter builds the header with ordinary property gets on the error,
 * which walk its prototype chain: V8 reads `name` and `message`, Node's
 * default formatter also `code` ("Name [CODE]: message"). Those must resolve to
 * plain data so no getter or proxy trap of the ERROR runs.
 */
function headerFieldsArePlain(
	target: object,
	options: SanitizeOptions,
): boolean {
	return (
		resolvesToPlainData(target, "name", options) &&
		resolvesToPlainData(target, "message", options) &&
		resolvesToPlainData(target, "code", options, true)
	);
}

/**
 * True when `target[key]` resolves to a string (or nothing; a number too with
 * `allowNumber`) through data properties only. With `isProxy` (server) the whole chain is checked link by
 * link; without it (browser) only the error itself and a built-in prototype
 * are trusted, since a custom prototype cannot be told apart from a proxy.
 */
function resolvesToPlainData(
	target: object,
	key: string,
	options: SanitizeOptions,
	allowNumber = false,
): boolean {
	return plainData(target, key, options, allowNumber).plain;
}

/** `resolvesToPlainData`, also returning the value it resolved to. */
function plainData(
	target: object,
	key: string,
	options: SanitizeOptions,
	allowNumber = false,
): { plain: boolean; value?: string | number } {
	const fromDescriptor = (descriptor: PropertyDescriptor) => {
		if (!("value" in descriptor)) return { plain: false };
		const value: unknown = descriptor.value;
		if (value === undefined) return { plain: true };
		if (
			typeof value === "string" ||
			(allowNumber && typeof value === "number")
		) {
			return { plain: true, value };
		}
		return { plain: false };
	};
	const own = ownDescriptor(target, key);
	if (own) return fromDescriptor(own);
	try {
		let current = Object.getPrototypeOf(target) as object | null;
		for (let depth = 0; current; depth++) {
			const trusted =
				BUILTIN_PROTOTYPES.has(current) ||
				current === OBJECT_PROTOTYPE ||
				(options.isProxy !== undefined && !options.isProxy(current));
			if (!trusted || depth >= MAX_PROTOTYPE_DEPTH) return { plain: false };
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (descriptor) return fromDescriptor(descriptor);
			current = Object.getPrototypeOf(current) as object | null;
		}
		return { plain: true };
	} catch {
		return { plain: false };
	}
}

interface RawFrame {
	function?: string;
	filename?: string;
	lineno: number;
	colno: number;
}

/**
 * Parse V8/JSC (`    at fn (file:1:2)`) and Gecko/WebKit (`fn@file:1:2`)
 * frames. A V8-style stack starts with `name: message`, and a message can
 * contain lines that look exactly like frames — so the header is cut off by
 * matching it against the message. If the stack does not start with the
 * header it should have, the message changed after capture and the lines
 * cannot be told apart: no frames are returned.
 */
export function parseFrames(
	stack: string,
	name = "",
	message = "",
	code?: string,
): RawFrame[] {
	let body = stack.slice(0, MAX_STACK_LENGTH);
	// Node formats its own errors as "Name [CODE]: message".
	const headers = [
		name && message ? `${name}: ${message}` : name || message,
		code !== undefined && name
			? message
				? `${name} [${code}]: ${message}`
				: `${name} [${code}]`
			: "",
	];
	// The header must end exactly at a line break (or the end): a stack
	// captured before the message changed would otherwise be cut mid-line and
	// leave the old message's frame-shaped lines behind as frames.
	const header = headers.find((candidate) => {
		const boundary = body.charAt(candidate.length);
		return (
			candidate !== "" &&
			body.startsWith(candidate) &&
			(boundary === "\n" || boundary === "")
		);
	});
	if (header !== undefined) {
		body = body.slice(header.length);
	} else {
		const firstLine = body.split("\n", 1)[0] ?? "";
		const looksLikeFrame =
			V8_FRAME.test(firstLine) || GECKO_FRAME.test(firstLine.trim());
		if (!looksLikeFrame) return [];
	}

	const frames: RawFrame[] = [];
	for (const line of body.split("\n")) {
		if (frames.length >= MAX_FRAMES) break;
		const trimmed = line.trim();
		if (!trimmed) continue;
		const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(trimmed);
		if (!match) continue;
		frames.push({
			function: match[1] || undefined,
			filename: match[2],
			lineno: Number(match[3]),
			colno: Number(match[4]),
		});
	}
	return frames;
}

function sanitizeFrame(
	raw: RawFrame,
	options: SanitizeOptions,
): SanitizedFrame {
	const frame: SanitizedFrame = {};
	const filename = raw.filename
		? sanitizeFilename(raw.filename, options)
		: undefined;
	if (filename) {
		frame.filename = filename;
		frame.abs_path = filename;
		frame.in_app = !/(\/node_modules\/|\/\.bun\/)/.test(filename);
	}
	if (Number.isSafeInteger(raw.lineno)) frame.lineno = raw.lineno;
	if (Number.isSafeInteger(raw.colno)) frame.colno = raw.colno;
	return frame;
}

/**
 * The location sent for a frame, or undefined to drop it.
 *
 * Dropped by default. A location is sent only when the raw filename was
 * registered by the bundler with a debug id, or its rewritten name is listed in
 * `trustedFiles`. A kept location is rewritten without host, credentials,
 * query or fragment:
 *
 * - `http(s)` URL → `app:///<path>`;
 * - file path or `file://` URL under `filenameRoot` → `app:///<relative path>`
 *   (a filesystem or drive root such as `/` or `C:\\` is not a root).
 *
 * A path with `.` or `..` segments, or one that cannot be rewritten (such as a
 * `node:` location), is dropped.
 */
export function sanitizeFilename(
	raw: string,
	options: Pick<
		SanitizeOptions,
		"filenameRoot" | "registeredFiles" | "trustedFiles"
	> = {},
): string | undefined {
	if (raw.length > 2048) return undefined;
	const rewritten = rewriteLocation(raw, options.filenameRoot);
	if (!rewritten) return undefined;
	const trusted =
		options.registeredFiles?.has(raw) === true ||
		options.trustedFiles?.has(rewritten) === true;
	return trusted ? rewritten : undefined;
}

function rewriteLocation(
	raw: string,
	filenameRoot: string | undefined,
): string | undefined {
	let path: string | undefined;
	const url = URL_PREFIX.exec(raw);
	if (url) {
		const scheme = url[1]!.toLowerCase();
		if (scheme === "file") {
			path = underRoot(safeDecode(url[3] ?? ""), filenameRoot);
		} else if (scheme === "http" || scheme === "https") {
			path = url[3] ?? "";
		}
	} else {
		path = underRoot(raw.replace(/[?#].*$/, ""), filenameRoot);
	}
	if (path === undefined) return undefined;
	const segments = path.split("/").filter(Boolean);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		return undefined;
	}
	const value = `app:///${segments.join("/")}`;
	return FILENAME.test(value) ? value : undefined;
}

function underRoot(path: string, root: string | undefined): string | undefined {
	if (!root) return undefined;
	const normalizedPath = path.replaceAll("\\", "/");
	const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
	// "/" and "C:\" normalize to "" and "C:": a root that admits everything.
	if (normalizedRoot === "" || /^[A-Za-z]:$/.test(normalizedRoot)) {
		return undefined;
	}
	if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return undefined;
	return normalizedPath.slice(normalizedRoot.length + 1);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
