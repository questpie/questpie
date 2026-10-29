import process from "node:process";

import type { ErrorReportingService } from "questpie/errors";

export interface ProcessErrorHandlerOptions {
	/**
	 * How long delivery may take before the process ends. The process keeps
	 * running in its failed state until then, so keep it short.
	 * @default 2000
	 */
	flushTimeoutMs?: number;
}

/**
 * Report uncaught exceptions and unhandled rejections through `app.errors`
 * (`source: "process"`) without changing how the process ends.
 *
 * When no other listener for the event is installed, the error is rethrown
 * once delivery finished or `flushTimeoutMs` passed, so the runtime prints it
 * and exits exactly as it would have. When the app has its own listener, that
 * listener decides what happens and this only reports.
 *
 * Node raises an unhandled rejection as an uncaught exception by default, so
 * one listener covers both. Bun does not, so there an `unhandledRejection`
 * listener is added too, except with `--unhandled-rejections=strict`, where Bun
 * raises it as an uncaught exception as well. With `--unhandled-rejections`
 * `warn`, `warn-with-error-code` or `none`, which keep the process running,
 * rejections are not reported.
 *
 * Returns a function that removes the listeners.
 */
export function installProcessErrorHandlers(
	errors: Pick<ErrorReportingService, "report" | "flush">,
	options: ProcessErrorHandlerOptions = {},
): () => void {
	const flushTimeoutMs = options.flushTimeoutMs ?? 2_000;
	const watchRejections =
		process.versions.bun !== undefined &&
		!["warn", "warn-with-error-code", "none", "strict"].includes(
			rejectionMode() ?? "",
		);
	let ending = false;

	const end = (error: unknown, seenByMonitors: boolean) => {
		ending = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// A referenced timer keeps the process alive until the rethrow, so an
		// emptied event loop cannot end it early with exit code 0.
		const deadline = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, flushTimeoutMs);
		});
		const delivered = new Promise<void>((resolve) =>
			resolve(errors.flush(flushTimeoutMs)),
		).catch(() => {});
		void Promise.race([delivered, deadline]).then(() => {
			clearTimeout(timer);
			uninstall();
			setImmediate(() => {
				// The monitors already saw this error; the rethrow must not show
				// it to them again.
				if (seenByMonitors) {
					process.removeAllListeners("uncaughtExceptionMonitor");
				}
				throw error;
			});
		});
	};

	const onException = (error: unknown) => {
		errors.report(error, { source: "process" });
		if (!ending && process.listenerCount("uncaughtException") === 1) {
			end(error, true);
		}
	};
	const onRejection = (reason: unknown) => {
		errors.report(reason, { source: "process" });
		if (!ending && process.listenerCount("unhandledRejection") === 1) {
			end(reason, false);
		}
	};

	function uninstall() {
		process.off("uncaughtException", onException);
		if (watchRejections) process.off("unhandledRejection", onRejection);
	}

	// Prepended, so the counts above still include an app listener added with
	// `once`, which removes itself when it runs.
	process.prependListener("uncaughtException", onException);
	if (watchRejections)
		process.prependListener("unhandledRejection", onRejection);
	return uninstall;
}

/** The `--unhandled-rejections` mode, given as `--x=mode` or `--x mode`. */
function rejectionMode(): string | undefined {
	let mode: string | undefined;
	process.execArgv.forEach((arg, i) => {
		if (arg === "--unhandled-rejections") mode = process.execArgv[i + 1];
		else if (arg.startsWith("--unhandled-rejections=")) {
			mode = arg.slice("--unhandled-rejections=".length);
		}
	});
	return mode;
}
