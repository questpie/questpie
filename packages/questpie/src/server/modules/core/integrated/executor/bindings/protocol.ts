/**
 * Bindings RPC protocol — the wire contract between an UNTRUSTED sandbox guest
 * and the trusted host broker.
 *
 * Design: `.private/knowledge-miniapps-mvp.md` §13 (TRUSTED vs UNTRUSTED) + §14
 * (the primitive surface + capability scoping) and decision
 * `untrusted-exec-needs-process-isolation-not-in-process-workers`.
 *
 * An untrusted mini-app must NOT import the app (= full DB/fs = no sandbox). It
 * instead gets a typed PROXY whose methods RPC to this broker, which imports the
 * app (like a job worker), enforces capabilities PER CALL, and executes via the
 * real `ctx`. This module is the shared vocabulary for that path:
 *
 *   - {@link BindingMethod}  — the dotted method names the proxy may invoke.
 *   - the FRAMED stdio messages multiplexed between guest subprocess ⇄ supervisor.
 *   - the broker request/response envelope (supervisor → app over HTTP).
 *
 * The privileged channel is STDIO/IPC to the supervisor, NEVER the network: the
 * guest's egress allowlist rejects loopback/private IPs (the SSRF defense), so a
 * localhost broker is unreachable by `fetch` BY DESIGN. We do not poke a hole in
 * that — the proxy reaches the broker only through the supervisor relay.
 */

import { types as nodeTypes } from "node:util";

/**
 * The PRIMITIVE surface exposed to a sandboxed guest, mirroring the server `ctx`
 * names (consistent-naming principle). Methods are addressed as dotted strings
 * so the wire protocol stays a flat `{ method, args }`.
 *
 * ENFORCED + DISPATCHED:
 *   - `files.read` | `files.write` | `files.list`
 *   - `collections.<name>.find|findOne` (the READ surface)
 *   - `collections.<name>.create|update|delete` — the §7 tenant-write boundary
 *     (`mini-app-bindings.ts` + Decision 8). Dispatched ONLY through a safe path:
 *     `document_store` via its `store`-grant row-filter clamp (force-stamp the
 *     `store`, reject client `store`/`id`/`createdAt`, blast-radius-contain the
 *     update/delete `where`), OR an OTHER collection that has its OWN explicit
 *     `.access().create/update/delete` rule (never the rule-less `!!session`
 *     fallback). A write whose target wires no safe handler still fails closed as
 *     `not_implemented`.
 *   - `globals.<name>.get`
 *   - `http.fetch` — brokered, SSRF-safe egress. The guest has NO direct network
 *     (`--allow-net=[]`); this RPC relays to the trusted host, which resolves +
 *     validates + PINS the connection (DNS-rebind-safe) per the run's `net`
 *     allowlist. See `host-fetch.ts`.
 *
 * DENIED / NOT DISPATCHED:
 *   - `globals.<name>.set` — a global is a singleton with no per-tenant boundary,
 *     so a guest set is denied outright (no namespaced clamp can confine it).
 *   - `services.<name>.<fn>`, `jobs.enqueue`, `workflows.trigger`, `email.send` —
 *     no target handler yet.
 */
export type BindingMethod = string;

/** A parsed binding method, classified by primitive family. */
export type ParsedBindingMethod =
	| { kind: "files"; op: "read" | "write" | "list" }
	| {
			kind: "collection";
			name: string;
			op: "find" | "findOne" | "create" | "update" | "delete";
	  }
	| { kind: "global"; name: string; op: "get" | "set" }
	| { kind: "service"; name: string; fn: string }
	| { kind: "job"; op: "enqueue"; name: string }
	| { kind: "workflow"; op: "trigger"; name: string }
	| { kind: "email"; op: "send" }
	| { kind: "http"; op: "fetch" };

/** Stable error codes returned to the guest (structured, never a bare throw). */
export type BindingErrorCode =
	/** Method string is malformed / not a recognized primitive. */
	| "bad_method"
	/** Args failed structural validation for the method. */
	| "bad_args"
	/** Per-run token missing/unknown/expired. */
	| "unauthorized"
	/** Method is recognized but OUTSIDE the run's declared capabilities. */
	| "forbidden"
	/** Method is in-scope but has no dispatch handler in this MVP. */
	| "not_implemented"
	/** The underlying primitive call threw. */
	| "execution_error";

