import { SQL } from "bun";

import scenario from "../../quality/performance/pb05-mutation-transaction-tail.json";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "../integration/postgres/helpers/beta05-runtime";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("PB-05 Mutation tail measurement requires PostgreSQL");

const warmupPairs = 50;
const measuredPairs = 500;
const runId = crypto.randomUUID();

type SampleKind = "fresh" | "replay";
type MutationInput = Readonly<{ channelId: string; body: string }>;
type Pair = Readonly<{ callId: string; input: MutationInput }>;
type RawSample = Readonly<{
	pair: number;
	kind: SampleKind;
	durationMs: number;
}>;

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

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: unknown,
		use: (scope: MutationScope) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	close(): Promise<void>;
}>;

function pairs(count: number, kind: "warmup" | "measured"): readonly Pair[] {
	return Object.freeze(
		Array.from({ length: count }, (_, index) =>
			Object.freeze({
				callId: `pb05-${kind}-${runId}-${index}`,
				input: Object.freeze({
					channelId: beta05Ids.channel,
					body: `PB-05 ${kind} ${runId} ${index}`,
				}),
			}),
		),
	);
}

type PersistenceCounts = Readonly<{
	audits: number;
	durableEvents: number;
	durableRuns: number;
	intents: number;
	messages: number;
	receipts: number;
}>;

