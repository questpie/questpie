import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { COMMANDS, runCommands, VERIFY_STAGES } from "./verify-pr";

const root = resolve(import.meta.dir, "..");

describe("PR verification orchestrator", () => {
	test("covers every local PR gate category", () => {
		const commands = VERIFY_STAGES.flatMap((stage) => COMMANDS[stage])
			.flatMap(({ cmd }) => cmd)
			.join("\n");

		for (const gate of [
			"lint-census.ts",
			"deprecated-imports.ts",
			"clone-census.ts",
			"oxfmt",
			"check-types",
			"test",
			"build",
			"check-dist-syntax.ts",
			"check-dist-types.ts",
			"size-budget.ts",
			"bundle-budget.ts",
			"type-budget.ts",
			"any-census.ts",
			"dead-modules.ts",
			"example-errors.ts",
			"check-codegen-freshness.ts",
			"check-codegen-layers.ts",
		]) {
			expect(commands).toContain(gate);
		}
	});

	test("CI delegates every shared job to the same orchestrator", () => {
		const workflow = readFileSync(
			resolve(root, ".github/workflows/ci.yml"),
			"utf8",
		);
		for (const stage of VERIFY_STAGES) {
			expect(workflow).toContain(`bun run verify:pr -- --stage ${stage}`);
		}
	});

	test("returns the constituent exit code and stops at the first failure", () => {
		let calls = 0;
		const exitCode = runCommands(["lint"], () => {
			calls++;
			return { exitCode: calls === 2 ? 17 : 0 };
		});

		expect(exitCode).toBe(17);
		expect(calls).toBe(2);
	});
});
