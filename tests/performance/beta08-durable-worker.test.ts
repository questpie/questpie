import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import baseline from "../../quality/baselines/beta08-durable-worker.json";
import scenario from "../../quality/performance/beta08-durable-worker.json";
import {
	beta05Ids,
	prepareBeta08Durable,
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
	await database?.close({ timeout: 0 });
});

postgresTest(
	"BETA-08 measures one durable worker batch through PostgreSQL 17",
	async () => {
		const [version] = await database!.unsafe<
			Readonly<Array<{ serverVersionNum: string }>>
		>(`SELECT current_setting('server_version_num') AS "serverVersionNum"`);
		expect(Math.trunc(Number(version?.serverVersionNum) / 10_000)).toBe(17);
		if (process.env.QUESTPIE_POSTGRES_MAJOR)
			expect(process.env.QUESTPIE_POSTGRES_MAJOR).toBe("17");
		const recordedSamples = [...baseline.samples.postgresDurable20Ms].sort(
			(left, right) => left - right,
		);
		expect(recordedSamples).toHaveLength(baseline.reference.samples);
		expect(baseline.observed.postgresDurable20Ms).toBe(recordedSamples[1]!);

		const prepared = await prepareBeta08Durable(database!);
		try {
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
								body: `measured durable run ${index}`,
							},
							{ callId: `beta08-perf-${String(index).padStart(4, "0")}` },
						),
				);

			const worker = prepared.app.durable.worker({
				workerId: "worker:beta08-performance",
				claimBatch: 64,
			});
			const started = performance.now();
			const trace = (await worker.poll()) as Readonly<{
				admitted: number;
				claimed: number;
				outcomes: readonly Readonly<{ outcome: string }>[];
			}>;
			const postgresDurable20Ms = performance.now() - started;
			expect(trace.admitted).toBe(20);
			expect(trace.claimed).toBe(20);
			expect(
				trace.outcomes.every(({ outcome }) => outcome === "succeeded"),
			).toBe(true);

			const [rows] = await database!.unsafe<
				Readonly<
					Array<{
						runs: number;
						attempts: number;
						succeeded: number;
						maxEvents: number;
						maxResultBytes: number;
					}>
				>
			>(`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts) AS attempts,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE state = 'succeeded') AS succeeded,
  (SELECT max(event_sequence)::int FROM questpie_internal.durable_runs) AS "maxEvents",
  (SELECT max(octet_length(result_bytes))::int FROM questpie_internal.durable_runs) AS "maxResultBytes"`);
			expect(rows).toMatchObject({ runs: 20, attempts: 20, succeeded: 20 });

			const measurements = {
				postgresDurable20Ms,
				claimBatch: 64,
				maxEventsPerRun: rows!.maxEvents,
				maxRunResultBytes: rows!.maxResultBytes,
				publicDeclarationBytes:
					prepared.compilation.measurements.publicDeclarationBytes,
				typescriptInstantiations:
					prepared.compilation.measurements.typescriptInstantiations,
			};
			for (const [name, metric] of Object.entries(scenario.metrics)) {
				expect(
					measurements[name as keyof typeof measurements],
				).toBeLessThanOrEqual(metric.budget);
				expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
					metric.budget,
				);
			}
			for (const [name, derivation] of Object.entries(
				baseline.budgetDerivation,
			))
				expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
					derivedBudget(derivation),
				);

			console.log(
				JSON.stringify({
					scenario: "beta08-durable-worker",
					budgetOwner: "BETA-08",
					evidenceClass:
						process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
						baseline.reference.runnerClass,
					postgresMajor: 17,
					measurements,
					status: "PASS",
				}),
			);
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);
