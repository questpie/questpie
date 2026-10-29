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

	// An app listener added with `once` removes itself before it runs, so by
	// the time `onException` runs the count may no longer include it. Monitors
	// run before any `uncaughtException` listener, so count there.
	let exceptionListeners: number | undefined;
	const onMonitor = () => {
		exceptionListeners = process.listenerCount("uncaughtException");
	};
	const onException = (error: unknown) => {
		errors.report(error, { source: "process" });
		const listeners =
			exceptionListeners ?? process.listenerCount("uncaughtException");
		exceptionListeners = undefined;
		if (!ending && listeners === 1) end(error);
	};
	const onRejection = (reason: unknown) => {
		errors.report(reason, { source: "process" });
		if (!ending && process.listenerCount("unhandledRejection") === 1) {
			end(reason);
		}
	};
	// Rejections have no monitor, so `onRejection` stays the first listener
	// instead: Bun raises them only after the microtask queue has drained.
	const onNewListener = (event: string | symbol, listener: unknown) => {
		if (event !== "unhandledRejection" || listener === onRejection) return;
		queueMicrotask(() => {
			if (!process.listeners("unhandledRejection").includes(onRejection)) {
				return;
			}
			process.off("unhandledRejection", onRejection);
			process.prependListener("unhandledRejection", onRejection);
		});
	};

	function uninstall() {
		process.off("uncaughtExceptionMonitor", onMonitor);
		process.off("uncaughtException", onException);
		if (watchRejections) {
			process.off("newListener", onNewListener);
			process.off("unhandledRejection", onRejection);
		}
	}

	process.on("uncaughtExceptionMonitor", onMonitor);
	process.prependListener("uncaughtException", onException);
	if (watchRejections) {
		process.on("newListener", onNewListener);
		process.prependListener("unhandledRejection", onRejection);
	}
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
