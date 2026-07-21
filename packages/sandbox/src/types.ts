/**
 * Wire contract between the `executor` adapter (Bun/Node, main app) and the
 * standalone Deno sandbox server. Kept intentionally minimal: the main app
 * never imports Deno; it only speaks this JSON over HTTP.
 */

/**
 * Per-request guest capabilities. `net` and `import` are INDEPENDENT axes
 * (Deno enforces them separately — `--allow-net` gates `fetch`, `--allow-import`
 * gates module imports). The richer app-binding capabilities (`data`, `services`,
 * etc.) live on the core `ExecutorCapabilities` type and are NOT enforced by the
 * sandbox server — they are the later bindings-broker's job.
 */
export interface SandboxCapabilities {
	/** Runtime `fetch()` allowlist as `host[:port]`. Empty = no network. */
	net: string[];
	/** Module import allowlist as `host[:port]` (e.g. `esm.sh:443`). Empty = no remote imports. */
	import: string[];
	/** Hard wall-clock timeout; the subprocess is force-killed on exceed. */
	timeoutMs: number;
	/** Hard per-guest memory bound (`--v8-flags=--max-old-space-size`). */
	memoryMb: number;
}

/**
 * App-bindings wiring for the UNTRUSTED path. When present, the supervisor
 * exposes a capability-scoped `globalThis.questpie` proxy to the guest whose
 * methods RPC (over STDIO, never the network) to the host broker at {@link url},
 * authenticated by the per-run scoped {@link token}.
 *
 * The token is OPAQUE and is held by the SUPERVISOR only — it is never written
 * into the guest subprocess, so guest code cannot read or forge it to widen
 * scope. The guest only ever sees the typed proxy.
 *
 * Critically, the broker is reached SERVER-TO-SERVER (supervisor → app), NOT by
 * the guest's `fetch`: the guest's egress allowlist rejects loopback/private IPs
 * (the SSRF defense), so a localhost broker is unreachable from guest code by
 * design — we do not poke a hole in that.
 */
export interface SandboxBindings {
	/** Absolute URL of the host broker endpoint (e.g. `https://app/sandbox/rpc`). */
	url: string;
	/** Per-run opaque scoped token. Supervisor-only; never exposed to the guest. */
	token: string;
}

/** POST /run request body. */
export interface SandboxRunRequest {
	/** Authenticated provenance. The supervisor rejects omitted/unknown modes. */
	mode: "agent_workload" | "non_agent";
	/** Guest TypeScript source. Must `export default` a `function(input)`. */
	source: string;
	/** Payload passed to the guest entry function. */
	input: unknown;
	capabilities: SandboxCapabilities;
	/**
	 * Secrets injected into the guest (NOT in source). Surfaced to the guest as
	 * `globalThis.__secrets`. The sandbox never persists these.
	 */
	secrets?: Record<string, string>;
	/**
	 * App-bindings broker wiring. When omitted, the guest gets no `questpie`
	 * proxy (the legacy compute-only path). When present, the supervisor brokers
	 * the guest's binding RPCs to the host. See {@link SandboxBindings}.
	 */
	bindings?: SandboxBindings;
}

/** POST /run response body — also the `ExecutorAdapter.run` result shape. */
export interface SandboxRunResult {
	ok: boolean;
	output?: unknown;
	logs: string[];
	error?: string;
	/** True when the run was killed by the wall-clock timeout. */
	timedOut?: boolean;
	/** Wall-clock duration in ms (server-measured). */
	ms?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// FRAMED stdio protocol (guest subprocess ⇄ supervisor) for the bindings path.
//
// Mirrors `questpie`'s executor `protocol.ts` (the sandbox package ships as Deno
// source and must NOT import the framework — same reason `SandboxCapabilities`
// is duplicated here). When `bindings` is present the guest emits ONE JSON line
// per message on stdout, prefixed by FRAME_MARKER; the supervisor demuxes by
// `type` and replies to "rpc" with an "rpc-result" on the guest's stdin.
// ──────────────────────────────────────────────────────────────────────────

/** Line prefix marking a framed protocol message on guest stdout. */
export const FRAME_MARKER = "__QP_SANDBOX_MSG__";

/**
 * Header carrying the per-run scoped token on the supervisor → broker request.
 * Mirrors `questpie`'s `BINDINGS_TOKEN_HEADER`. Supervisor-only; never set by or
 * exposed to guest code.
 */
export const BINDINGS_TOKEN_HEADER = "x-questpie-sandbox-token";

/** Host-issued admission proving an Agent request crossed the workload boundary. */
export const AGENT_WORKLOAD_ADMISSION_HEADER =
	"x-questpie-agent-workload-admission";

/** Trusted host service identity for the structurally separate non-Agent path. */
export const NON_AGENT_ADMISSION_HEADER = "x-questpie-non-agent-admission";

/** Structured error returned by the broker (mirrors `questpie` `BindingError`). */
export interface SandboxBindingError {
	code: string;
	message: string;
}

/** Guest → supervisor: a binding RPC awaiting a brokered result. */
export interface GuestRpcMessage {
	type: "rpc";
	id: number;
	method: string;
	args: unknown;
}

/** Guest → supervisor: the run's final result. */
export interface GuestResultMessage {
	type: "result";
	ok: boolean;
	output?: unknown;
	error?: string;
	logs: string[];
}

/** Any message the guest emits on stdout (framed). */
export type GuestMessage = GuestRpcMessage | GuestResultMessage;

/** Supervisor → guest: the brokered outcome of a prior {@link GuestRpcMessage}. */
export interface HostRpcResultMessage {
	type: "rpc-result";
	id: number;
	ok: boolean;
	value?: unknown;
	error?: SandboxBindingError;
}
