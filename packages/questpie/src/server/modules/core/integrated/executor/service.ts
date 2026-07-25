import type {
	ExecutorAdapter,
	ExecutorIsolation,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "./adapter.js";
import { InProcessExecutorAdapter } from "./adapters/in-process.js";
import { type BindingTarget, SandboxBroker } from "./bindings/broker.js";
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

	/**
	 * Per-process bindings broker for the UNTRUSTED path: mints per-run scoped
	 * tokens, authenticates binding RPCs, and enforces capabilities per call.
	 * Always present (even when the executor is disabled) so the `/api/_sandbox/rpc`
	 * endpoint has a single, stable instance; with no tokens minted it rejects
	 * every call as `unauthorized`. See {@link SandboxBroker}.
	 */
	readonly broker: SandboxBroker;

	constructor(config?: ExecutorConfig) {
		this.config = config;
		this.enabled = config !== undefined;
		this.trustedAdapter =
			config?.trusted ?? new InProcessExecutorAdapter(config?.defaultTimeoutMs);
		this.sandboxedAdapter = config?.sandboxed;
		this.broker = new SandboxBroker();
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
					'to run untrusted code, or pass `isolation: "trusted"` for trusted code.',
			);
		}

		// UNTRUSTED app-bindings: when the caller (mini-app runner) provides a
		// capability-scoped primitive target AND a broker URL, mint a SHORT-LIVED
		// per-run token bound to (capabilities, target) and hand the supervisor the
		// broker coordinates. The token is opaque + server-side-mapped; it is always
		// revoked once the run settles, so a leaked token cannot outlive the run.
		if (options.appBindings && options.brokerUrl) {
			const minted = this.broker.mint({
				capabilities: options.capabilities ?? {},
				target: options.appBindings as BindingTarget,
				ttlMs: options.capabilities?.timeoutMs
					? options.capabilities.timeoutMs + 30_000
					: undefined,
			});
			try {
				return await this.sandboxedAdapter.run({
					...options,
					isolation,
					sandboxBindings: { url: options.brokerUrl, token: minted.token },
				});
			} finally {
				minted.revoke();
			}
		}

		return this.sandboxedAdapter.run({ ...options, isolation });
	}
}
