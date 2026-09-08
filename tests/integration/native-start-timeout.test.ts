import { expect, test } from "bun:test";
import { access, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { runNativeStartProcess } from "../support/native-start-process";

for (const mode of ["cooperative", "ignore-term"] as const) {
	test(`Start timeout stops ${mode} inherited-pipe descendants and removes all owned scratch`, async () => {
		const result = await runNativeStartProcess(
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
