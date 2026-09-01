import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("checks the exact and disjoint inverse-list authoring contract", () => {
	const result = Bun.spawnSync(
		[
			"bun",
			"node_modules/typescript/bin/tsc",
			"-p",
			"tests/type/tsconfig.inv01-inverse-list-authoring.json",
			"--pretty",
			"false",
		],
		{ cwd: resolve(import.meta.dir, "../.."), stderr: "pipe", stdout: "pipe" },
	);
	expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
	expect(result.exitCode).toBe(0);
});
