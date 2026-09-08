import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Supervise an ordinary Start worker outside Bun's test scanner. */
export async function runNativeStartProcess(
	entrypoint: string,
	args: readonly string[],
	timeoutMs: number,
) {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-start-supervisor-"));
	let child: ReturnType<typeof Bun.spawn> | undefined;
	let timedOut = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let escalation: ReturnType<typeof setTimeout> | undefined;
	const signalGroup = (signal: NodeJS.Signals) => {
		if (!child) return;
		try {
			// detached gives this worker its own group; never signal the test host.
			process.kill(-child.pid, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	};
	try {
		const worker = Bun.spawn([process.execPath, entrypoint, ...args], {
			detached: true,
			env: { ...process.env, TMPDIR: temporary },
			stdout: "pipe",
			stderr: "pipe",
		});
		child = worker;
		deadline = setTimeout(() => {
			timedOut = true;
			signalGroup("SIGTERM");
			escalation = setTimeout(() => signalGroup("SIGKILL"), 1_000);
		}, timeoutMs);
		const [exit, stdout, stderr] = await Promise.all([
			worker.exited,
			new Response(worker.stdout).text(),
			new Response(worker.stderr).text(),
		]);
		return { exit, stdout, stderr, timedOut, temporary };
	} finally {
		clearTimeout(deadline);
		clearTimeout(escalation);
		try {
			signalGroup("SIGKILL");
			await child?.exited;
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
}
