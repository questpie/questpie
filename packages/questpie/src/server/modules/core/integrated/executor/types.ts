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
}
