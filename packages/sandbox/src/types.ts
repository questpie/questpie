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

/** POST /run request body. */
export interface SandboxRunRequest {
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