/** A structured binding error (the negative result of an RPC). */
export interface BindingError {
	code: BindingErrorCode;
	message: string;
	/** Safe identifier that links a public failure to trusted diagnostics. */
	correlationId?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Framed stdio protocol (guest subprocess ⇄ supervisor).
//
// The guest writes one JSON object per line to stdout. The supervisor reads
// lines and DEMULTIPLEXES by `type`:
//   - "rpc"        → a binding call; the supervisor relays it to the broker and
//                    replies with an "rpc-result" written to the guest's stdin.
//   - "result"     → the guest's FINAL return value; ends the run.
// The guest, symmetrically, reads "rpc-result" lines from its stdin to resolve
// the matching pending `__hostCall`.
// ──────────────────────────────────────────────────────────────────────────

/** Line prefix marking a framed protocol message in guest stdout. */
export const FRAME_MARKER = "__QP_SANDBOX_MSG__";

/** Guest → supervisor: a binding RPC awaiting a brokered result. */
export interface GuestRpcMessage {
	type: "rpc";
	/** Correlation id, unique per in-flight call within the run. */
	id: number;
	method: BindingMethod;
	args: unknown;
}

/** Guest → supervisor: the run's final result (mirrors the legacy one-shot result). */
export interface GuestResultMessage {
	type: "result";
	ok: boolean;
	output?: unknown;
	error?: string;
	logs: string[];
}

/** Any message the guest may emit on stdout. */
export type GuestMessage = GuestRpcMessage | GuestResultMessage;

/** Supervisor → guest: the brokered outcome of a prior {@link GuestRpcMessage}. */
export interface HostRpcResultMessage {
	type: "rpc-result";
	id: number;
	ok: boolean;
	/** Present when `ok`. */
	value?: unknown;
	/** Present when `!ok`. */
	error?: BindingError;
}

// ──────────────────────────────────────────────────────────────────────────
// Broker HTTP envelope (supervisor → app, server-to-server).
// ──────────────────────────────────────────────────────────────────────────

/** Header carrying the per-run scoped token on the supervisor → broker request. */
export const BINDINGS_TOKEN_HEADER = "x-questpie-sandbox-token";

/** POST `/api/_sandbox/rpc` request body. */
export interface BrokerRpcRequest {
	method: BindingMethod;
	args: unknown;
}

/** POST `/api/_sandbox/rpc` response body. */
export type BrokerRpcResponse =
	| { ok: true; value: unknown }
	| { ok: false; error: BindingError };

// ──────────────────────────────────────────────────────────────────────────
// `http.fetch` over-relay contract (S1 spike `http-over-relay-contract-for-
// brokered-fetch`). The relay is line-framed, fully-buffered, JSON-only, so an
// HTTP exchange must be BUFFERED (no streaming), JSON-serializable, with binary
// bodies base64-encoded, and SIZE-CAPPED. One request frame, one response frame
// — rides the existing `rpc`/`rpc-result` envelope, NO new frame types.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Decoded body cap for a brokered `http.fetch`, enforced HOST-SIDE in the broker
 * with a running byte counter (the `Content-Length` header is NOT trusted).
 * Applies to BOTH the request `bodyBase64` (reject oversize guest uploads before
 * fetching) and the response body (abort the upstream read on overflow). 5 MiB
 * stays comfortably under the guest's 16-128 MiB heap even with base64 inflation
 * (~+33%) and the relay's multi-hop buffering.
 */
export const HTTP_FETCH_BODY_CAP_BYTES = 5 * 1024 * 1024;

/** JSON value budget for the base64 HTTP response plus bounded metadata. */
export const BROKER_HTTP_RESULT_CAP_BYTES =
	4 * Math.ceil(HTTP_FETCH_BODY_CAP_BYTES / 3) + 124 * 1024;

/** Maximum JSON value returned by non-HTTP native bindings. */
export const BROKER_NATIVE_RESULT_CAP_BYTES = 768 * 1024;

/** `args` of an `http.fetch` RPC (guest → broker). */
export interface HttpFetchRequest {
	/** Absolute `http:`/`https:` URL. Other schemes are rejected. */
	url: string;
	/** HTTP method. Defaults to `GET`. */
	method?: string;
	/** Request headers (any case; the broker forwards them verbatim). */
	headers?: Record<string, string>;
	/** base64 of the raw request body. Omit for no body. */
	bodyBase64?: string;
}

/**
 * `value` returned by an `http.fetch` RPC (broker → guest). Buffered, base64,
 * capped — the guest shim reconstructs a `Response` from this. A network
 * failure / oversize / blocked target rides the {@link BindingError} channel
 * instead (so guest `fetch` rejects, rather than seeing a fake 5xx `Response`).
 */
export interface HttpFetchResponse {
	/** HTTP status code. */
	status: number;
	/** Reason phrase (`""` if unknown). */
	statusText: string;
	/** Response headers: lowercased keys, multi-values joined with `", "`. */
	headers: Record<string, string>;
	/** base64 of the raw response bytes (`""` for an empty body). */
	bodyBase64: string;
	/** True if the body hit the cap and was cut (the broker rejects by default). */
	truncated: boolean;
}

export type BrokerJsonValue =
	| null
	| boolean
	| number
	| string
	| BrokerJsonValue[]
	| { [key: string]: BrokerJsonValue };

export type BoundedBrokerValue =
	| { ok: true; value: BrokerJsonValue; bytes: number }
	| { ok: false };

function jsonStringBytes(value: string, maximum: number): number {
	if (maximum < 2 || value.length + 2 > maximum) return maximum + 1;
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c) bytes += 2;
		else if (code <= 0x1f) {
			bytes +=
				code === 0x08 ||
				code === 0x09 ||
				code === 0x0a ||
				code === 0x0c ||
				code === 0x0d
					? 2
					: 6;
		} else if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			bytes += 4;
			index += 1;
		} else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
		else bytes += 3;
		if (bytes > maximum) return maximum + 1;
	}
	return bytes;
}

