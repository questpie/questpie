import type {
	ExecutorAdapter,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "../adapter.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Trusted in-process executor adapter (Bun/Node).
 *
 * Runs the source IN THE HOST PROCESS via a dynamic `import()` of the source as
 * a TypeScript module (data: URL). The guest therefore has the SAME powers as
 * the host — this is ONLY for code you trust (code-mode agent, scheduled scripts
 * you own). There is NO permission or process sandbox here; for untrusted code
 * use `isolation: "sandboxed"` (the `@questpie/sandbox` Deno service).
 *
 * Provides:
 *   - console.* capture into a logs[] buffer (restored after the run).
 *   - a SOFT wall-clock timeout (Promise.race) — note this does NOT preempt a
 *     tight synchronous loop in-process; it only bounds async work. That is an
 *     accepted limitation of the trusted path (the code is trusted not to hang).
 *   - injected `secrets` exposed as `globalThis.__secrets` for the run.
 */
export class InProcessExecutorAdapter implements ExecutorAdapter {
	constructor(private readonly defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS) {}

	async run(options: ExecutorRunOptions): Promise<ExecutorRunResult> {
		const started = Date.now();
		const timeoutMs = options.capabilities?.timeoutMs ?? this.defaultTimeoutMs;
		const logs: string[] = [];

		const orig = {
			log: console.log,
			error: console.error,
			warn: console.warn,
			info: console.info,
		};
		const capture =
			(level: keyof typeof orig) =>
			(...args: unknown[]) => {
				logs.push(
					`${level}: ${args
						.map((a) => {
							try {
								return typeof a === "string" ? a : JSON.stringify(a);
							} catch {
								return String(a);
							}
						})
						.join(" ")}`,
				);
			};

		const prevSecrets = (globalThis as Record<string, unknown>).__secrets;
		console.log = capture("log");
		console.error = capture("error");
		console.warn = capture("warn");
		console.info = capture("info");
		(globalThis as Record<string, unknown>).__secrets = options.secrets ?? {};

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const url = `data:text/typescript;base64,${Buffer.from(options.source).toString("base64")}`;

			const exec = (async (): Promise<ExecutorRunResult> => {
				const mod = await import(/* @vite-ignore */ url);
				const entry = mod.default;
				if (typeof entry !== "function") {
					throw new Error("guest must 'export default' a function(input)");
				}
				const output = await entry(options.input);
				return { ok: true, output, logs, ms: Date.now() - started };
			})();

			const timeout = new Promise<ExecutorRunResult>((resolve) => {
				timer = setTimeout(() => {
					resolve({
						ok: false,
						timedOut: true,
						error: `soft timeout exceeded (${timeoutMs}ms)`,
						logs,
						ms: Date.now() - started,
					});
				}, timeoutMs);
			});

			return await Promise.race([exec, timeout]);
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				logs,
				ms: Date.now() - started,
			};
		} finally {
			if (timer) clearTimeout(timer);
			console.log = orig.log;
			console.error = orig.error;
			console.warn = orig.warn;
			console.info = orig.info;
			(globalThis as Record<string, unknown>).__secrets = prevSecrets;
		}
	}
}
