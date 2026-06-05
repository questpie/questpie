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

/**
 * The PRIMITIVE surface exposed to a sandboxed guest, mirroring the server `ctx`
 * names (consistent-naming principle). Methods are addressed as dotted strings
 * so the wire protocol stays a flat `{ method, args }`.
 *
 * MVP (this task) ENFORCES + DISPATCHES:
 *   - `knowledge.read` | `knowledge.write` | `knowledge.list`
 *   - `collections.<name>.find` | `collections.<name>.findOne`
 *
 * Typed + capability-CHECKED here but DISPATCH deferred (no target handler yet —
 * the broker rejects them as `not_implemented` until a future task wires them):
 *   - `collections.<name>.create|update|delete`, `globals.<name>.get|set`,
 *     `services.<name>.<fn>`, `jobs.enqueue`, `workflows.trigger`,
 *     `email.send`.
 */
export type BindingMethod = string;

/** A parsed binding method, classified by primitive family. */
export type ParsedBindingMethod =
	| { kind: "knowledge"; op: "read" | "write" | "list" }
	| {
			kind: "collection";
			name: string;
			op: "find" | "findOne" | "create" | "update" | "delete";
	  }
	| { kind: "global"; name: string; op: "get" | "set" }
	| { kind: "service"; name: string; fn: string }
	| { kind: "job"; op: "enqueue"; name: string }
	| { kind: "workflow"; op: "trigger"; name: string }
	| { kind: "email"; op: "send" };

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

/**
 * Parse a dotted {@link BindingMethod} into a classified shape, or `null` when
 * it does not name a known primitive. Parsing is purely syntactic — it does NOT
 * consult capabilities (that is {@link checkBindingCapability}'s job).
 *
 * Grammar (segments split on `.`):
 *   knowledge.(read|write|list)
 *   collections.<name>.(find|findOne|create|update|delete)
 *   globals.<name>.(get|set)
 *   services.<name>.<fn>
 *   jobs.enqueue.<name>          (job name as a trailing segment)
 *   workflows.trigger.<name>
 *   email.send
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

	if (head === "knowledge") {
		if (rest.length !== 1) return null;
		const op = rest[0];
		if (op === "read" || op === "write" || op === "list") {
			return { kind: "knowledge", op };
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

	return null;
}
