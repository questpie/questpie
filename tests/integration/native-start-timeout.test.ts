import { expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runOwnedBunProcess } from "../support/owned-bun-process";

function killOwnedBrowser(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

test("timeout grace survives root exit so an independently piped worker can clean its detached browser", async () => {
	const witness = await mkdtemp(
		join(tmpdir(), "questpie-timeout-grace-control-"),
	);
	let browserPid: number | undefined;
	try {
		const result = await runOwnedBunProcess(
			resolve(import.meta.dir, "../support/native-start-timeout-control.ts"),
			["root-exits-first", witness],
			500,
		);
		const ready = JSON.parse(result.stdout.split("\n")[0]!) as {
			phase: string;
			browserPid: number;
		};
		browserPid = ready.browserPid;
		expect(result.timedOut).toBe(true);
		expect(result.exit).toBe(143);
		expect(ready.phase).toBe("cleanup-ready");
		expect(
			await readFile(join(witness, "cleanup-completed"), "utf8").catch(
				(error) => {
					if ((error as NodeJS.ErrnoException).code === "ENOENT")
						return "missing";
					throw error;
				},
			),
		).toBe("completed");
		const status = await readFile(`/proc/${browserPid}/stat`, "utf8").catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return undefined;
				throw error;
			},
		);
		expect(status === undefined || /\) [ZX] /.test(status)).toBe(true);
		expect(
			await access(result.temporary).then(
				() => false,
				() => true,
			),
		).toBe(true);
	} finally {
		try {
			if (browserPid !== undefined) killOwnedBrowser(browserPid);
		} finally {
			await rm(witness, { recursive: true, force: true });
		}
	}
}, 5_000);

for (const mode of ["cooperative", "ignore-term"] as const) {
	test(`Start timeout stops ${mode} inherited-pipe descendants and removes all owned scratch`, async () => {
		const result = await runOwnedBunProcess(
			resolve(import.meta.dir, "../support/native-start-timeout-control.ts"),
			mode === "ignore-term" ? [mode] : [],
			500,
		);
		try {
			expect(result.timedOut).toBe(true);
			expect(result.exit).not.toBe(0);
			const ready = JSON.parse(result.stdout.split("\n")[0]!) as {
				phase: string;
				pid: number;
			};
			expect(ready.phase).toBe("descendant-ready");
			expect(result.stdout).not.toContain("DESCENDANT_OUTLIVED_TIMEOUT");
			const status = await readFile(`/proc/${ready.pid}/stat`, "utf8").catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return undefined;
					throw error;
				},
			);
			// A terminated orphan can briefly remain a zombie until PID 1 reaps it.
			expect(status === undefined || /\) [ZX] /.test(status)).toBe(true);
			expect(
				await access(result.temporary).then(
					() => false,
					(error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return true;
						throw error;
					},
				),
			).toBe(true);
		} finally {
			// A regressed supervisor must not leave the fixture's scratch behind.
			await rm(result.temporary, { recursive: true, force: true });
		}
	}, 5_000);
}
