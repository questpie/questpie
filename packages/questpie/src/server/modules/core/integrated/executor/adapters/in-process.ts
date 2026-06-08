import type {
	ExecutorAdapter,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "../adapter.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Serializes the trusted in-process critical section.
 *
 * The trusted path mutates PROCESS-WIDE globals for the duration of a run
 * (`globalThis.__secrets`, the `console.*` methods, and any caller `bindings`
 * such as `globalThis.questpie`) and restores them in `finally`. Two concurrent
 * trusted runs would otherwise interleave: run A sets the globals, awaits, then
 * run B overwrites them — and A's guest resumes reading B's secrets/bindings,
 * its logs get cross-attributed, and the LIFO restore leaves a dangling global.
 *
 * Autopilot is a multi-agent worker fleet with a `schedule-tick` cron, so
 * concurrent trusted `run()` calls in one process are real. This module-level
 * Promise-chain mutex makes each trusted run hold the shared globals exclusively:
 * the next run awaits the previous run's full set→import→run→restore window, so
 * it always starts from a clean global state. The untrusted process-per-request
 * (Deno sandbox) path does NOT use this — its guests have no shared host realm,
 * so it stays fully concurrent.
 *
 * The lock is held until the guest promise SETTLES — including when the soft
 * timeout already returned to the caller (the trusted guest is not preemptable,
 * so restoring globals at the deadline would let the next run bleed into the
 * still-running guest). A guest that never settles would therefore wedge the
 * queue; that matches the documented trusted-path assumption that the code is
 * trusted not to hang (real preemption is the untrusted-sandbox concern).
 */
let inProcessLock: Promise<void> = Promise.resolve();

/** Acquire the in-process mutex; returns the release fn to call in `finally`. */
function acquireInProcessLock(): Promise<() => void> {
	let release!: () => void;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	const prior = inProcessLock;
	inProcessLock = prior.then(() => next);
	return prior.then(() => release);
}

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
 *   - injected `bindings` (e.g. `globalThis.questpie`) for the run.
 *
 * Because all of the above touch SHARED process globals, trusted runs are
 * SERIALIZED via a module-level mutex — only one trusted run owns the globals at
 * a time (see `acquireInProcessLock`). The untrusted sandbox path is unaffected.
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

		// Serialize the whole critical section: only one trusted run may own the
		// shared globals (__secrets / console / bindings) at a time. The next run
		// waits here until this run has fully restored them below.
		const release = await acquireInProcessLock();

		const g = globalThis as Record<string, unknown>;
		const bindings = options.bindings ?? {};
		const bindingKeys = Object.keys(bindings);
		const prevSecrets = g.__secrets;
		const prevBindings = bindingKeys.map((k) => [k, g[k]] as const);

		console.log = capture("log");
		console.error = capture("error");
		console.warn = capture("warn");
		console.info = capture("info");
		g.__secrets = options.secrets ?? {};
		for (const k of bindingKeys) g[k] = bindings[k];

		// Restore the shared globals and release the mutex. Run EXACTLY ONCE, only
		// after the guest can no longer observe the globals (see below) — never
		// during a still-running guest, or a queued run would swap them underneath.
		let released = false;
		const restoreAndRelease = () => {
			if (released) return;
			released = true;
			console.log = orig.log;
			console.error = orig.error;
			console.warn = orig.warn;
			console.info = orig.info;
			g.__secrets = prevSecrets;
			for (const [k, v] of prevBindings) g[k] = v;
			release();
		};

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

			// The soft timeout bounds the CALLER's wait, but the trusted guest is not
			// preemptable — on timeout it keeps running. So defer the restore/release
			// until the guest actually SETTLES (its `.finally`), even though we return
			// the race result now. This keeps the globals owned by this run for as
			// long as its guest can read them, so a queued run can't bleed in; the
			// next run's `acquireInProcessLock()` waits for that settlement. The catch
			// is swallowed because the race result (success or timeout) already
			// carries the outcome.
			void exec.finally(restoreAndRelease).catch(() => {});

			const raced = await Promise.race([exec, timeout]);
			if (timer) clearTimeout(timer);
			return raced;
		} catch (err) {
			// Synchronous failure before the guest promise could settle (e.g. bad
			// source). The guest never started, so restore immediately.
			if (timer) clearTimeout(timer);
			restoreAndRelease();
			return {
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				logs,
				ms: Date.now() - started,
			};
		}
	}
}
