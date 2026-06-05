import type {
	ExecutorAdapter,
	ExecutorIsolation,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "./adapter.js";
import { InProcessExecutorAdapter } from "./adapters/in-process.js";
import type { ExecutorConfig } from "./types.js";

/**
 * Executor service — `ctx.executor`.
 *
 * Dispatches `run` to the adapter selected by `isolation`:
 *   - `"trusted"`   → in-process adapter (defaults to the built-in one).
 *   - `"sandboxed"` → the configured sandbox adapter (e.g. `@questpie/sandbox`
 *                      HTTP → Deno service). If none is configured, a sandboxed
 *                      run throws a clear error (never silently runs untrusted
 *                      code in-process).
 *
 * The executor is OPT-IN. If `config` is undefined (executor not configured at
 * all), every `run` throws — so unconfigured = disabled, with a clear message.
 *
 * Default isolation is `"sandboxed"` (untrusted-by-default). Trusted callers
 * (code-mode) must opt in with `isolation: "trusted"` explicitly.
 */
export class ExecutorService {
	private readonly config: ExecutorConfig | undefined;
	private readonly trustedAdapter: ExecutorAdapter;
	private readonly sandboxedAdapter: ExecutorAdapter | undefined;
	private readonly enabled: boolean;

	constructor(config?: ExecutorConfig) {
		this.config = config;
		this.enabled = config !== undefined;
		this.trustedAdapter =
			config?.trusted ??
			new InProcessExecutorAdapter(config?.defaultTimeoutMs);
		this.sandboxedAdapter = config?.sandboxed;
	}

	/** Whether the executor is configured at all. */
	get isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Run `source` (TypeScript that `export default`s a `function(input)`) and
	 * return a structured `{ ok, output, logs, error }`. Adapter-level failures
	 * (sandbox down, guest throw) are returned as `{ ok:false, error }`; only
	 * misconfiguration (executor/sandboxed adapter not configured) throws.
	 */
	async run(options: ExecutorRunOptions): Promise<ExecutorRunResult> {
		if (!this.enabled) {
			throw new Error(
				"executor is not configured. Set `executor` in your Questpie config " +
					"(e.g. `executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }`).",
			);
		}

		const isolation: ExecutorIsolation = options.isolation ?? "sandboxed";

		if (isolation === "trusted") {
			return this.trustedAdapter.run({ ...options, isolation });
		}

		if (!this.sandboxedAdapter) {
			throw new Error(
				"executor sandboxed isolation is not configured. Provide a sandboxed " +
					"adapter (e.g. `executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }`) " +
					"to run untrusted code, or pass `isolation: \"trusted\"` for trusted code.",
			);
		}
		return this.sandboxedAdapter.run({ ...options, isolation });
	}
}
