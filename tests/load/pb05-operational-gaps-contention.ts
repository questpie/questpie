import { SQL } from "bun";

import {
	createPostgresDatabase,
	definePostgresStatement,
} from "../../packages/runtime/src/postgres";
import scenario from "../../quality/performance/pb05-operational-gaps-contention.json";
import {
	assertPb05OperationalMetrics,
	assertPb05OperationalSchemaReset,
	withPb05ReleasedBlocker,
} from "../support/pb05-operational-load-safety";
import {
	createPb05OperationalMeasurement,
	instrumentPb05OwnedTransaction,
	instrumentPb05TransactionRunner,
} from "../support/pb05-operational-measurement";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("PB-05 operational measurement requires PostgreSQL");

const warmupIdleGaps = 16;
const measuredIdleGaps = 64;
const contentionSamples = 32;
const controlledHoldMs = 25;
const runId = crypto.randomUUID();
const durableRunId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const application = "pb05OperationalMeasurement";
const consumer = "realtime:pb05-operational-measurement";
const authorityPartition = "a".repeat(64);
const retentionLockIdentity = `questpie-retained-result-v1:${application}:${authorityPartition}`;

function postgresUrl(applicationName: string): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST!;
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER!;
	url.pathname = `/${process.env.PGDATABASE!}`;
	url.searchParams.set("application_name", applicationName);
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function nearestRank(values: readonly number[], percentile: number): number {
	if (values.length === 0) throw new Error("cannot summarize zero samples");
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function distribution(values: readonly number[]) {
	return Object.freeze({
		count: values.length,
		p50Ms: nearestRank(values, 0.5),
		p95Ms: nearestRank(values, 0.95),
		p99Ms: nearestRank(values, 0.99),
		maxMs: Math.max(...values),
	});
}

const markerStart = definePostgresStatement({
	name: "pb05.measurement.marker.start",
	text: "SELECT 1",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});
const markerFinish = definePostgresStatement({
	name: "pb05.measurement.marker.finish",
	text: "SELECT 1",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});
const maintenanceLock = definePostgresStatement({
	name: "durable.maintenance.run.read-locked",
	text: `/* pb05-wait-maintenance */
SELECT run_id
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2::uuid
FOR UPDATE`,
	parameterCount: 2,
	parameters: (input: Readonly<{ application: string; runId: string }>) => [
		input.application,
		input.runId,
	],
	decode: () => undefined,
});
const reconciliationLock = definePostgresStatement({
	name: "live-query.reconciliation-horizon-read",
	text: `/* pb05-wait-reconciliation */
SELECT xid_horizon
FROM questpie_internal.reconciliation_consumers
WHERE application_name = $1 AND consumer_id = $2
FOR UPDATE`,
	parameterCount: 2,
	parameters: (input: Readonly<{ application: string; consumer: string }>) => [
		input.application,
		input.consumer,
	],
	decode: () => undefined,
});
const retentionLock = definePostgresStatement({
	name: "live-query.retention-authority-lock",
	text: `/* pb05-wait-retention */
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))`,
	parameterCount: 1,
	parameters: (identity: string) => [identity],
	decode: () => undefined,
});

type ContentionOwner = "maintenance" | "reconciliation" | "retention";
type ContentionSample = Readonly<{
	waitMs: number;
	settleMs: number;
	totalMs: number;
}>;

const admin = new SQL({ url: postgresUrl("pb05-operational-admin"), max: 4 });
const database = createPostgresDatabase({
	connectionUrl: postgresUrl("pb05-operational-waiter"),
	directConnectionUrl: postgresUrl("pb05-operational-direct"),
	pool: {
		max: 2,
		connectTimeoutMs: 2_000,
		checkoutTimeoutMs: 2_000,
		idleTimeoutMs: 5_000,
		maxLifetimeSeconds: 60,
	},
	timeouts: {
		statementMs: 5_000,
		lockMs: 2_000,
		idleInTransactionMs: 5_000,
	},
});
const measurement = createPb05OperationalMeasurement();
const observedDatabases = Object.freeze({
	mutation: instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "mutation",
		operation: "fresh",
	}),
	reconciliation: instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "realtime",
		operation: "reconciliation",
	}),
	maintenance: instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "durable",
		operation: "maintenance",
	}),
	retention: instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "realtime",
		operation: "retention",
	}),
});
const mutationGaps: number[] = [];
const realtimeGaps: number[] = [];
const contention: Record<ContentionOwner, ContentionSample[]> = {
	maintenance: [],
	reconciliation: [],
	retention: [],
};
let semanticFailures = 0;
let lockWaitProofFailures = 0;