const OMIT_BROKER_VALUE = Symbol("omit-broker-value");

/**
 * Snapshot an arbitrary host result into inert JSON without invoking accessors,
 * proxy traps, or user-owned `toJSON`, while enforcing depth/node/byte limits
 * before the HTTP route calls `JSON.stringify`.
 */
export function snapshotBoundedBrokerValue(
	value: unknown,
	maxBytes: number,
	maxDepth = 64,
	maxNodes = 100_000,
): BoundedBrokerValue {
	const state = { bytes: 0, nodes: 0 };
	const seen = new Set<object>();

	const consume = (bytes: number): boolean => {
		state.bytes += bytes;
		return state.bytes <= maxBytes;
	};
	const snapshot = (
		current: unknown,
		depth: number,
		arrayItem: boolean,
	): BrokerJsonValue | typeof OMIT_BROKER_VALUE => {
		state.nodes += 1;
		if (state.nodes > maxNodes || depth > maxDepth) {
			throw new Error("invalid broker value");
		}
		if (current === undefined) {
			if (!arrayItem) return OMIT_BROKER_VALUE;
			if (!consume(4)) throw new Error("invalid broker value");
			return null;
		}
		if (current === null) {
			if (!consume(4)) throw new Error("invalid broker value");
			return null;
		}
		if (typeof current === "boolean") {
			if (!consume(current ? 4 : 5)) throw new Error("invalid broker value");
			return current;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || !consume(String(current).length)) {
				throw new Error("invalid broker value");
			}
			return current;
		}
		if (typeof current === "string") {
			if (!consume(jsonStringBytes(current, maxBytes - state.bytes))) {
				throw new Error("invalid broker value");
			}
			return current;
		}
		if (typeof current === "bigint") {
			const normalized = current.toString();
			if (!consume(jsonStringBytes(normalized, maxBytes - state.bytes))) {
				throw new Error("invalid broker value");
			}
			return normalized;
		}
		if (
			typeof current !== "object" ||
			current === null ||
			nodeTypes.isProxy(current)
		) {
			throw new Error("invalid broker value");
		}
		const prototype = Object.getPrototypeOf(current);
		if (prototype === Date.prototype) {
			let normalized: string;
			try {
				if (!Number.isFinite(Date.prototype.getTime.call(current))) {
					throw new Error("invalid broker value");
				}
				normalized = Date.prototype.toISOString.call(current);
			} catch {
				throw new Error("invalid broker value");
			}
			if (!consume(jsonStringBytes(normalized, maxBytes - state.bytes))) {
				throw new Error("invalid broker value");
			}
			return normalized;
		}
		if (seen.has(current)) throw new Error("invalid broker value");
		seen.add(current);
		try {
			const descriptors = Object.getOwnPropertyDescriptors(current);
			if (Array.isArray(current)) {
				if (prototype !== Array.prototype)
					throw new Error("invalid broker value");
				const lengthDescriptor = descriptors.length;
				const length =
					lengthDescriptor && "value" in lengthDescriptor
						? lengthDescriptor.value
						: -1;
				if (
					!Number.isSafeInteger(length) ||
					length < 0 ||
					length > maxNodes ||
					Object.keys(descriptors).some(
						(key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key),
					)
				) {
					throw new Error("invalid broker value");
				}
				if (!consume(2 + Math.max(0, length - 1))) {
					throw new Error("invalid broker value");
				}
				const result: BrokerJsonValue[] = [];
				for (let index = 0; index < length; index += 1) {
					const descriptor = descriptors[String(index)];
					if (!descriptor) {
						if (!consume(4)) throw new Error("invalid broker value");
						result.push(null);
						continue;
					}
					if (!descriptor.enumerable || !("value" in descriptor)) {
						throw new Error("invalid broker value");
					}
					const item = snapshot(descriptor.value, depth + 1, true);
					if (item === OMIT_BROKER_VALUE)
						throw new Error("invalid broker value");
					result.push(item);
				}
				return result;
			}
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error("invalid broker value");
			}
			if (!consume(2)) throw new Error("invalid broker value");
			const result: Record<string, BrokerJsonValue> = Object.create(null);
			let properties = 0;
			for (const [key, descriptor] of Object.entries(descriptors)) {
				if (!descriptor.enumerable) continue;
				if (!("value" in descriptor) || key === "toJSON") {
					throw new Error("invalid broker value");
				}
				const item = snapshot(descriptor.value, depth + 1, false);
				if (item === OMIT_BROKER_VALUE) continue;
				if (
					!consume(
						(properties > 0 ? 1 : 0) +
							jsonStringBytes(key, maxBytes - state.bytes) +
							1,
					)
				) {
					throw new Error("invalid broker value");
				}
				result[key] = item;
				properties += 1;
			}
			return result;
		} finally {
			seen.delete(current);
		}
	};

	try {
		const normalized = snapshot(value, 0, false);
		if (normalized === OMIT_BROKER_VALUE) return { ok: false };
		return { ok: true, value: normalized, bytes: state.bytes };
	} catch {
		return { ok: false };
	}
}

