import { SQL } from "bun";

import scenario from "../../quality/performance/pb05-durable-workload-envelope.json";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "../integration/postgres/helpers/beta08-durable";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("PB-05 Durable workload measurement requires PostgreSQL");

const warmupRuns = 100;
const measuredRuns = 1_000;
const seededRuns = warmupRuns + measuredRuns;
const effectName = "deliver-message";

type Population =
	| "claim"
	| "heartbeat"
	| "effectReserve"
	| "effectSettle"
	| "terminalSucceed";

type RawSample = Readonly<{
	ordinal: number;
	runId: string;
	durationMs: number;
}>;

type SeededRun = Readonly<{
	callId: string;
	messageId: string;
	runId: string;
}>;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST!;
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER!;
	url.pathname = `/${process.env.PGDATABASE!}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function nearestRank(values: readonly number[], percentile: number): number {
	if (values.length === 0) throw new Error("cannot summarize zero samples");
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function distribution(samples: readonly RawSample[]) {
	const values = samples.map(({ durationMs }) => durationMs);
	return Object.freeze({
		count: values.length,
		p50Ms: nearestRank(values, 0.5),
		p95Ms: nearestRank(values, 0.95),
		p99Ms: nearestRank(values, 0.99),
		maxMs: Math.max(...values),
	});
}

function assertDuration(durationMs: number, population: Population): void {
	if (!Number.isFinite(durationMs) || durationMs < 0)
		throw new Error(`${population} produced an invalid duration`);
}

const database = new SQL({ url: postgresUrl(), max: 4 });
const rawSamples: Record<Population, RawSample[]> = {
	claim: [],
	heartbeat: [],
	effectReserve: [],
	effectSettle: [],
	terminalSucceed: [],
};

try {
	const [version] = await database.unsafe<
		readonly Readonly<{ serverVersionNum: string }>[]
	>("SELECT current_setting('server_version_num') AS \"serverVersionNum\"");
	if (Math.trunc(Number(version?.serverVersionNum) / 10_000) !== 17)
		throw new Error(
			"PB-05 Durable workload measurement requires PostgreSQL 17",
		);
	if (
		process.env.QUESTPIE_POSTGRES_MAJOR &&
		process.env.QUESTPIE_POSTGRES_MAJOR !== "17"
	)
		throw new Error("QUESTPIE_POSTGRES_MAJOR must be 17");

	const clockStarted = performance.now();
	await database.unsafe("SELECT pg_catalog.pg_sleep(0.025)");
	const clockControlMs = performance.now() - clockStarted;
	if (clockControlMs < 20)
		throw new Error(
			"the Durable workload timer did not observe PostgreSQL work",
		);

	const prepared = await beta08Harness(database);
	const prefix = `pb05-durable-envelope-${crypto.randomUUID()}`;
	const published = new Map<string, string>();
	for (let index = 0; index < seededRuns; index += 1) {
		const callId = `${prefix}-${String(index).padStart(4, "0")}`;
		const messageId = await prepared.app.execution(
			{
				principal: prepared.principal,
				context: { companyId: beta05Ids.company },
			},
			({ mutations }) =>
				mutations.message.publish(
					{
						channelId: beta05Ids.channel,
						body: `PB-05 Durable envelope ${index}`,
					},
					{ callId },
				),
		);
		published.set(callId, messageId.id);
	}

	const rows = await database.unsafe<
		readonly Readonly<{
			callId: string;
			runId: string;
			state: string;
			attemptCount: number;
		}>[]
	>(
		`SELECT intents.call_id AS "callId", runs.run_id::text AS "runId",
       runs.state, runs.attempt_count AS "attemptCount"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration'
  AND intents.call_id LIKE $1
