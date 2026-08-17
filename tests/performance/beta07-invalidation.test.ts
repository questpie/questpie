import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import { compileApplication } from "@questpie/compiler";

import { backendPid } from "../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV3,
	projectPostgresChangeCapture,
} from "../../packages/compiler/src/schema";
import {
	canonicalJsonLine,
	sha256Digest,
} from "../../packages/runtime/src/canonical-json";
import {
	createPostgresLiveQueryInvalidationEffect,
	reconcilePostgresChangeLedger,
} from "../../packages/runtime/src/live-query";
import baseline from "../../quality/baselines/beta07-invalidation.json";
import scenario from "../../quality/performance/beta07-invalidation.json";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const application = "beta07Performance";
const deploymentDigest = "7".repeat(64);
const authorityDigest = "a".repeat(64);
const inputDigest = "b".repeat(64);
const activeWatches = 64;
const measuredChanges = 20;
const projection = projectPostgresChangeCapture({
	applicationName: application,
	postgresSchema: "beta07_performance",
	collections: [
		{
			identity: "collection:messages",
			postgresName: "messages",
			keyColumns: ["id"],
		},
	],
});

function observedPlanBytes(): Uint8Array {
	const plan = {
		format: "questpie.observed-live-query-plan" as const,
		version: 1 as const,
		query: "query:messages.page",
		tokens: [
			{
				kind: "collectionRange" as const,
				collection: "collection:messages",
				detail: { conservative: true },
			},
		],
	};
	return canonicalJsonLine({
		...plan,
		digest: sha256Digest(
			Buffer.concat([
				Buffer.from("questpie-observed-live-query-plan-v1\0"),
				canonicalJsonLine(plan),
			]),
		),
	});
}

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

function derivedSizeBudget(
	input: Readonly<{
		referenceObservedBytes: number;
		multiplier: number;
		roundUpQuantumBytes: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedBytes * input.multiplier) /
				input.roundUpQuantumBytes,
		) * input.roundUpQuantumBytes
	);
}