/**
 * Parse a dotted {@link BindingMethod} into a classified shape, or `null` when
 * it does not name a known primitive. Parsing is purely syntactic — it does NOT
 * consult capabilities (that is {@link checkBindingCapability}'s job).
 *
 * Grammar (segments split on `.`):
 *   files.(read|write|list)
 *   collections.<name>.(find|findOne|create|update|delete)
 *   globals.<name>.(get|set)
 *   services.<name>.<fn>
 *   jobs.enqueue.<name>          (job name as a trailing segment)
 *   workflows.trigger.<name>
 *   email.send
 *   http.fetch                   (brokered, SSRF-safe egress; net allowlist)
 *
 * `<name>`/`<fn>` must be a single non-empty segment of `[A-Za-z0-9_-]` (no
 * dots, no path traversal) so a malicious method string can't smuggle extra
 * structure past the classifier.
 */
export function parseBindingMethod(method: string): ParsedBindingMethod | null {
	if (typeof method !== "string" || method.length === 0) return null;
	const parts = method.split(".");
	const seg = /^[A-Za-z0-9_-]+$/;

	const [head, ...rest] = parts;

	if (head === "files") {
		if (rest.length !== 1) return null;
		const op = rest[0];
		if (op === "read" || op === "write" || op === "list") {
			return { kind: "files", op };
		}
		return null;
	}

	if (head === "collections") {
		if (rest.length !== 2) return null;
		const [name, op] = rest;
		if (!seg.test(name)) return null;
		if (
			op === "find" ||
			op === "findOne" ||
			op === "create" ||
			op === "update" ||
			op === "delete"
		) {
			return { kind: "collection", name, op };
		}
		return null;
	}

	if (head === "globals") {
		if (rest.length !== 2) return null;
		const [name, op] = rest;
		if (!seg.test(name)) return null;
		if (op === "get" || op === "set") return { kind: "global", name, op };
		return null;
	}

	if (head === "services") {
		if (rest.length !== 2) return null;
		const [name, fn] = rest;
		if (!seg.test(name) || !seg.test(fn)) return null;
		return { kind: "service", name, fn };
	}

	if (head === "jobs") {
		if (rest.length !== 2 || rest[0] !== "enqueue") return null;
		const name = rest[1];
		if (!seg.test(name)) return null;
		return { kind: "job", op: "enqueue", name };
	}

	if (head === "workflows") {
		if (rest.length !== 2 || rest[0] !== "trigger") return null;
		const name = rest[1];
		if (!seg.test(name)) return null;
		return { kind: "workflow", op: "trigger", name };
	}

	if (head === "email") {
		if (rest.length !== 1 || rest[0] !== "send") return null;
		return { kind: "email", op: "send" };
	}

	if (head === "http") {
		if (rest.length !== 1 || rest[0] !== "fetch") return null;
		return { kind: "http", op: "fetch" };
	}

	return null;
}