ORDER BY intents.call_id`,
		[`${prefix}-%`],
	);
	if (
		rows.length !== seededRuns ||
		new Set(rows.map(({ runId }) => runId)).size !== seededRuns ||
		rows.some(
			({ state, attemptCount }) => state !== "ready" || attemptCount !== 0,
		)
	)
		throw new Error(
			"Durable workload preseed does not contain exact ready runs",
		);
	const runs: SeededRun[] = rows.map(({ callId, runId }) => {
		const messageId = published.get(callId);
		if (!messageId) throw new Error(`missing published Message for ${callId}`);
		return Object.freeze({ callId, messageId, runId });
	});
	// Seeding exercises the generated surface, but its compatibility SQL owner is
	// not part of this private-kernel measurement. Close it before the first timed
	// call so the measured phase has only the SQL owner passed to kernel/ledger.
	await prepared.app.close();

	const resultEncoder = new TextEncoder();
	let heartbeatLeaseExtensionMs: number | undefined;
	for (const [index, run] of runs.entries()) {
		const measured = index >= warmupRuns;
		const ordinal = index - warmupRuns;
		const sample = async <Value>(
			population: Population,
			work: () => Promise<Value>,
		): Promise<Value> => {
			const started = performance.now();
			const value = await work();
			const durationMs = performance.now() - started;
			assertDuration(durationMs, population);
			if (measured)
				rawSamples[population].push(
					Object.freeze({ ordinal, runId: run.runId, durationMs }),
				);
			return value;
		};

		const claimed = await sample("claim", () =>
			prepared.kernel.claim({
				runId: run.runId,
				workerId: "worker:pb05-durable-envelope",
			}),
		);
		if (claimed.status !== "claimed" || claimed.claim.attemptNumber !== 1)
			throw new Error(`Durable claim did not win ${run.runId}`);
		if (index === 0) await Bun.sleep(10);

		const heartbeat = await sample("heartbeat", () =>
			prepared.kernel.heartbeat(claimed.claim),
		);
		if (
			heartbeat.status !== "held" ||
			heartbeat.cancellationRequested ||
			heartbeat.deadlineExpired
		)
			throw new Error(`Durable heartbeat did not retain ${run.runId}`);
		if (index === 0) {
			const [lease] = await database.unsafe<
				readonly Readonly<{
					runLeaseExpiresAt: Date;
					attemptLeaseExpiresAt: Date;
					heartbeatAt: Date;
					startedAt: Date;
				}>[]
			>(
				`SELECT runs.lease_expires_at AS "runLeaseExpiresAt",
       attempts.lease_expires_at AS "attemptLeaseExpiresAt",
       attempts.heartbeat_at AS "heartbeatAt", attempts.started_at AS "startedAt"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.durable_attempts AS attempts
  ON attempts.application_name = runs.application_name
 AND attempts.attempt_id = runs.current_attempt_id
