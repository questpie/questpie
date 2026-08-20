import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import baseline from "../../quality/baselines/beta06-mutation-transaction.json";
import scenario from "../../quality/performance/beta06-mutation-transaction.json";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "../integration/postgres/helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

type MutationScope = Readonly<{
	mutations: Readonly<
		Record<
			string,
			(
				input: unknown,
				options: Readonly<{ callId: string }>,
			) => Promise<unknown>
		>
	>;
}>;

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
	"BETA-06 measures committed Mutation transactions through PostgreSQL 17",
	async () => {
		const [version] = await database!.unsafe<
			Readonly<Array<{ serverVersionNum: string }>>
		>(`SELECT current_setting('server_version_num') AS "serverVersionNum"`);
		expect(Math.trunc(Number(version?.serverVersionNum) / 10_000)).toBe(17);
		if (process.env.QUESTPIE_POSTGRES_MAJOR)
			expect(process.env.QUESTPIE_POSTGRES_MAJOR).toBe("17");
		const recordedSamples = [...baseline.samples.postgresExecute20Ms].sort(
			(left, right) => left - right,
		);
		expect(recordedSamples).toHaveLength(baseline.reference.samples);
		expect(baseline.observed.postgresExecute20Ms).toBe(recordedSamples[1]);

		const prepared = await prepareBeta05PostgresApplication(database!);
		let application: Readonly<{
			execution(
				input: unknown,
				run: (scope: MutationScope) => Promise<unknown>,
			): Promise<unknown>;
			close(): Promise<void>;
		}> | null = null;
		try {
			application = await prepared.generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
			});
			const user = prepared.generated.framework.principal.user({
				id: beta05Ids.principal,
			});
			const context = { companyId: beta05Ids.company };
			const publish = (index: number) =>
				application!.execution(
					{ principal: user, context },
					(scope: MutationScope) =>
						scope.mutations["message.publish"]!(
							{
								channelId: beta05Ids.channel,
								body: `measured transaction ${index}`,
							},
							{ callId: crypto.randomUUID() },
						),
				);

			await publish(-1);
			const started = performance.now();
			const results: unknown[] = [];
			for (let index = 0; index < 20; index += 1)
				results.push(await publish(index));
			const postgresExecute20Ms = performance.now() - started;
			const maxResultBytes = Math.max(
				...results.map((result) =>
					Buffer.byteLength(JSON.stringify(result), "utf8"),
				),
			);
			const [rows] = await database!.unsafe<
				Readonly<
					Array<{
						audits: number;
						intents: number;
						messages: number;
						receipts: number;
					}>
				>
			>(`SELECT
  (SELECT count(*)::int FROM collaboration.message_events) AS audits,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents) AS intents,
  (SELECT count(*)::int FROM collaboration.messages) AS messages,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts) AS receipts`);
			expect(rows).toEqual({
				audits: 21,
				intents: 21,
				messages: 22,
				receipts: 21,
			});

			const measurements = {
				postgresExecute20Ms,
				maxResultBytes,
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
					scenario: "beta06-mutation-transaction",
					budgetOwner: "BETA-06",
					evidenceClass:
						process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
						baseline.reference.runnerClass,
					postgresMajor: 17,
					measurements,
					status: "PASS",
				}),
			);
		} finally {
			await application?.close();
			await prepared.dispose();
		}
	},
	30_000,
);
