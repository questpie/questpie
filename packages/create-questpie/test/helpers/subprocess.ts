import { spawn } from "node:child_process";
import process from "node:process";

export type ExitResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
};

export type ProcessResult = ExitResult & {
	stdout: string;
	stderr: string;
};

export type ActiveProcess = {
	child: ReturnType<typeof spawn>;
	exited: Promise<ExitResult>;
	stdout: () => string;
	stderr: () => string;
};

type ProcessOptions = {
	cwd: string;
	env?: NodeJS.ProcessEnv;
};

type RunOptions = ProcessOptions & {
	timeoutMs?: number;
};

export const wait = (milliseconds: number) =>
	new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

export function createSubprocessHarness(options: {
	commandTimeoutMs: number;
	shutdownTimeoutMs: number;
}) {
	const activeProcesses = new Set<ActiveProcess>();

	function signalProcessGroup(
		child: ReturnType<typeof spawn>,
		signal: NodeJS.Signals,
	): void {
		if (process.platform !== "win32" && child.pid) {
			try {
				process.kill(-child.pid, signal);
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			}
		}
		child.kill(signal);
	}

	function start(
		command: string[],
		processOptions: ProcessOptions,
	): ActiveProcess {
		const child = spawn(command[0]!, command.slice(1), {
			cwd: processOptions.cwd,
			detached: process.platform !== "win32",
			env: {
				...process.env,
				CI: "1",
				NO_COLOR: "1",
				...processOptions.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr += chunk));
		const exited = new Promise<ExitResult>((resolveExit, rejectExit) => {
			child.once("error", rejectExit);
			child.once("close", (code, signal) => resolveExit({ code, signal }));
		});
		const active = {
			child,
			exited,
			stdout: () => stdout,
			stderr: () => stderr,
		};
		activeProcesses.add(active);
		child.once("close", () => activeProcesses.delete(active));
		return active;
	}

	async function terminate(active: ActiveProcess): Promise<ExitResult> {
		signalProcessGroup(active.child, "SIGTERM");
		const terminated = await Promise.race([
			active.exited.then((exit) => ({ done: true as const, exit })),
			wait(options.shutdownTimeoutMs).then(() => ({ done: false as const })),
		]);
		if (terminated.done) return terminated.exit;

		signalProcessGroup(active.child, "SIGKILL");
		const killed = await Promise.race([
			active.exited.then((exit) => ({ done: true as const, exit })),
			wait(1_000).then(() => ({ done: false as const })),
		]);
		if (killed.done) return killed.exit;

		throw new Error(
			`Process did not exit within ${options.shutdownTimeoutMs}ms after SIGTERM\n\nstdout:\n${active.stdout()}\n\nstderr:\n${active.stderr()}`,
		);
	}

	async function run(
		command: string[],
		runOptions: RunOptions,
	): Promise<ProcessResult> {
		const active = start(command, runOptions);
		const timeoutMs = runOptions.timeoutMs ?? options.commandTimeoutMs;
		const outcome = await Promise.race([
			active.exited.then((exit) => ({ kind: "exit" as const, exit })),
			wait(timeoutMs).then(() => ({ kind: "timeout" as const })),
		]);

		if (outcome.kind === "timeout") {
			try {
				await terminate(active);
			} catch {
				// The timeout error below carries the complete command output.
			}
			throw new Error(
				`Command timed out after ${timeoutMs}ms: ${command.join(" ")}\n\nstdout:\n${active.stdout()}\n\nstderr:\n${active.stderr()}`,
			);
		}

		return {
			...outcome.exit,
			stdout: active.stdout(),
			stderr: active.stderr(),
		};
	}

	async function cleanup(): Promise<void> {
		const results = await Promise.allSettled(
			[...activeProcesses].map(terminate),
		);
		const errors = results.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (errors.length > 0) {
			throw new AggregateError(errors, "Failed to stop subprocesses");
		}
	}

	return {
		activeCount: () => activeProcesses.size,
		cleanup,
		run,
		start,
		terminate,
	};
}
