/**
 * Executor adapter interface — the CORE contract for running a piece of
 * TypeScript with declared, capability-scoped permissions in one of two
 * isolation modes.
 *
 * The trusted in-process adapter ships in core (`adapters/in-process.ts`); the
 * sandboxed adapter is provided by the opt-in `@questpie/sandbox` package (HTTP
 * → standalone Deno service). The main app (Bun/Node) only speaks this
 * interface + HTTP — it never imports Deno.
 *
 * See design doc §3, §13, §14 and decision
 * `untrusted-exec-needs-process-isolation-not-in-process-workers`.
 */

/**
 * Isolation mode — selects which adapter executes the source.
 *
 * - `"trusted"`   — run in-process (Bun) with a soft timeout. For code you
 *                   already trust (code-mode agent, scheduled scripts you own).
 *                   The source runs with whatever the host process can do, so it
 *                   MUST be trusted. No process/permission sandbox.
 * - `"sandboxed"` — run in the `@questpie/sandbox` Deno service: a fresh,
 *                   hardened subprocess per request with a real memory bound,
 *                   scoped net/import, and fs/env/run/ffi denied. For untrusted
 *                   code (user/AI mini-apps).
 */
export type ExecutorIsolation = "trusted" | "sandboxed";

/**
 * Capability manifest for one execution. `net` and `import` are INDEPENDENT
 * egress axes (fetch vs module-import; Deno enforces them separately).
 *
 * `data` / `services` / `jobs` / `workflows` / `knowledge` declare the app-API
 * surface the guest may touch. These are TYPED here but ENFORCED by the later
 * bindings-broker task (`sandbox-app-bindings-broker`) — M2 does not enforce
 * them. The sandbox engine in M2 enforces only `net`, `import`, `timeoutMs`,
 * and `memoryMb`.
 */
export interface ExecutorCapabilities {
	/** Runtime `fetch()` host allowlist (`host[:port]`). Empty/omitted = no net. */
	net?: string[];
	/** Module-import host allowlist (`host[:port]`). Empty/omitted = no remote imports. */
	import?: string[];

	/** Knowledge (file-as-DB) scoped path globs. Declared now; broker-enforced later. */
	knowledge?: {
		read?: string[];
		write?: string[];
	};
	/** Collections/globals data access. Declared now; broker-enforced later. */
	data?: {
		collections?: Record<string, Array<"read" | "create" | "update" | "delete">>;
		globals?: Record<string, Array<"read" | "write">>;
	};
	/** Allowed service names. Declared now; broker-enforced later. */
	services?: string[];
	/** Allowed job names to enqueue. Declared now; broker-enforced later. */
	jobs?: string[];
	/** Allowed workflow names to trigger. Declared now; broker-enforced later. */
	workflows?: string[];

	/** Hard wall-clock timeout (ms). */
	timeoutMs?: number;
	/** Hard per-guest memory bound (MB). Enforced via V8 flag for `sandboxed`. */
	memoryMb?: number;
}

/** Arguments to `ctx.executor.run`. */
export interface ExecutorRunOptions {
	/** Guest TypeScript source. Must `export default` a `function(input)`. */
	source: string;
	/** Payload passed to the guest entry function. */
	input?: unknown;
	/** Capability manifest (default-deny). */
	capabilities?: ExecutorCapabilities;
	/** Secrets injected into the guest (never embedded in source). */
	secrets?: Record<string, string>;
	/**
	 * Isolation mode. Defaults to `"sandboxed"` — untrusted-by-default is the
	 * safe default; trusted callers (code-mode) opt in explicitly.
	 */
	isolation?: ExecutorIsolation;
}

/** Structured result of an execution. */
export interface ExecutorRunResult {
	ok: boolean;
	output?: unknown;
	logs: string[];
	error?: string;
	/** True when killed by the wall-clock timeout. */
	timedOut?: boolean;
	/** Wall-clock duration (ms), when measured. */
	ms?: number;
}

/**
 * An executor backend. The trusted in-process adapter ships in core; the
 * sandboxed adapter is provided by `@questpie/sandbox` (HTTP → Deno service).
 */
export interface ExecutorAdapter {
	run(options: ExecutorRunOptions): Promise<ExecutorRunResult>;
}
