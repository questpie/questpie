import { SQL } from "bun";
import { principal } from "questpie";

import { projectLiveQueryCompilation } from "../../packages/compiler/src/live-query";
import { backendPid } from "../../packages/compiler/src/postgres-session";
import { ensureInternalProtocolV3 } from "../../packages/compiler/src/schema";
import { createPostgresLiveQueryCoordinator } from "../../packages/runtime/src/application/realtime";
import {
	canonicalJsonLine,
	sha256Digest,
} from "../../packages/runtime/src/canonical-json";
import {
	linkLiveQueryProgram,
	type ObservedLiveQueryPlanV1,
	type PostgresWakeTickSource,
} from "../../packages/runtime/src/live-query";
import baseline from "../../quality/baselines/beta07-recompute-fanout.json";
import scenario from "../../quality/performance/beta07-recompute-fanout.json";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("BETA-07 recompute load requires PostgreSQL configuration");

// The performance manifest invokes this entrypoint outside correctness discovery.

const application = "beta07RecomputeLoad";
const deploymentDigest = "a".repeat(64);
const authorityDigest = "b".repeat(64);
const inputDigest = "c".repeat(64);
const watches = 2_050;
const sql = new SQL({ max: 1 });

const projection = projectLiveQueryCompilation({
	resources: [],
	contextProjection: {},
	dataProjection: {},
	policyProjection: {},
	queryProjection: {},
});
const program = linkLiveQueryProgram({
	watchability: projection.artifacts["query-watchability.json"],
	dependencyAlgebra: projection.artifacts["live-query-dependency-algebra.json"],
	changeLedger: projection.artifacts["change-ledger.json"],
	reconciliation: projection.artifacts["change-reconciliation.json"],
	resume: projection.artifacts["live-query-resume.json"],
	captureBoundary: projection.artifacts["change-capture-boundary.json"],
	limits: projection.artifacts["live-query-limits.json"],
});

function dormantTicks(): PostgresWakeTickSource {
	return {
		armInterval() {
			return () => {};
		},
		armDeadline() {
			return () => {};
		},
	};
}

function observedPlan(): ObservedLiveQueryPlanV1 {
	const unsigned = {
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
	return Object.freeze({
		...unsigned,
		digest: sha256Digest(
			Buffer.concat([
				Buffer.from("questpie-observed-live-query-plan-v1\0"),
				canonicalJsonLine(unsigned),
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

let coordinator:
	| ReturnType<typeof createPostgresLiveQueryCoordinator>
	| undefined;
try {
	await sql.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	const [database] = await sql<{ name: string; major: number }[]>`
		select current_database() as name,
		       current_setting('server_version_num')::integer / 10000 as major
	`;
	if (database?.major !== 17)
		throw new Error(
			`BETA-07 recompute load requires PostgreSQL 17, got ${database?.major}`,
		);
	await ensureInternalProtocolV3(sql, database.name, await backendPid(sql), {
		lockTimeoutMs: 1_000,
		statementTimeoutMs: 120_000,
	});
	coordinator = createPostgresLiveQueryCoordinator({
		program,
		sql,
		hmacKey: new Uint8Array(32).fill(17),
		applicationName: application,
		deploymentDigest,
		wireVersion: 1,
		tickSource: dormantTicks(),
	});
	await coordinator.start();

	const plan = observedPlan();
	const waves: number[] = [];
	let activeWave = 0;
	let waveScheduled = false;
	const attachments = Array.from({ length: watches }, (_, index) => {
		const identity = index + 1;
		return Object.freeze({
			scopeId: `scope:load:${identity}`,
			principal: principal.user({ id: `principal:load:${identity}` }),
			prepare() {
				return Object.freeze({
					authorityPartitionDigest: authorityDigest,
					async evaluate() {
						activeWave += 1;
						if (!waveScheduled) {
							waveScheduled = true;
							queueMicrotask(() => {
								waves.push(activeWave);
								activeWave = 0;
								waveScheduled = false;
							});
						}
						return { payload: { identity }, observedPlan: plan };
					},
				});
			},
			publish() {
				return true;
			},
			publishFailure() {
				return true;
			},
			synchronize() {},
		});
	});
	const attached = await Promise.all(
		attachments.map((attachment) => coordinator!.durable!.attach(attachment)),
	);
	if (!attached.every(Boolean))
		throw new Error("load attachments were rejected");
	await coordinator.durable!.requestScan();

	await sql`
		update questpie_internal.realtime_scope_attachments
		set authority_partition_digest = ${authorityDigest}, state = 'open'
		where application_name = ${application}
	`;
	await sql`
		insert into questpie_internal.realtime_watch_bindings
		(application_name, scope_identity, binding_identity, deployment_digest,
		 authority_partition_digest, principal_kind, principal_id, active_slot,
		 query_identity, query_bytes, input_bytes, input_digest, context_input_bytes,
		 wire_version, resume_requested, requested_resume_token, state)
		select ${application}, 'scope:load:' || candidate::text,
		       'binding:load:' || candidate::text, ${deploymentDigest}, ${authorityDigest},
		       'user', 'principal:load:' || candidate::text, 1, 'messages.page',
		       ${new TextEncoder().encode('"query:messages.page"\n')},
		       ${new TextEncoder().encode("{}\n")}, ${inputDigest},
		       ${new TextEncoder().encode("{}\n")}, 1, false, null, 'open'
		from pg_catalog.generate_series(1, ${watches}) candidate
	`;

	const started = performance.now();
	await coordinator.durable!.requestScan();
	const postgresRecompute2050Ms = performance.now() - started;
	await Promise.resolve();
	const [result] = await sql<{ count: number }[]>`
		select count(*)::integer as count
		from questpie_internal.realtime_watch_bindings
		where application_name = ${application}
		  and evaluated_invalidation_generation = invalidation_generation
	`;
	if (JSON.stringify(waves) !== JSON.stringify([1_024, 1_024, 2]))
		throw new Error(`unexpected recompute waves ${JSON.stringify(waves)}`);
	if (result?.count !== watches)
		throw new Error(`expected ${watches} recomputes, got ${result?.count}`);
	if (
		baseline.budgets.postgresRecompute2050Ms !==
		derivedBudget(baseline.budgetDerivation.postgresRecompute2050Ms)
	)
		throw new Error("recompute load budget derivation drifted");
	if (
		scenario.metrics.postgresRecompute2050Ms.budget !==
			baseline.budgets.postgresRecompute2050Ms ||
		postgresRecompute2050Ms > scenario.metrics.postgresRecompute2050Ms.budget
	)
		throw new Error(
			`recompute load ${postgresRecompute2050Ms.toFixed(3)}ms exceeds ${scenario.metrics.postgresRecompute2050Ms.budget}ms`,
		);
	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
				baseline.reference.runnerClass,
			postgresMajor: database.major,
			workProof: { watches, waves, recomputed: result.count },
			measurements: { postgresRecompute2050Ms },
			status: "PASS",
		}),
	);
} finally {
	await coordinator?.drain().catch(() => {});
	await sql
		.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE")
		.catch(() => {});
	await sql.close({ timeout: 0 });
}
