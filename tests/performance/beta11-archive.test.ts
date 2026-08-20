import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

test("BETA-11 archive portability stays inside its stable-runner budgets", async () => {
	const baseline = (await Bun.file(
		resolve(
			import.meta.dir,
			"../../quality/baselines/beta11-archive-portability.json",
		),
	).json()) as Readonly<{
		reference: Readonly<{ runnerClass: string }>;
		budgetDerivation: Readonly<{
			compileMs: Readonly<{
				referenceObservedMs: number;
				multiplier: number;
				roundUpQuantumMs: number;
			}>;
		}>;
		budgets: Readonly<{
			compileMs: number;
			generatedBytes: number;
			typescriptInstantiations: number;
		}>;
	}>;
	const compileDerivation = baseline.budgetDerivation.compileMs;
	expect(
		Math.ceil(
			(compileDerivation.referenceObservedMs * compileDerivation.multiplier) /
				compileDerivation.roundUpQuantumMs,
		) * compileDerivation.roundUpQuantumMs,
	).toBe(baseline.budgets.compileMs);
	const outputDirectory = await mkdtemp(
		join(tmpdir(), "questpie-beta11-bench-"),
	);
	try {
		const result = await compileApplication({
			applicationRoot: resolve(import.meta.dir, "../../fixtures/archive"),
			outputDirectory,
		});
		expect(result.measurements.compileMs).toBeLessThanOrEqual(
			baseline.budgets.compileMs,
		);
		expect(result.measurements.generatedBytes).toBeLessThanOrEqual(
			baseline.budgets.generatedBytes,
		);
		expect(result.measurements.typescriptInstantiations).toBeLessThanOrEqual(
			baseline.budgets.typescriptInstantiations,
		);
		console.log(
			JSON.stringify({
				scenario: "beta11-archive-portability",
				budgetOwner: "BETA-11",
				evidenceClass: baseline.reference.runnerClass,
				measurements: result.measurements,
				status: "PASS",
			}),
		);
	} finally {
		await rm(outputDirectory, { force: true, recursive: true });
	}
});
