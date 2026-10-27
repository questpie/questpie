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
 * listener is added too. With `--unhandled-rejections=warn`, `warn-with-error-code`
 * or `none`, which keep the process running, rejections are not reported.
 *
 * Returns a function that removes the listeners.
 */
export function installProcessErrorHandlers(
	errors: Pick<ErrorReportingService, "report" | "flush">,
	options: ProcessErrorHandlerOptions = {},
): () => void {
	const flushTimeoutMs = options.flushTimeoutMs ?? 2_000;
	const watchRejections =
		process.versions.bun !== undefined && !rejectionsTolerated();
	let ending = false;

	const end = (error: unknown) => {
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
				throw error;
			});
		});
	};

	const onException = (error: unknown) => {
		errors.report(error, { source: "process" });
		if (!ending && process.listenerCount("uncaughtException") === 1) {
			end(error);
		}
	};
	const onRejection = (reason: unknown) => {
		errors.report(reason, { source: "process" });
		if (!ending && process.listenerCount("unhandledRejection") === 1) {
			end(reason);
		}
	};

	function uninstall() {
		process.off("uncaughtException", onException);
		if (watchRejections) process.off("unhandledRejection", onRejection);
	}

	process.on("uncaughtException", onException);
	if (watchRejections) process.on("unhandledRejection", onRejection);
	return uninstall;
}

/** Whether the runtime was told to keep running after an unhandled rejection. */
function rejectionsTolerated(): boolean {
	return process.execArgv.some((arg) =>
		/^--unhandled-rejections=(warn|warn-with-error-code|none)$/.test(arg),
	);
}