WHERE runs.application_name = 'application:collaboration' AND runs.run_id = $1`,
				[run.runId],
			);
			if (
				!lease ||
				lease.runLeaseExpiresAt.getTime() !==
					lease.attemptLeaseExpiresAt.getTime() ||
				lease.attemptLeaseExpiresAt <= claimed.claim.leaseExpiresAt ||
				lease.heartbeatAt <= lease.startedAt
			)
				throw new Error("Durable heartbeat did not extend the known lease");
			heartbeatLeaseExtensionMs =
				lease.attemptLeaseExpiresAt.getTime() -
				claimed.claim.leaseExpiresAt.getTime();
		}

		const reservation = await sample("effectReserve", () =>
			prepared.ledger.reserve(claimed.claim, {
				effectName,
				input: { messageId: run.messageId },
			}),
		);
		if (reservation.status !== "reserved")
			throw new Error(`Durable effect was not newly reserved for ${run.runId}`);
		const receipt = `delivery:${reservation.effectId}`;
		const settled = await sample("effectSettle", () =>
			prepared.ledger.settle(claimed.claim, { effectName, receipt }),
		);
		if (settled !== "applied")
			throw new Error(`Durable effect did not settle for ${run.runId}`);

		const resultBytes = resultEncoder.encode(
			JSON.stringify({
				deliveryReceipt: receipt,
				eventId: crypto.randomUUID(),
				messageId: run.messageId,
			}),
		);
		const terminal = await sample("terminalSucceed", () =>
			prepared.kernel.succeed(claimed.claim, resultBytes),
		);
		if (
			terminal.status !== "applied" ||
			terminal.state !== "succeeded" ||
			terminal.deadLetter
		)
			throw new Error(`Durable terminal transition failed for ${run.runId}`);
	}

	const [finalState] = await database.unsafe<
		readonly Readonly<{
			runs: number;
			succeededRuns: number;
			attempts: number;
			succeededAttempts: number;
			effects: number;
			succeededEffects: number;
			invalidEffects: number;
			events: number;
			acceptedEvents: number;
			attemptStartedEvents: number;
			effectSettledEvents: number;
			succeededEvents: number;
		}>[]
	>(
		`WITH measured_runs AS (
  SELECT runs.run_id, runs.state
  FROM questpie_internal.durable_runs AS runs
  JOIN questpie_internal.pending_reaction_intents AS intents
    ON intents.application_name = runs.application_name
   AND intents.record_id = runs.dispatch_id
  WHERE runs.application_name = 'application:collaboration'
    AND intents.call_id LIKE $1
), measured_attempts AS (
  SELECT attempts.*
  FROM questpie_internal.durable_attempts AS attempts
  JOIN measured_runs ON measured_runs.run_id = attempts.run_id
  WHERE attempts.application_name = 'application:collaboration'
), measured_effects AS (
  SELECT effects.*
  FROM questpie_internal.durable_effects AS effects
  JOIN measured_runs ON measured_runs.run_id = effects.run_id
  WHERE effects.application_name = 'application:collaboration'
), measured_events AS (
  SELECT events.*
  FROM questpie_internal.durable_run_events AS events
  JOIN measured_runs ON measured_runs.run_id = events.run_id
  WHERE events.application_name = 'application:collaboration'
)
SELECT
  (SELECT count(*)::int FROM measured_runs) AS runs,
  (SELECT count(*)::int FROM measured_runs WHERE state = 'succeeded') AS "succeededRuns",
  (SELECT count(*)::int FROM measured_attempts) AS attempts,
  (SELECT count(*)::int FROM measured_attempts WHERE outcome = 'succeeded') AS "succeededAttempts",
  (SELECT count(*)::int FROM measured_effects) AS effects,
  (SELECT count(*)::int FROM measured_effects WHERE status = 'succeeded') AS "succeededEffects",
  (SELECT count(*)::int
   FROM measured_effects AS effects
   JOIN measured_attempts AS attempts ON attempts.run_id = effects.run_id
   WHERE effects.status <> 'succeeded'
      OR effects.receipt <> 'delivery:' || effects.effect_id::text
      OR effects.reserved_attempt_id <> attempts.attempt_id
      OR effects.settled_attempt_id <> attempts.attempt_id) AS "invalidEffects",
  (SELECT count(*)::int FROM measured_events) AS events,
  (SELECT count(*)::int FROM measured_events WHERE kind = 'accepted') AS "acceptedEvents",
  (SELECT count(*)::int FROM measured_events WHERE kind = 'attemptStarted') AS "attemptStartedEvents",
  (SELECT count(*)::int FROM measured_events WHERE kind = 'effectSettled') AS "effectSettledEvents",
  (SELECT count(*)::int FROM measured_events WHERE kind = 'succeeded') AS "succeededEvents"`,
		[`${prefix}-%`],
	);
	const expectedFinalState = {
		runs: seededRuns,
		succeededRuns: seededRuns,
		attempts: seededRuns,
		succeededAttempts: seededRuns,
		effects: seededRuns,
		succeededEffects: seededRuns,
		invalidEffects: 0,
		events: seededRuns * 4,
		acceptedEvents: seededRuns,
		attemptStartedEvents: seededRuns,
		effectSettledEvents: seededRuns,
		succeededEvents: seededRuns,
	};
	if (JSON.stringify(finalState) !== JSON.stringify(expectedFinalState))
		throw new Error(
			`Durable workload final state is incomplete: ${JSON.stringify(finalState)}`,
		);

	const measurements = Object.freeze({
		seededRuns,
		warmupRuns,
		measuredRuns,
		claimSamples: rawSamples.claim.length,
		heartbeatSamples: rawSamples.heartbeat.length,
		effectReserveSamples: rawSamples.effectReserve.length,
		effectSettleSamples: rawSamples.effectSettle.length,
		terminalSucceedSamples: rawSamples.terminalSucceed.length,
		completedRuns: finalState.succeededRuns,
	});
	for (const [population, samples] of Object.entries(rawSamples)) {
		if (
			samples.length !== measuredRuns ||
			new Set(samples.map(({ runId }) => runId)).size !== measuredRuns
		)
			throw new Error(
				`${population} does not contain exactly ${measuredRuns} distinct measured runs`,
			);
	}
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		const measured = measurements[name as keyof typeof measurements];
		if (metric.direction === "min" && measured < metric.budget)
			throw new Error(`${name} ${measured} is below ${metric.budget}`);
		if (metric.direction === "max" && measured > metric.budget)
			throw new Error(`${name} ${measured} exceeds ${metric.budget}`);
	}

	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ?? "reference-local",
			postgresMajor: 17,
			measurementBoundary:
				"client-observed Durable transaction envelopes; not individual PostgreSQL statements",
			heartbeatMeasurementBoundary:
				"immediate held-lease heartbeat; the 10 ms lease-extension witness is an untimed control",
			exclusions: [
				"statement-timeout selection",
				"expired-lease reclaim and retry",
				"fencing, cancellation, and failure",
				"ambiguous and recovered effects",
				"generated worker end-to-end",
				"maintenance and audit",
				"maximum payload",
				"contention and saturation",
				"generated Runtime PostgreSQL ownership",
			],
			workProof: {
				invocationRuns: 1,
				clockControlMs,
				heartbeatLeaseExtensionMs,
				exactDistinctPreseedRunIds: runs.length,
				generatedApplicationClosedBeforeTiming: true,
				allRunsCompleted: true,
				finalState,
			},
			measurements,
			distributions: Object.fromEntries(
				Object.entries(rawSamples).map(([population, samples]) => [
					population,
					distribution(samples),
				]),
			),
			rawSamples,
			status: "PASS",
		}),
	);
} finally {
	await disposeBeta08Harness();
	await database.close({ timeout: 0 });
}
