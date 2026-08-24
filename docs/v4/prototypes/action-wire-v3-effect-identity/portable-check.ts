import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(
	join(tmpdir(), "questpie-action-wire-v3-proof-"),
);
try {
	const prototypeRoot = join(temporary, "docs/v4/prototypes");
	const proofRoot = join(prototypeRoot, "action-wire-v3-effect-identity");
	const limitsRoot = join(prototypeRoot, "action-limits");
	const runtimeRoot = join(temporary, "packages/runtime/src");
	await mkdir(proofRoot, { recursive: true });
	await mkdir(limitsRoot);
	await mkdir(runtimeRoot, { recursive: true });
	for (const path of [
		"check.ts",
		"contract.ts",
		"retained-wire-v2.json",
		"wire-v3.json",
	])
		await cp(join(import.meta.dir, path), join(proofRoot, path));
	await cp(
		join(import.meta.dir, "../action-limits/contract.ts"),
		join(limitsRoot, "contract.ts"),
	);
	await cp(
		join(import.meta.dir, "../../../../packages/runtime/src/canonical-json.ts"),
		join(runtimeRoot, "canonical-json.ts"),
	);
	const child = Bun.spawn([process.execPath, "check.ts"], {
		cwd: proofRoot,
		stderr: "inherit",
		stdout: "inherit",
	});
	const exit = await child.exited;
	if (exit !== 0) throw new Error(`relocated proof failed with exit ${exit}`);
} finally {
	await rm(temporary, { force: true, recursive: true });
}

console.log("Action Wire v3 proof relocation PASS");
