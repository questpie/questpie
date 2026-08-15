import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

describe("BETA-02 inline shape authoring", () => {
	test("accepts nested Field leaves and segment-tuple references", () => {
		const result = Bun.spawnSync(
			[
				"bun",
				"node_modules/typescript/bin/tsc",
				"-p",
				"tests/type/tsconfig.beta02-inline-shape-authoring.json",
				"--pretty",
				"false",
			],
			{ cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
		);
		const output = `${result.stdout.toString()}${result.stderr.toString()}`;
		expect(output).toBe("");
		expect(result.exitCode).toBe(0);
	});
});
