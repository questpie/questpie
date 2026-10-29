// Run in a child process by process.test.ts: `<runtime> process-crash.ts <scenario>`.
import { installProcessErrorHandlers } from "../../src/process.ts";

const scenario = process.argv[2];

const errors = {
	report(error: unknown, info: { source: string }) {
		const label = error instanceof Error ? error.message : String(error);
		console.log(`REPORTED ${info.source} ${label}`);
	},
	flush(): Promise<void> {
		if (scenario === "hanging-flush") return new Promise(() => {});
		return new Promise((resolve) => {
			// Unreferenced, like a real transport's deadline: it must not be what
			// keeps the process alive until the rethrow.
			const timer = setTimeout(() => {
				console.log("FLUSHED");
				resolve();
			}, 50);
			(timer as { unref?: () => void }).unref?.();
		});
	},
};

if (scenario === "own-listener") {
	process.on("uncaughtException", () => console.log("APP HANDLED"));
}
if (scenario === "own-once-listener") {
	process.once("uncaughtException", () => console.log("APP HANDLED"));
}
if (scenario === "monitor") {
	process.on("uncaughtExceptionMonitor", () => console.log("MONITOR"));
}

const uninstall = installProcessErrorHandlers(errors as never, {
	flushTimeoutMs: 200,
});
if (scenario === "uninstalled") uninstall();
// Added after the hook and run before it, so it is gone by the time it runs.
if (scenario === "app-first-once-listener") {
	process.prependOnceListener("uncaughtException", () =>
		console.log("APP HANDLED"),
	);
}
if (scenario === "app-first-once-rejection-listener") {
	process.prependOnceListener("unhandledRejection", () =>
		console.log("APP HANDLED"),
	);
}
if (scenario === "monitor-survives") {
	process.on("uncaughtExceptionMonitor", (error) =>
		console.log(`MONITOR ${(error as Error).message}`),
	);
	// The app takes over while the first error is being delivered, so the
	// rethrow does not end the process; the monitor must still see the next one.
	setTimeout(() => {
		process.on("uncaughtException", () => console.log("APP HANDLED"));
	}, 20);
	setTimeout(() => {
		throw new Error("second");
	}, 400);
	setTimeout(() => console.log("STILL ALIVE"), 600);
}

if (scenario === "reject" || scenario === "app-first-once-rejection-listener") {
	void Promise.reject(new Error("boom"));
} else {
	setTimeout(() => {
		throw new Error("boom");
	}, 1);
}

if (
	scenario === "own-listener" ||
	scenario === "own-once-listener" ||
	scenario === "app-first-once-listener" ||
	scenario === "app-first-once-rejection-listener" ||
	scenario === "reject"
) {
	setTimeout(() => console.log("STILL ALIVE"), 300);
}
