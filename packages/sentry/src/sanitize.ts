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
 * Messages are never sent. Properties are read through descriptors, so a
 * user-defined getter, `toJSON` or `toString` is never invoked; a proxy is
 * treated as opaque when the runtime can recognise one.
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
	/** Detects proxies (server: `node:util/types` `isProxy`). */
	isProxy?: (value: unknown) => boolean;
	/** Detects native errors across realms (server: `isNativeError`). */
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

/**
 * The runtime's own `stack` accessor, captured before user code can replace
 * it. V8 installs `stack` as an own accessor on every error; an error whose
 * accessor is anything else has a user-defined getter, which is not called.
 */
const NATIVE_STACK_GETTER = findDescriptor(new Error("probe"), "stack")?.get;

/** `DOMException.prototype.name` is a native WebIDL getter, not a data property. */
const NATIVE_DOM_EXCEPTION_NAME_GETTER =
	typeof DOMException === "function"
		? Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
		: undefined;

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
			? readValue(current as object, "cause")
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
	const message = readValue(error as object, "message");
	const stack = readStack(error as object);
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
	try {
		if (options.isProxy?.(value)) return false;
		if (options.isNativeError) return options.isNativeError(value);
		return value instanceof Error;
	} catch {
		return false;
	}
}

/** Read a DATA property along the prototype chain. Accessors are not called. */
function readValue(target: object, key: string): unknown {
	const descriptor = findDescriptor(target, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function readName(target: object): unknown {
	const descriptor = findDescriptor(target, "name");
	if (!descriptor) return undefined;
	if ("value" in descriptor) return descriptor.value;
	if (descriptor.get && descriptor.get === NATIVE_DOM_EXCEPTION_NAME_GETTER) {
		try {
			return descriptor.get.call(target);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function readStack(target: object): unknown {
	const descriptor = findDescriptor(target, "stack");
	if (!descriptor) return undefined;
	if ("value" in descriptor) return descriptor.value;
	if (descriptor.get && descriptor.get === NATIVE_STACK_GETTER) {
		try {
			return descriptor.get.call(target);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function findDescriptor(
	target: object,
	key: string,
): PropertyDescriptor | undefined {
	try {
		let current: object | null = target;
		for (let depth = 0; current && depth < MAX_PROTOTYPE_DEPTH; depth++) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (descriptor) return descriptor;
			current = Object.getPrototypeOf(current) as object | null;
		}
	} catch {
		// A hostile object can throw from any reflective operation.
	}
	return undefined;
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
