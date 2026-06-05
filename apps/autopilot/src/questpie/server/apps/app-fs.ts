import { Buffer } from "node:buffer";

import { ApiError } from "questpie/errors";

import { normalizeKnowledgePath } from "../services/knowledge-resource.js";
import { appPathPrefix } from "./app-resolver.js";

/**
 * App file-as-DB scoping + format-agnostic (de)serialization helpers.
 *
 * Mini-apps store data as files under `company/apps/{appId}/data/...` in the
 * Knowledge tree. This module owns the two security/format invariants the fs
 * route relies on:
 *
 *  1. **Scope enforcement** — every requested path is normalized and MUST
 *     resolve under `company/apps/{appId}/data/`. `..`, leading `/`, or any
 *     path that escapes the app's data dir is rejected, mirroring the M3
 *     resolver's appId guard.
 *  2. **Format-agnostic storage** — the API reads/writes raw bytes; the stored
 *     `contentType` is metadata only. Because the Knowledge `body` column is
 *     text, binary payloads are base64-encoded with an `encoding: "base64"`
 *     marker in metadata so GET can faithfully reproduce the original bytes.
 *     No format (json/csv/sqlite/custom) is ever parsed or special-cased.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §8 (M6), §9 (decision 4),
 * §11 (decision 5: read/write/list, no DELETE).
 */

/** The Knowledge sub-prefix under which an app stores its data files. */
export function appDataPrefix(appId: string): string {
	return `${appPathPrefix(appId)}data/`;
}

/**
 * Validate an `{appId}` path segment. Mirrors the M3 resolver guard so the fs
 * route cannot be tricked into a different app's tree via the appId itself.
 *
 * @throws {ApiError} badRequest when the appId is empty or contains a path
 *   separator / traversal segment.
 */
export function assertValidAppId(appId: string): void {
	if (!appId || appId.includes("/") || appId === "." || appId === "..") {
		throw ApiError.badRequest(`Invalid appId: ${JSON.stringify(appId)}`);
	}
}

/**
 * Resolve a caller-supplied (relative) data path into the absolute, normalized
 * Knowledge path under the app's `data/` dir — rejecting anything that escapes
 * the scope.
 *
 * @param appId - validated app identifier.
 * @param relPath - path relative to the app's data dir (the `[...path]`
 *   segment). May be empty for the data-root listing.
 * @returns The normalized absolute Knowledge path (no leading slash).
 * @throws {ApiError} badRequest when the path escapes
 *   `company/apps/{appId}/data/`.
 */
export function resolveAppDataPath(appId: string, relPath: string): string {
	assertValidAppId(appId);
	const prefix = appDataPrefix(appId);

	const rel = (relPath ?? "").trim().replace(/^\/+/, "");
	// Empty relative path => the data root itself (used for directory listing).
	if (rel === "" || rel === ".") return prefix;

	// Normalize the joined path through the shared knowledge normalizer, which
	// rejects `..` traversal and `.`-only paths. Joining onto the prefix first
	// means even an absolute-looking `relPath` is re-rooted under the app dir
	// (its leading slash is stripped above), and any `..` that would climb out
	// of `data/` is caught here.
	const normalized = normalizeKnowledgePath(`${prefix}${rel}`);

	// Defense in depth: the normalized result MUST still live under the app's
	// data prefix. Reject otherwise (e.g. a path that normalized to the app
	// root or another app entirely).
	if (normalized !== prefix.slice(0, -1) && !normalized.startsWith(prefix)) {
		throw ApiError.badRequest(
			`Path escapes app data scope: ${JSON.stringify(relPath)}`,
		);
	}
	return normalized;
}

/** True when a content-type names a text-y format we can store verbatim. */
export function isTextContentType(contentType: string): boolean {
	const ct = contentType.toLowerCase();
	if (ct.startsWith("text/")) return true;
	return /(json|xml|yaml|yml|csv|javascript|typescript|markdown|x-www-form-urlencoded|svg|x-ndjson|x-sh|graphql)/.test(
		ct,
	);
}

/** Storage shape for a write: the text to persist + an encoding marker. */
export interface EncodedBody {
	body: string;
	/** `"base64"` when the original bytes were binary; otherwise `"utf8"`. */
	encoding: "utf8" | "base64";
}

/**
 * Encode raw request bytes for the text-only `body` column. Text content-types
 * are stored as UTF-8; everything else is base64 so arbitrary bytes round-trip.
 */
export function encodeBodyForStorage(
	bytes: Uint8Array,
	contentType: string,
): EncodedBody {
	const buf = Buffer.from(bytes);
	if (isTextContentType(contentType)) {
		return { body: buf.toString("utf8"), encoding: "utf8" };
	}
	return { body: buf.toString("base64"), encoding: "base64" };
}

/**
 * Reconstruct the original bytes from a stored resource. Honors the
 * `encoding` marker written by {@link encodeBodyForStorage} so binary blobs
 * come back byte-identical.
 */
export function decodeStoredBody(
	body: string,
	metadata: Record<string, unknown> | null | undefined,
): Uint8Array<ArrayBuffer> {
	const encoding = metadata?.encoding;
	const buf =
		encoding === "base64"
			? Buffer.from(body, "base64")
			: Buffer.from(body, "utf8");
	// Copy into a freshly-allocated, non-shared ArrayBuffer so the result is a
	// `Uint8Array<ArrayBuffer>` — the only `BodyInit`-compatible byte view (a
	// Node `Buffer`'s backing store is `ArrayBufferLike`, which the DOM lib
	// rejects as it could be a `SharedArrayBuffer`).
	const out = new Uint8Array(buf.length);
	out.set(buf);
	return out;
}
