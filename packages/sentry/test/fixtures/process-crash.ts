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

const uninstall = installProcessErrorHandlers(errors as never, {
	flushTimeoutMs: 200,
});
if (scenario === "uninstalled") uninstall();

if (scenario === "reject") {
	void Promise.reject(new Error("boom"));
} else {
	setTimeout(() => {
		throw new Error("boom");
	}, 1);
}

if (scenario === "own-listener") {
	setTimeout(() => console.log("STILL ALIVE"), 300);
}
