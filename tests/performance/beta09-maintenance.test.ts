import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import baseline from "../../quality/baselines/beta09-maintenance.json";
import scenario from "../../quality/performance/beta09-maintenance.json";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "../integration/postgres/helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function derivedBudget(
	input: Readonly<{
		referenceObservedMs: number;
		multiplier: number;
		roundUpQuantumMs: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedMs * input.multiplier) / input.roundUpQuantumMs,
		) * input.roundUpQuantumMs
	);
}

afterAll(async () => {
	await disposeBeta08Harness();
	await database?.close({ timeout: 0 });
});

postgresTest(
	"BETA-09 measures fenced maintenance commands through PostgreSQL 17",
	async () => {
		const [version] = await database!.unsafe<
			Readonly<Array<{ serverVersionNum: string }>>
		>(`SELECT current_setting('server_version_num') AS "serverVersionNum"`);
		expect(Math.trunc(Number(version?.serverVersionNum) / 10_000)).toBe(17);
		if (process.env.QUESTPIE_POSTGRES_MAJOR)
			expect(process.env.QUESTPIE_POSTGRES_MAJOR).toBe("17");
		const recordedSamples = [...baseline.samples.postgresMaintenance20Ms].sort(
			(left, right) => left - right,
		);
		expect(recordedSamples).toHaveLength(baseline.reference.samples);
		expect(baseline.observed.postgresMaintenance20Ms).toBe(recordedSamples[1]!);

		const prepared = await beta08Harness(database!);
		const prefix = `beta09-perf-${crypto.randomUUID()}`;
		for (let index = 0; index < 20; index += 1)
			await prepared.app.execution(
				{
					principal: prepared.principal,
					context: { companyId: beta05Ids.company },
				},
				({ mutations }) =>
					mutations["message.publish"](
						{
							channelId: beta05Ids.channel,
							body: `measured maintenance run ${index}`,
						},
						{ callId: `${prefix}-${index}` },
					),
			);

		const runs = await database!.unsafe<
			Readonly<Array<{ runId: string; version: number }>>
		>(
			`SELECT runs.run_id::text AS "runId", runs.event_sequence AS version
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration'
  AND intents.call_id LIKE $1
ORDER BY intents.call_id`,
			[`${prefix}-%`],
		);
		expect(runs).toHaveLength(20);

		const started = performance.now();
		const outcomes = [];
		for (const run of runs)
			outcomes.push(
				await prepared.app.durable.cancelRun({
					runId: run.runId,
					reason: "performance baseline",
					actor: prepared.principal,
					expectedVersion: run.version,
				}),
			);
		const postgresMaintenance20Ms = performance.now() - started;
		expect(outcomes.every(({ outcome }) => outcome === "applied")).toBe(true);

		const [audit] = await database!.unsafe<
			Readonly<Array<{ auditRows: number }>>
		>(
			`SELECT count(*)::int AS "auditRows"
FROM questpie_internal.durable_maintenance_commands AS commands
JOIN questpie_internal.durable_runs AS measured_runs
  ON measured_runs.application_name = commands.application_name
 AND measured_runs.run_id = commands.run_id
JOIN questpie_internal.pending_reaction_intents AS measured_intents
  ON measured_intents.application_name = measured_runs.application_name
 AND measured_intents.record_id = measured_runs.dispatch_id
WHERE commands.application_name = 'application:collaboration'
  AND measured_intents.call_id LIKE $1
  AND commands.reason = 'performance baseline'`,
			[`${prefix}-%`],
		);
		const measurements = {
			postgresMaintenance20Ms,
			auditRows: audit!.auditRows,
			publicDeclarationBytes:
				prepared.compilation.measurements.publicDeclarationBytes,
			typescriptInstantiations:
				prepared.compilation.measurements.typescriptInstantiations,
		};
		for (const [name, metric] of Object.entries(scenario.metrics)) {
			const measurement = measurements[name as keyof typeof measurements];
			if (metric.direction === "max")
				expect(measurement).toBeLessThanOrEqual(metric.budget);
			else expect(measurement).toBeGreaterThanOrEqual(metric.budget);
			expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
				metric.budget,
			);
		}
		for (const derivation of Object.values(baseline.budgetDerivation))
			expect(baseline.budgets.postgresMaintenance20Ms).toBe(
				derivedBudget(derivation),
			);

		console.log(
			JSON.stringify({
				scenario: "beta09-maintenance",
				budgetOwner: "BETA-09",
				evidenceClass:
					process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
					baseline.reference.runnerClass,
				postgresMajor: 17,
				measurements,
				status: "PASS",
			}),
		);
	},
	30_000,
);
