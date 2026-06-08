import type { ExecutorAdapter } from "./adapter.js";

/**
 * Executor configuration.
 *
 * Unconfigured = DISABLED: calling `ctx.executor.run` throws a clear error.
 * Provide the adapter(s) for the isolation modes you use.
 */
export interface ExecutorConfig {
	/**
	 * Adapter for `isolation: "sandboxed"` (untrusted). Typically
	 * `httpSandboxAdapter({ url: process.env.SANDBOX_URL })` from `@questpie/sandbox`.
	 * If omitted, `sandboxed` runs throw a clear "not configured" error.
	 */
	sandboxed?: ExecutorAdapter;
	/**
	 * Adapter for `isolation: "trusted"` (in-process). Defaults to the built-in
	 * in-process adapter; override only to customize.
	 */
	trusted?: ExecutorAdapter;
	/** Default soft timeout (ms) when a run omits `capabilities.timeoutMs`. */
	defaultTimeoutMs?: number;
	/**
	 * TRUSTED internal URL of THIS app's sandbox broker endpoint
	 * (`…/sandbox/rpc`) that the sandbox SUPERVISOR reaches server-to-server to
	 * relay an untrusted guest's binding RPCs. The untrusted runner MUST source
	 * the broker URL from here (or `SANDBOX_BROKER_URL`) — NEVER from the inbound
	 * request's `Host`/origin, which is attacker-controllable and would let a
	 * spoofed `Host` redirect the supervisor (carrying the per-run token) to an
	 * attacker host (token exfiltration). Point this at the app's own loopback /
	 * internal address (the supervisor is trusted and CAN reach loopback).
	 */
	brokerUrl?: string;
}
