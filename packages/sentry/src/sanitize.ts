/**
 * Error sanitizer — the allowlist between a raw error and the wire.
 *
 * Nothing an error carries is trusted: `message` and `cause` routinely hold
 * tokens, SQL or payload fragments; `name` can be set dynamically; the first
 * line(s) of `stack` repeat the message; frame filenames can carry query
 * strings, invite tokens or ids. So the output keeps only:
 *
 * - a normalized type name (identifier-shaped, ending in Error/Exception),
 * - parsed stack frames with validated function names and scrubbed filenames,
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
	"function" | "filename" | "abs_path" | "lineno" | "colno" | "in_app"
>;

export interface SanitizeOptions {
	/** Detects proxies (server: `node:util/types` `isProxy`). */
	isProxy?: (value: unknown) => boolean;
	/** Detects native errors across realms (server: `isNativeError`). */
	isNativeError?: (value: unknown) => boolean;
	/**
	 * Absolute path prefix of the deployed app, rewritten to `app:///` so
	 * frames do not disclose host directory layout.
	 */
	filenameRoot?: string;
}

export const MAX_FRAMES = 50;
export const MAX_CAUSES = 3;
const MAX_STACK_LENGTH = 32_768;
const MAX_PROTOTYPE_DEPTH = 8;

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]{0,62}(Error|Exception)$/;
const FUNCTION_NAME = /^[A-Za-z0-9_$.<>[\]* ]{1,128}$/;
const FILENAME = /^[A-Za-z0-9_\-./@:~+%[\]\\]{1,512}$/;
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(?:(.*?)@)?(.+?):(\d+):(\d+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_LIKE = /^[A-Za-z0-9_-]{20,}$/;
const EMAIL_LIKE = /^[^@]+@[^@]+\.[A-Za-z]{2,}$/;
const URL_PREFIX = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;
const REDACTED = "[redacted]";

/**
 * The runtime's own `stack` accessor, captured before user code can replace
 * it. V8 installs `stack` as an own accessor on every error; an error whose
 * accessor is anything else has a user-defined getter, which is not called.
 */
const NATIVE_STACK_GETTER = findDescriptor(new Error("probe"), "stack")?.get;

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
	const name = readValue(error as object, "name");
	const message = readValue(error as object, "message");
	const stack = readStack(error as object);
	const type =
		typeof name === "string" && TYPE_NAME.test(name) ? name : "Error";

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
	if (raw.function && FUNCTION_NAME.test(raw.function)) {
		frame.function = raw.function;
	}
	const filename = raw.filename
		? sanitizeFilename(raw.filename, options.filenameRoot)
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
 * Keep scheme, host and path; drop credentials, query and fragment; mask path
 * segments that look like secrets or identifiers (anything after `/invite/`,
 * UUIDs, long token-like strings, e-mail addresses).
 */
export function sanitizeFilename(
	raw: string,
	filenameRoot?: string,
): string | undefined {
	if (raw.length > 2048) return undefined;
	let value: string;
	const url = URL_PREFIX.exec(raw);
	if (url) {
		const host = (url[2] ?? "").replace(/^.*@/, "");
		value = `${url[1]!.toLowerCase()}://${host}${url[3] ?? ""}`;
	} else {
		value = raw.replace(/[?#].*$/, "");
	}
	if (filenameRoot && value.startsWith(filenameRoot)) {
		value = `app:///${value.slice(filenameRoot.length).replace(/^[/\\]+/, "")}`;
	}
	const segments = value.split("/");
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
	value = segments.join("/");
	return FILENAME.test(value) ? value : undefined;
}
