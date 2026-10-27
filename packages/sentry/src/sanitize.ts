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
 * - frames keep line and column; a filename is kept only when it is a known
 *   build location (under the server app root, or a browser asset path), and
 *   is rebased to `app:///` so no host or tenant URL leaves the process;
 * - function names are never sent — symbolication restores them from the
 *   uploaded source maps, matched by debug id;
 * - the same for up to {@link MAX_CAUSES} causes.
 *
 * Messages are never sent.
 *
 * Inspection runs no user code. A value is examined only after a native brand
 * check that cannot be intercepted (`isNativeError` + `isProxy` on the server,
 * `Error.isError` in the browser); a proxy, or any runtime without such a
 * check, gets an opaque `Error` with no frames. Only OWN properties of the
 * value are read, through descriptors. Its prototype is looked at only when it
 * is one of the built-in error prototypes, so a proxy or getter-laden custom
 * prototype is never touched. Accessors are called only when they are the
 * runtime's own native getters captured at load. `toJSON`/`toString` are
 * never called.
 */

import type { StackFrame } from "@sentry/core";

export interface SanitizedException {
	type: string;
	frames: SanitizedFrame[];
	/** Raw frame filenames, only for debug-id lookup inside the process. */
	rawFilenames: Map<string, string>;
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
	 * Defaults to the runtime's `Error.isError`, captured at load.
	 */
	isNativeError?: (value: unknown) => boolean;
	/**
	 * Server: absolute path of the deployed app. File paths under it are sent
	 * as `app:///<relative path>`; any other path is dropped.
	 */
	filenameRoot?: string;
	/**
	 * Browser: URL path prefixes of the built assets (e.g. `/assets/`). Script
	 * URLs under one are sent as `app:///<path>` without host or query; any
	 * other URL — an inline script on `/invite/<token>`, a third-party script,
	 * a tenant domain — is dropped.
	 */
	assetPathPrefixes?: readonly string[];
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
const NODE_BUILTIN = /^node:[a-z_/]{1,128}$/;
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(?:(.*?)@)?(.+?):(\d+):(\d+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,}$/;
const EMAIL_LIKE = /^[^@]+@[^@]+\.[A-Za-z]{2,}$/;
const URL_PREFIX = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;
const DEFAULT_ASSET_PATH_PREFIXES = ["/assets/"];
const REDACTED = "[redacted]";

/** `Error.isError`: a brand check that is false for proxies and runs no traps. */
const NATIVE_IS_ERROR = (Error as { isError?: (value: unknown) => boolean })
	.isError;

/**
 * Native `stack` getters, captured at load before app code runs. V8 installs
 * `stack` as an own accessor on each error; Gecko exposes it as an accessor on
 * `Error.prototype`. JSC uses a plain data property.
 */
const NATIVE_OWN_STACK_GETTER = Object.getOwnPropertyDescriptor(
	new Error("probe"),
	"stack",
)?.get;
const NATIVE_PROTO_STACK_GETTER = Object.getOwnPropertyDescriptor(
	Error.prototype,
	"stack",
)?.get;

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
	const message = ownValue(error as object, "message");
	const stack = readStack(error as object, options);
	const type =
		typeof name === "string" &&
		(BUILTIN_ERROR_NAMES.has(name) || options.errorNames?.has(name))
			? name
			: "Error";

