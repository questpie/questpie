import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

test("BETA-01 structural compiler stays inside its stable-runner budgets", async () => {
	const outputDirectory = await mkdtemp(
		join(tmpdir(), "questpie-beta01-bench-"),
	);
	try {
		const result = await compileApplication({
			applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
			outputDirectory,
		});
		expect(result.measurements.compileMs).toBeLessThanOrEqual(5_000);
		expect(result.measurements.typescriptInstantiations).toBeLessThanOrEqual(
			125_000,
		);
		expect(result.measurements.publicDeclarationBytes).toBeLessThanOrEqual(
			262_144,
		);
		console.log(
			JSON.stringify({
				scenario: "beta01-compiler",
				budgetOwner: "BETA-01",
				measurements: result.measurements,
				status: "PASS",
			}),
		);
	} finally {
		await rm(outputDirectory, { force: true, recursive: true });
	}
});