async function persistenceCounts(database: SQL): Promise<PersistenceCounts> {
	const [row] = await database.unsafe<ReadonlyArray<PersistenceCounts>>(
		`SELECT
  (SELECT count(*)::int FROM collaboration.message_events) AS audits,
  (SELECT count(*)::int FROM questpie_internal.durable_run_events) AS "durableEvents",
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS "durableRuns",
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents) AS intents,
  (SELECT count(*)::int FROM collaboration.messages) AS messages,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts) AS receipts`,
	);
	if (!row) throw new Error("Mutation persistence proof returned no row");
	return row;
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

function exactResult(value: unknown): string {
	return JSON.stringify(value);
}

const timerStarted = performance.now();
await Bun.sleep(25);
const timerControlMs = performance.now() - timerStarted;
if (timerControlMs < 20)
	throw new Error(
		`duration instrument failed its positive control: ${timerControlMs}`,
	);

const warmups = pairs(warmupPairs, "warmup");
const measured = pairs(measuredPairs, "measured");
const setup = new SQL({ max: 2 });
let prepared: Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>;
let baseline: PersistenceCounts;
try {
	prepared = await prepareBeta05PostgresApplication(setup);
	baseline = await persistenceCounts(setup);
} finally {
	await setup.close({ timeout: 0 });
}

let application: GeneratedApplication | undefined;
try {
	application = (await prepared.generated.app.createApp({
		postgres: {
			connectionUrl: beta05PostgresUrl(),
			directConnectionUrl: beta05PostgresUrl(),
		},
		realtime: { hmacKey: new Uint8Array(32) },
		maintenance: { authorize: () => true },
	})) as GeneratedApplication;
	const root = Object.freeze({
		principal: prepared.generated.framework.principal.user({
			id: beta05Ids.principal,
		}),
		context: Object.freeze({ companyId: beta05Ids.company }),
	});
	const invoke = (pair: Pair) =>
		application!.execution(root, async (scope) => {
			const started = performance.now();
			const result = await scope.mutations["message.publish"]!(pair.input, {
				callId: pair.callId,
			});
			return Object.freeze({
				durationMs: performance.now() - started,
				result,
			});
		});

	for (const pair of warmups) {
		const fresh = await invoke(pair);
		const replay = await invoke(pair);
		if (exactResult(fresh.result) !== exactResult(replay.result))
			throw new Error("warmup replay result differs from its committed result");
	}

	const rawSamples: RawSample[] = [];
	for (const [index, pair] of measured.entries()) {
		const fresh = await invoke(pair);
		rawSamples.push(
			Object.freeze({
				pair: index,
				kind: "fresh",
				durationMs: fresh.durationMs,
			}),
		);
		const replay = await invoke(pair);
		rawSamples.push(
			Object.freeze({
				pair: index,
				kind: "replay",
				durationMs: replay.durationMs,
			}),
		);
		if (exactResult(fresh.result) !== exactResult(replay.result))
			throw new Error(
				`measured replay ${index} differs from its committed result`,
			);
	}

	await application.close();
	application = undefined;
	const verification = new SQL({ max: 1 });
	let persisted: PersistenceCounts;
	let classified: Readonly<{
		warmupReceipts: number;
		warmupDistinctCallIds: number;
		measuredReceipts: number;
		measuredDistinctCallIds: number;
		warmupMessages: number;
		warmupDistinctBodies: number;
		measuredMessages: number;
		measuredDistinctBodies: number;
	}>;
	try {
		persisted = await persistenceCounts(verification);
		const [row] = await verification.unsafe<ReadonlyArray<typeof classified>>(
			`SELECT
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id LIKE $1) AS "warmupReceipts",
  (SELECT count(DISTINCT call_id)::int FROM questpie_internal.mutation_call_receipts WHERE call_id LIKE $1) AS "warmupDistinctCallIds",
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id LIKE $2) AS "measuredReceipts",
  (SELECT count(DISTINCT call_id)::int FROM questpie_internal.mutation_call_receipts WHERE call_id LIKE $2) AS "measuredDistinctCallIds",
  (SELECT count(*)::int FROM collaboration.messages WHERE body LIKE $3) AS "warmupMessages",
  (SELECT count(DISTINCT body)::int FROM collaboration.messages WHERE body LIKE $3) AS "warmupDistinctBodies",
  (SELECT count(*)::int FROM collaboration.messages WHERE body LIKE $4) AS "measuredMessages",
  (SELECT count(DISTINCT body)::int FROM collaboration.messages WHERE body LIKE $4) AS "measuredDistinctBodies"`,
			[
				`pb05-warmup-${runId}-%`,
				`pb05-measured-${runId}-%`,
				`PB-05 warmup ${runId} %`,
				`PB-05 measured ${runId} %`,
			],
		);
		if (!row) throw new Error("Mutation classification proof returned no row");
		classified = row;
	} finally {
		await verification.close({ timeout: 0 });
	}

	const delta = Object.freeze({
		audits: persisted.audits - baseline.audits,
		durableEvents: persisted.durableEvents - baseline.durableEvents,
		durableRuns: persisted.durableRuns - baseline.durableRuns,
		intents: persisted.intents - baseline.intents,
		messages: persisted.messages - baseline.messages,
		receipts: persisted.receipts - baseline.receipts,
	});
	const committedFresh =
		classified.warmupReceipts + classified.measuredReceipts;
	const expectedDelta = Object.freeze({
		audits: warmupPairs + measuredPairs,
		durableEvents: warmupPairs + measuredPairs,
		durableRuns: warmupPairs + measuredPairs,
		intents: warmupPairs + measuredPairs,
		messages: warmupPairs + measuredPairs,
		receipts: warmupPairs + measuredPairs,
	});
	const expectedClassified = Object.freeze({
		warmupReceipts: warmupPairs,
		warmupDistinctCallIds: warmupPairs,
		measuredReceipts: measuredPairs,
		measuredDistinctCallIds: measuredPairs,
		warmupMessages: warmupPairs,
		warmupDistinctBodies: warmupPairs,
		measuredMessages: measuredPairs,
		measuredDistinctBodies: measuredPairs,
	});
	if (
		JSON.stringify(delta) !== JSON.stringify(expectedDelta) ||
		JSON.stringify(classified) !== JSON.stringify(expectedClassified)
	)
		throw new Error(
			`fresh/replay persistence delta is invalid: ${JSON.stringify({ baseline, persisted, delta, expectedDelta, classified, expectedClassified })}`,
		);
	const replayAmplificationWrites = Math.max(
		...Object.values(delta).map((count) => count - committedFresh),
	);

	const freshSamples = rawSamples
		.filter(({ kind }) => kind === "fresh")
		.map(({ durationMs }) => durationMs);
	const replaySamples = rawSamples
		.filter(({ kind }) => kind === "replay")
		.map(({ durationMs }) => durationMs);
	const measurements = Object.freeze({
		warmupExecutions: warmupPairs * 2,
		measuredExecutions: rawSamples.length,
		freshSamples: freshSamples.length,
		replaySamples: replaySamples.length,
		measuredFreshWrites: classified.measuredReceipts,
		measuredReplayWrites: replayAmplificationWrites,
	});
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		const value = measurements[name as keyof typeof measurements];
		if (metric.direction === "min" && value < metric.budget)
			throw new Error(`${name} ${value} is below ${metric.budget}`);
		if (metric.direction === "max" && value > metric.budget)
			throw new Error(`${name} ${value} exceeds ${metric.budget}`);
	}

	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ?? "reference-local",
			evidenceBoundary:
				"client-observed-checkout-inclusive-mutation-transaction-envelope-tail-not-statement-timeout",
			timerControlMs,
			measurements,
			persistence: {
				baseline,
				observed: persisted,
				delta,
				expectedDelta,
				classified,
				expectedClassified,
				replayAmplificationWrites,
			},
			distributions: {
				all: distribution(rawSamples.map(({ durationMs }) => durationMs)),
				fresh: distribution(freshSamples),
				replay: distribution(replaySamples),
			},
			rawSamples,
			status: "PASS",
		}),
	);
} finally {
	await application?.close().catch(() => undefined);
	await prepared.dispose();
}