async function idleGap(
	population: "mutation" | "realtime",
	operation: "fresh" | "reconciliation",
	phase: "handler" | "apply",
	delayMs: number,
	record: boolean,
): Promise<number> {
	const measured =
		population === "mutation"
			? observedDatabases.mutation
			: observedDatabases.reconciliation;
	return measured.transaction({
		mode:
			population === "mutation"
				? { isolation: "readCommitted", access: "readWrite" }
				: { isolation: "repeatableRead", access: "readWrite" },
		async use(transaction) {
			await transaction.execute(markerStart, undefined);
			const phaseTransaction =
				population === "realtime"
					? instrumentPb05OwnedTransaction({
							transaction,
							measurement,
							population: "realtime",
							operation: "apply",
						})
					: transaction;
			const startedAtMs = performance.now();
			await Bun.sleep(delayMs);
			const finishedAtMs = performance.now();
			if (record)
				measurement.idleGap({
					population,
					operation: population === "realtime" ? "apply" : operation,
					phase,
					startedAtMs,
					finishedAtMs,
				});
			await phaseTransaction.execute(markerFinish, undefined);
			return finishedAtMs - startedAtMs;
		},
	});
}

async function waitForLock(marker: string): Promise<void> {
	const deadline = performance.now() + 2_000;
	while (performance.now() < deadline) {
		const rows = await admin.unsafe<readonly Readonly<{ waiting: boolean }>[]>(
			`SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE application_name = 'pb05-operational-waiter'
    AND wait_event_type = 'Lock'
    AND query LIKE $1
) AS waiting`,
			[`%${marker}%`],
		);
		if (rows[0]?.waiting) return;
		await Bun.sleep(5);
	}
	lockWaitProofFailures += 1;
	throw new Error(`${marker} did not expose a PostgreSQL lock waiter`);
}

async function contentionSample(owner: ContentionOwner): Promise<void> {
	const blockerReady = Promise.withResolvers<void>();
	const releaseBlocker = Promise.withResolvers<void>();
	const blocker = admin
		.begin(async (transaction) => {
			await transaction.unsafe(
				"SET LOCAL statement_timeout = 2000; SET LOCAL lock_timeout = 2000",
			);
			if (owner === "maintenance")
				await transaction.unsafe(
					`SELECT run_id FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2::uuid FOR UPDATE`,
					[application, durableRunId],
				);
			else if (owner === "reconciliation")
				await transaction.unsafe(
					`SELECT xid_horizon FROM questpie_internal.reconciliation_consumers
WHERE application_name = $1 AND consumer_id = $2 FOR UPDATE`,
					[application, consumer],
				);
			else
				await transaction.unsafe(
					"SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))",
					[retentionLockIdentity],
				);
			blockerReady.resolve();
			await releaseBlocker.promise;
		})
		.catch((error) => {
			blockerReady.reject(error);
			throw error;
		});
	void blocker.catch(() => undefined);
	let startedAtMs = Number.NaN;
	let acquiredAtMs = Number.NaN;
	let finishedAtMs = Number.NaN;
	let operation: Promise<void> | undefined;
	await withPb05ReleasedBlocker({
		work: async () => {
			await blockerReady.promise;
			startedAtMs = performance.now();
			const measured = observedDatabases[owner];
			operation = measured
				.transaction({
					mode: {
						isolation:
							owner === "reconciliation" ? "repeatableRead" : "readCommitted",
						access: "readWrite",
					},
					use: (transaction) =>
						owner === "maintenance"
							? transaction.execute(maintenanceLock, {
									application,
									runId: durableRunId,
								})
							: owner === "reconciliation"
								? transaction.execute(reconciliationLock, {
										application,
										consumer,
									})
								: transaction.execute(retentionLock, retentionLockIdentity),
				})
				.then(() => {
					finishedAtMs = performance.now();
				});
			void operation.catch(() => undefined);
			await waitForLock(`pb05-wait-${owner}`);
			await Bun.sleep(controlledHoldMs);
			acquiredAtMs = performance.now();
		},
		release: () => releaseBlocker.resolve(),
		settlements: () => (operation ? [blocker, operation] : [blocker]),
		workTimeoutMs: 2_500,
		settlementTimeoutMs: 5_000,
	});
	measurement.contention({
		owner,
		lockIdentity:
			owner === "maintenance"
				? `${application}:${durableRunId}`
				: owner === "reconciliation"
					? `${application}:${consumer}`
					: retentionLockIdentity,
		startedAtMs,
		acquiredAtMs,
		finishedAtMs,
		outcome: "acquired",
	});
	contention[owner].push(
		Object.freeze({
			waitMs: acquiredAtMs - startedAtMs,
			settleMs: finishedAtMs - acquiredAtMs,
			totalMs: finishedAtMs - startedAtMs,
		}),
	);
}