	const frames: SanitizedFrame[] = [];
	const rawFilenames = new Map<string, string>();
	if (typeof stack === "string") {
		for (const raw of parseFrames(
			stack,
			typeof name === "string" ? name : "",
			typeof message === "string" ? message : "",
		)) {
			const frame = sanitizeFrame(raw, options);
			if (frame.filename && raw.filename) {
				rawFilenames.set(frame.filename, raw.filename);
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
	const own = ownDescriptor(target, "stack");
	if (own && "value" in own) return own.value;
	const getter = own
		? own.get === NATIVE_OWN_STACK_GETTER
			? own.get
			: undefined
		: // Gecko: the accessor lives on Error.prototype. Call the captured
			// native getter on the error rather than walking its prototype chain.
			NATIVE_PROTO_STACK_GETTER;
	if (!getter) return undefined;
	// A native getter is not inert: V8 formats the "Name: message" header on
	// first access with ordinary property gets, which walk the prototype chain
	// and can reach a proxy trap or a user getter. Call it only when both
	// resolve to plain data without touching anything untrusted.
	if (
		!resolvesToPlainData(target, "name", options) ||
		!resolvesToPlainData(target, "message", options)
	) {
		return undefined;
	}
	return callNative(getter, target);
}

/**
 * True when `target[key]` resolves to a string (or nothing) through data
 * properties only. With `isProxy` (server) the whole chain is checked link by
 * link; without it (browser) only the error itself and a built-in prototype
 * are trusted, since a custom prototype cannot be told apart from a proxy.
 */
function resolvesToPlainData(
	target: object,
	key: string,
	options: SanitizeOptions,
): boolean {
	const isPlain = (descriptor: PropertyDescriptor) =>
		"value" in descriptor &&
		(typeof descriptor.value === "string" || descriptor.value === undefined);
	const own = ownDescriptor(target, key);
	if (own) return isPlain(own);
	try {
		let current = Object.getPrototypeOf(target) as object | null;
		for (let depth = 0; current; depth++) {
			const trusted =
				BUILTIN_PROTOTYPES.has(current) ||
				(options.isProxy !== undefined && !options.isProxy(current));
			if (!trusted || depth >= MAX_PROTOTYPE_DEPTH) return false;
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (descriptor) return isPlain(descriptor);
			current = Object.getPrototypeOf(current) as object | null;
		}
		return true;
	} catch {
		return false;
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
): RawFrame[] {
	let body = stack.slice(0, MAX_STACK_LENGTH);
	const header = name && message ? `${name}: ${message}` : name || message;
	if (header && body.startsWith(header)) {
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
		frame.in_app = !/(^node:|\/node_modules\/|\/\.bun\/)/.test(filename);
	}
	if (Number.isSafeInteger(raw.lineno)) frame.lineno = raw.lineno;
	if (Number.isSafeInteger(raw.colno)) frame.colno = raw.colno;
	return frame;
}

/**
 * Map a raw frame location to a known build location, or drop it.
 *
 * - `node:` builtins are kept.
 * - A file path (or `file://` URL) under `filenameRoot` becomes
 *   `app:///<relative path>`.
 * - An `http(s)` URL whose path starts with an asset prefix becomes
 *   `app:///<path>`: host, credentials, query and fragment are dropped.
 * - Everything else is dropped.
 *
 * Inside a kept path, segments after `/invite/`, UUIDs, e-mail addresses and
 * long token-like strings are additionally masked. That masking is defence in
 * depth for the app's own build layout, not the privacy boundary — the
 * allowlist above is.
 */
export function sanitizeFilename(
	raw: string,
	options: Pick<SanitizeOptions, "filenameRoot" | "assetPathPrefixes"> = {},
): string | undefined {
	if (raw.length > 2048) return undefined;
	if (NODE_BUILTIN.test(raw)) return raw;

	let path: string | undefined;
	const url = URL_PREFIX.exec(raw);
	if (url) {
		const scheme = url[1]!.toLowerCase();
		const urlPath = url[3] ?? "";
		if (scheme === "file") {
			path = underRoot(safeDecode(urlPath), options.filenameRoot);
		} else if (scheme === "http" || scheme === "https") {
			const prefixes = options.assetPathPrefixes ?? DEFAULT_ASSET_PATH_PREFIXES;
			if (prefixes.some((prefix) => urlPath.startsWith(prefix))) {
				path = urlPath;
			}
		}
	} else {
		path = underRoot(raw.replace(/[?#].*$/, ""), options.filenameRoot);
	}
	if (path === undefined) return undefined;

	const segments = path.split("/").filter(Boolean);
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i]!;
		if (
			segments[i - 1]?.toLowerCase() === "invite" ||
			UUID.test(segment) ||
			EMAIL_LIKE.test(segment) ||
			(TOKEN_LIKE.test(segment) &&
				/\d/.test(segment) &&
				/[A-Za-z]/.test(segment))
		) {
			segments[i] = REDACTED;
		}
	}
	const value = `app:///${segments.join("/")}`;
	return FILENAME.test(value) ? value : undefined;
}

function underRoot(path: string, root: string | undefined): string | undefined {
	if (!root) return undefined;
	const normalizedPath = path.replaceAll("\\", "/");
	const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
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
