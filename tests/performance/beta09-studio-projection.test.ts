import { afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import { projectStudioCatalog } from "../../apps/studio/src/projection";
import baseline from "../../quality/baselines/beta09-studio-projection.json";
import scenario from "../../quality/performance/beta09-studio-projection.json";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "../integration/postgres/helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function derivedBudget(
	input: Readonly<{
		reference: number;
		multiplier: number;
		quantum: number;
	}>,
): number {
	return (
		Math.ceil((input.reference * input.multiplier) / input.quantum) *
		input.quantum
	);
}

function directorySize(root: string): number {
	let total = 0;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
	}
	return total;
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"BETA-09 measures the worklist read and the Studio bundle",
	async () => {
		const [version] = await database!.unsafe<
			Readonly<Array<{ serverVersionNum: string }>>
		>(`SELECT current_setting('server_version_num') AS "serverVersionNum"`);
		expect(Math.trunc(Number(version?.serverVersionNum) / 10_000)).toBe(17);

		const prepared = await beta08Harness(database!);
		for (const index of [1, 2, 3, 4, 5]) {
			await prepared.app.execution(
				{
					principal: prepared.principal,
					context: { companyId: beta05Ids.company },
				},
				async ({ mutations }) => {
					await mutations["message.publish"](
						{
							channelId: beta05Ids.channel,
							body: `delivery-refused-always perf ${index}`,
						},
						{ callId: `beta09-perf-${index}` },
					);
				},
			);
		}
		for (let attempt = 0; attempt < 9; attempt += 1)
			await prepared.app.durable.poll();

		// One warm read first: the first statement on a connection pays for parse
		// and plan, which is not what this budget is about.
		await prepared.app.durable.worklist({ state: "failed", first: 50 });
		const samples: number[] = [];
		for (let index = 0; index < 20; index += 1) {
			const started = performance.now();
			await prepared.app.durable.worklist({ state: "failed", first: 50 });
			samples.push(performance.now() - started);
		}
		samples.sort((left, right) => left - right);
		const worklistMedianMs = samples[Math.floor(samples.length / 2)]!;

		const studioBundleBytes = directorySize(
			resolve(import.meta.dir, "../../apps/studio/dist"),
		);
		const generated = resolve(
			import.meta.dir,
			"../../fixtures/collaboration/.questpie/generated",
		);
		const catalogProjectionBytes = Buffer.byteLength(
			JSON.stringify(
				projectStudioCatalog({
					// The identity the mount projects from the verified loaded build;
					// the projection requires it, so the measurement includes it.
					"runtime-build-identity.json": JSON.stringify({
						format: "questpie.runtime-build-identity",
						version: 1,
						digest: (
							JSON.parse(
								readFileSync(join(generated, "runtime-build.json"), "utf8"),
							) as Readonly<{ digest: string }>
						).digest,
					}),
					"manifest.json": readFileSync(
						join(generated, "manifest.json"),
						"utf8",
					),
					"operation-contracts.json": readFileSync(
						join(generated, "operation-contracts.json"),
						"utf8",
					),
					"committed-migrations.json": readFileSync(
						join(generated, "committed-migrations.json"),
						"utf8",
					),
				}),
			),
		);

		// The budgets are derived from the recorded observation, and the derivation
		// is asserted here rather than trusted from the file.
		expect(scenario.metrics.worklistMedianMs.budget).toBe(
			derivedBudget({
				reference:
					baseline.budgetDerivation.worklistMedianMs.referenceObservedMs,
				multiplier: baseline.budgetDerivation.worklistMedianMs.multiplier,
				quantum: baseline.budgetDerivation.worklistMedianMs.roundUpQuantumMs,
			}),
		);
		expect(scenario.metrics.studioBundleBytes.budget).toBe(
			derivedBudget({
				reference:
					baseline.budgetDerivation.studioBundleBytes.referenceObservedBytes,
				multiplier: baseline.budgetDerivation.studioBundleBytes.multiplier,
				quantum:
					baseline.budgetDerivation.studioBundleBytes.roundUpQuantumBytes,
			}),
		);

		expect(worklistMedianMs).toBeLessThanOrEqual(
			scenario.metrics.worklistMedianMs.budget,
		);
		expect(studioBundleBytes).toBeLessThanOrEqual(
			scenario.metrics.studioBundleBytes.budget,
		);
		expect(catalogProjectionBytes).toBeLessThanOrEqual(
			scenario.metrics.catalogProjectionBytes.budget,
		);

		console.log(
			JSON.stringify({
				scenario: scenario.id,
				budgetOwner: scenario.budgetOwner,
				measurements: {
					worklistMedianMs,
					studioBundleBytes,
					catalogProjectionBytes,
				},
				status: "PASS",
			}),
		);
		await disposeBeta08Harness();
	},
);