let runFailed = false;
let primary: unknown;
let schemaOwned = false;
try {
	const [version] = await admin.unsafe<
		readonly Readonly<{ serverVersionNum: string; databaseName: string }>[]
	>(
		`SELECT current_setting('server_version_num') AS "serverVersionNum",
       current_database() AS "databaseName"`,
	);
	if (Math.trunc(Number(version?.serverVersionNum) / 10_000) !== 17)
		throw new Error("PB-05 operational runner is not on its asserted PG17 DB");
	assertPb05OperationalSchemaReset({
		database: version?.databaseName,
		resetOptIn: process.env.QUESTPIE_PB05_OPERATIONAL_RESET,
	});
	schemaOwned = true;

	await admin.unsafe(`DROP SCHEMA IF EXISTS questpie_internal CASCADE;
CREATE SCHEMA questpie_internal;`);
	await admin.unsafe(`CREATE TABLE questpie_internal.durable_runs (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  PRIMARY KEY (application_name, run_id)
);
CREATE TABLE questpie_internal.reconciliation_consumers (
  application_name text NOT NULL,
  consumer_id text NOT NULL,
  xid_horizon bigint NOT NULL,
  PRIMARY KEY (application_name, consumer_id)
);
INSERT INTO questpie_internal.durable_runs VALUES
  ('${application}', '${durableRunId}');
INSERT INTO questpie_internal.reconciliation_consumers VALUES
  ('${application}', '${consumer}', 1);`);

	const timerStartedAt = performance.now();
	await admin.unsafe("SELECT pg_catalog.pg_sleep(0.025)");
	const timerControlMs = performance.now() - timerStartedAt;
	if (timerControlMs < 20)
		throw new Error("PB-05 operational timer positive control failed");

	for (let index = 0; index < warmupIdleGaps; index += 1) {
		await idleGap("mutation", "fresh", "handler", 0, false);
		await idleGap("realtime", "reconciliation", "apply", 0, false);
	}
	for (let index = 0; index < measuredIdleGaps; index += 1) {
		mutationGaps.push(
			await idleGap("mutation", "fresh", "handler", controlledHoldMs, true),
		);
		realtimeGaps.push(
			await idleGap(
				"realtime",
				"reconciliation",
				"apply",
				controlledHoldMs,
				true,
			),
		);
	}

	for (const owner of ["maintenance", "reconciliation", "retention"] as const) {
		await contentionSample(owner);
		contention[owner].length = 0;
		for (let index = 0; index < contentionSamples; index += 1)
			await contentionSample(owner);
	}

	const waiting = await admin.unsafe<readonly Readonly<{ count: number }>[]>(
		`SELECT count(*)::integer AS count
FROM pg_catalog.pg_stat_activity
WHERE application_name = 'pb05-operational-waiter'
  AND wait_event_type = 'Lock'`,
	);
	if (waiting[0]?.count !== 0) {
		semanticFailures += 1;
		throw new Error("PB-05 operational runner leaked a lock waiter");
	}
	const snapshot = measurement.snapshot({ requireCompleteInventory: false });
	const snapshotEvidence = Object.freeze({
		mutation: snapshot.populations.mutation,
		realtime: snapshot.populations.realtime,
		durable: snapshot.populations.durable,
		mutationFresh: snapshot.operations["mutation:fresh"],
		realtimeReconciliation: snapshot.operations["realtime:reconciliation"],
		realtimeApply: snapshot.operations["realtime:apply"],
		realtimeRetention: snapshot.operations["realtime:retention"],
		durableMaintenance: snapshot.operations["durable:maintenance"],
		contention: snapshot.contention,
	});
	const expectedIdleTransactions = warmupIdleGaps + measuredIdleGaps;
	const expectedContendedTransactions = contentionSamples + 1;
	if (
		snapshotEvidence.mutationFresh.transactions !== expectedIdleTransactions ||
		snapshotEvidence.realtimeApply.transactions !== expectedIdleTransactions ||
		snapshotEvidence.realtimeReconciliation.transactions !==
			expectedIdleTransactions + expectedContendedTransactions ||
		snapshotEvidence.realtimeRetention.transactions !==
			expectedContendedTransactions ||
		snapshotEvidence.durableMaintenance.transactions !==
			expectedContendedTransactions ||
		snapshotEvidence.mutation.transactions !== expectedIdleTransactions ||
		snapshotEvidence.realtime.transactions !==
			expectedIdleTransactions + expectedContendedTransactions * 2 ||
		snapshotEvidence.durable.transactions !== expectedContendedTransactions ||
		snapshotEvidence.contention.maintenance.samples !==
			expectedContendedTransactions ||
		snapshotEvidence.contention.reconciliation.samples !==
			expectedContendedTransactions ||
		snapshotEvidence.contention.retention.samples !==
			expectedContendedTransactions
	) {
		semanticFailures += 1;
		throw new Error("PB-05 integrated measurement snapshot is inconsistent");
	}

	const metrics = Object.freeze({
		timerControlSamples: 1,
		instrumentationMutationHandlerHoldControlSamples: mutationGaps.length,
		instrumentationRealtimeApplyHoldControlSamples: realtimeGaps.length,
		maintenanceLockShapeControlSamples: contention.maintenance.length,
		reconciliationLockShapeControlSamples: contention.reconciliation.length,
		retentionLockShapeControlSamples: contention.retention.length,
		semanticFailures,
		lockWaitProofFailures,
	});
	assertPb05OperationalMetrics(metrics, scenario.metrics);

	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
				"provisional-internal-local",
			status: "PROVISIONAL_INTERNAL_EVIDENCE",
			publicCeilings: false,
			postgresMajor: 17,
			runId,
			controls: {
				timerControlMs,
				warmupIdleGaps,
				controlledHoldMs,
				contentionWarmupsPerOwner: 1,
				blockerReleaseIsAcquisitionProxy: true,
				idleGapEvidence:
					"instrumentation-positive-control-only; actual Mutation handler and realtime apply evidence remains outstanding",
				contentionEvidence:
					"lock-shape-positive-control-only; actual maintenance, reconciliation, and retention owner-path contention remains outstanding",
			},
			metrics,
			snapshotEvidence,
			distributions: {
				instrumentationMutationHandlerHoldControl: distribution(mutationGaps),
				instrumentationRealtimeApplyHoldControl: distribution(realtimeGaps),
				maintenanceBlockedUntilReleaseProxy: distribution(
					contention.maintenance.map(({ waitMs }) => waitMs),
				),
				reconciliationBlockedUntilReleaseProxy: distribution(
					contention.reconciliation.map(({ waitMs }) => waitMs),
				),
				retentionBlockedUntilReleaseProxy: distribution(
					contention.retention.map(({ waitMs }) => waitMs),
				),
			},
			rawSamples: {
				instrumentationMutationHandlerHoldControl: mutationGaps,
				instrumentationRealtimeApplyHoldControl: realtimeGaps,
				contention,
			},
		}),
	);
} catch (error) {
	runFailed = true;
	primary = error;
}
const cleanupResults: PromiseSettledResult<unknown>[] = [];
cleanupResults.push(
	...(await Promise.allSettled([
		database.close({ deadlineAt: Date.now() + 5_000 }),
	])),
);
if (schemaOwned)
	cleanupResults.push(
		...(await Promise.allSettled([
			admin.unsafe(
				"SET statement_timeout = 5000; DROP SCHEMA IF EXISTS questpie_internal CASCADE",
			),
		])),
	);
cleanupResults.push(
	...(await Promise.allSettled([admin.close({ timeout: 0 })])),
);
const cleanupFailures = cleanupResults.filter(
	(result): result is PromiseRejectedResult => result.status === "rejected",
);
if (runFailed) {
	if (cleanupFailures.length > 0)
		console.error(
			JSON.stringify({
				status: "SUPPRESSED_CLEANUP_FAILURE",
				failures: cleanupFailures.map(({ reason }) => String(reason)),
			}),
		);
	throw primary;
}
if (cleanupFailures.length > 0) throw cleanupFailures[0]!.reason;
