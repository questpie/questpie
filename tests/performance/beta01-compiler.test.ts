import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

test("BETA-01 structural compiler stays inside its stable-runner budgets", async () => {
	const baseline = (await Bun.file(
		resolve(import.meta.dir, "../../quality/baselines/beta01-compiler.json"),
	).json()) as Readonly<{
		reference: Readonly<{ runnerClass: string }>;
		budgets: Readonly<{
			compileMs: number;
			publicDeclarationBytes: number;
			typescriptInstantiations: number;
		}>;
	}>;
	const outputDirectory = await mkdtemp(
		join(tmpdir(), "questpie-beta01-bench-"),
	);
	try {
		const result = await compileApplication({
			applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
			outputDirectory,
		});
		expect(result.measurements.compileMs).toBeLessThanOrEqual(
			baseline.budgets.compileMs,
		);
		expect(result.measurements.typescriptInstantiations).toBeLessThanOrEqual(
			baseline.budgets.typescriptInstantiations,
		);
		expect(result.measurements.publicDeclarationBytes).toBeLessThanOrEqual(
			baseline.budgets.publicDeclarationBytes,
		);
		console.log(
			JSON.stringify({
				scenario: "beta01-compiler",
				budgetOwner: "BETA-01",
				evidenceClass: baseline.reference.runnerClass,
				measurements: result.measurements,
				status: "PASS",
			}),
		);
	} finally {
		await rm(outputDirectory, { force: true, recursive: true });
	}
});
