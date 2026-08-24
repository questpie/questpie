import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(
	join(tmpdir(), "questpie-action-wire-v3-proof-"),
);
try {
	for (const path of [
		"check.ts",
		"contract.ts",
		"retained-wire-v2.json",
		"wire-v3.json",
	])
		await cp(join(import.meta.dir, path), join(temporary, path));
	const child = Bun.spawn([process.execPath, "check.ts"], {
		cwd: temporary,
		stderr: "inherit",
		stdout: "inherit",
	});
	const exit = await child.exited;
	if (exit !== 0) throw new Error(`relocated proof failed with exit ${exit}`);
} finally {
	await rm(temporary, { force: true, recursive: true });
}

console.log("Action Wire v3 proof relocation PASS");