async function installFixture(planBytes: Uint8Array): Promise<void> {
	await database!.unsafe(`DROP SCHEMA IF EXISTS beta07_performance CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	const [current] = await database!<readonly { name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV3(
		database!,
		current!.name,
		await backendPid(database!),
		{ lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 },
	);
	await database!.unsafe(`CREATE SCHEMA beta07_performance;
CREATE TABLE beta07_performance.messages (
  id text PRIMARY KEY,
  body text NOT NULL
);`);
	await database!.unsafe(projection.sql);

	for (let index = 0; index < activeWatches; index += 1) {
		const scope = `scope:${index}`;
		const binding = `binding:${index}`;
		await database!`
			insert into questpie_internal.realtime_scope_attachments
			(application_name, scope_identity, deployment_digest,
			 authority_partition_digest, principal_kind, principal_id, state)
			values (${application}, ${scope}, ${deploymentDigest},
			        ${authorityDigest}, 'user', 'principal:measured', 'open')
		`;
		await database!`
			insert into questpie_internal.realtime_watch_bindings
			(application_name, scope_identity, binding_identity, deployment_digest,
			 authority_partition_digest, principal_kind, principal_id, active_slot,
			 query_identity, query_bytes, input_bytes, input_digest,
			 context_input_bytes, wire_version, resume_requested, state)
			values (${application}, ${scope}, ${binding}, ${deploymentDigest},
			        ${authorityDigest}, 'user', 'principal:measured', ${index + 1},
			        'messages.page', ${new TextEncoder().encode('"query:messages.page"\n')},
			        ${new TextEncoder().encode("{}\n")}, ${inputDigest},
			        ${new TextEncoder().encode("{}\n")}, 1, false, 'open')
		`;
		await database!`
			insert into questpie_internal.observed_dependency_plans
			(application_name, scope_identity, binding_identity, deployment_digest,
			 authority_partition_digest, query_identity, input_digest, wire_version,
			 retained_generation, plan_digest, plan_bytes)
			values (${application}, ${scope}, ${binding}, ${deploymentDigest},
			        ${authorityDigest}, 'messages.page', ${inputDigest}, 1, 1,
			        ${sha256Digest(planBytes)}, ${planBytes})
		`;
	}
}

async function generationTotal(): Promise<bigint> {
	const [row] = await database!<readonly { total: string }[]>`
		select sum(invalidation_generation)::text as total
		from questpie_internal.realtime_watch_bindings
		where application_name = ${application}
	`;
	return BigInt(row!.total);
}

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS beta07_performance CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await database?.close({ timeout: 0 });
});

postgresTest(
	"BETA-07 measures steady-state PostgreSQL reconciliation and durable invalidation",
	async () => {
		const [server] = await database!<
			readonly { serverVersionNumber: string }[]
		>`select current_setting('server_version_num') as "serverVersionNumber"`;
		expect(Math.trunc(Number(server!.serverVersionNumber) / 10_000)).toBe(17);
		if (process.env.QUESTPIE_POSTGRES_MAJOR)
			expect(process.env.QUESTPIE_POSTGRES_MAJOR).toBe("17");

		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const planBytes = observedPlanBytes();
		await installFixture(planBytes);
		const effect = createPostgresLiveQueryInvalidationEffect({
			deploymentDigest,
			fanoutPerBatch: 1_024,
		});
		const reconcile = () =>
			reconcilePostgresChangeLedger({
				sql: database!,
				application,
				consumer: effect.consumer,
				apply: () => undefined,
				effect,
			});

		await reconcile();
		await database!`
			insert into beta07_performance.messages (id, body)
			values ('warm', 'unmeasured warm reconciliation')
		`;
		const warm = await reconcile();
		expect(warm.facts).toHaveLength(1);
		const generationsBefore = await generationTotal();

		let reconciledFacts = 0;
		let maximumReconciliationResultBytes = 0;
		const started = performance.now();
		for (let index = 0; index < measuredChanges; index += 1) {
			await database!`
				insert into beta07_performance.messages (id, body)
				values (${`measured:${index}`}, ${`measured change ${index}`})
			`;
			const result = await reconcile();
			reconciledFacts += result.facts.length;
			maximumReconciliationResultBytes = Math.max(
				maximumReconciliationResultBytes,
				Buffer.byteLength(JSON.stringify(result)),
			);
		}
		const postgresReconcile20Ms = performance.now() - started;
		const generationsAfter = await generationTotal();

		const [proof] = await database!<
			readonly {
				ledgerFacts: number;
				maximumGeneration: string;
				minimumGeneration: string;
				observedPlans: number;
				processedFacts: number;
				planBytesPerReconciliation: number;
				watches: number;
			}[]
		>`
			select
			  (select count(*)::integer
			   from questpie_internal.change_ledger
			   where application_name = ${application}) as "ledgerFacts",
			  min(watch.invalidation_generation)::text as "minimumGeneration",
			  max(watch.invalidation_generation)::text as "maximumGeneration",
			  count(*)::integer as watches,
			  (select count(*)::integer
			   from questpie_internal.processed_change_facts
			   where application_name = ${application}
			     and consumer_id = ${effect.consumer}) as "processedFacts",
			  (select count(*)::integer
			   from questpie_internal.observed_dependency_plans
			   where application_name = ${application}) as "observedPlans",
			  (select sum(octet_length(plan_bytes))::integer
			   from questpie_internal.observed_dependency_plans
			   where application_name = ${application}) as "planBytesPerReconciliation"
			from questpie_internal.realtime_watch_bindings watch
			where watch.application_name = ${application}
		`;
		const invalidatedWatchRows = Number(generationsAfter - generationsBefore);
		expect(reconciledFacts).toBe(measuredChanges);
		expect(invalidatedWatchRows).toBe(activeWatches * measuredChanges);
		expect(proof).toEqual({
			ledgerFacts: measuredChanges + 1,
			maximumGeneration: String(measuredChanges + 2),
			minimumGeneration: String(measuredChanges + 2),
			observedPlans: activeWatches,
			processedFacts: measuredChanges + 1,
			planBytesPerReconciliation: planBytes.byteLength * activeWatches,
			watches: activeWatches,
		});

		const measurements = {
			postgresReconcile20Ms,
			maximumReconciliationResultBytes,
			observedPlanBytes: planBytes.byteLength,
			planBytesPerReconciliation: proof!.planBytesPerReconciliation,
			publicDeclarationBytes: compilation.measurements.publicDeclarationBytes,
			typescriptInstantiations:
				compilation.measurements.typescriptInstantiations,
		};
		for (const [name, metric] of Object.entries(scenario.metrics)) {
			expect(
				measurements[name as keyof typeof measurements],
			).toBeLessThanOrEqual(metric.budget);
			expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
				metric.budget,
			);
		}
		const recordedSamples = [...baseline.samples.postgresReconcile20Ms].sort(
			(left, right) => left - right,
		);
		expect(recordedSamples).toHaveLength(baseline.reference.samples);
		expect(baseline.observed.postgresReconcile20Ms).toBe(recordedSamples[1]);
		expect(baseline.budgets.postgresReconcile20Ms).toBe(
			derivedBudget(baseline.budgetDerivation.postgresReconcile20Ms),
		);
		expect(baseline.budgets.maximumReconciliationResultBytes).toBe(
			derivedSizeBudget(
				baseline.sizeBudgetDerivation.maximumReconciliationResultBytes,
			),
		);
		expect(baseline.budgets.planBytesPerReconciliation).toBe(
			baseline.budgets.observedPlanBytes * activeWatches,
		);

		console.log(
			JSON.stringify({
				scenario: "beta07-invalidation",
				budgetOwner: "BETA-07",
				evidenceClass:
					process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
					baseline.reference.runnerClass,
				postgresMajor: 17,
				workProof: {
					activeWatches,
					measuredChanges,
					reconciledFacts,
					invalidatedWatchRows,
				},
				measurements,
				status: "PASS",
			}),
		);
	},
	30_000,
);
