import { expect, test } from "bun:test";

import { createMutationCheckpointRun } from "../../packages/runtime/src/durable/checkpoint";
import { DurableCheckpointError } from "../../packages/runtime/src/durable/checkpoint-contract";
import { createPostgresMutationCheckpointStore } from "../../packages/runtime/src/durable/checkpoint-postgres";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import { QuestpiePostgresError } from "../../packages/runtime/src/postgres/contract";

const claim: DurableClaim = {
	acceptanceTrace: null,
	runId: "00000000-0000-4000-8000-000000000001",
	dispatchId: "00000000-0000-4000-8000-000000000002",
	resource: "job:checkpoint",
	semanticVersion: 1,
	attemptId: "00000000-0000-4000-8000-000000000003",
	attemptNumber: 1,
	queueDelayMilliseconds: 0,
	leaseToken: "owned-checkpoint-lease",
	leaseMilliseconds: 1000,
	leaseExpiresAt: new Date("2026-09-06T00:00:01Z"),
	deadlineAt: new Date("2026-09-06T00:01:00Z"),
	workerId: "checkpoint-worker",
	tenantId: "checkpoint-tenant",
	principal: { kind: "service", id: "checkpoint-service" },
	contextInputBytes: new Uint8Array(),
	payloadBytes: new Uint8Array(),
	retry: {
		maximumAttempts: 3,
		initialDelayMilliseconds: 1000,
		backoff: "exponential",
		maximumDelayMilliseconds: 5000,
		jitter: "full",
		horizonMilliseconds: 60000,
	},
	runtimeBuildDigest: "a".repeat(64),
	executableDigest: "b".repeat(64),
	causationId: "checkpoint-cause",
	correlationId: "checkpoint-correlation",
	cancellationRequested: false,
};

function loadFailure(failure: unknown) {
	return createPostgresMutationCheckpointStore({
		application: "application:checkpoint",
		database: {
			async transaction() {
				throw failure;
			},
		},
	}).load(claim);
}

test("checkpoint stored-result corruption becomes a safe permanent failure without its cause", async () => {
	for (const statementName of [
		"checkpoint.history",
		"checkpoint.read",
		"checkpoint.receipt.read",
	]) {
		const failure = await loadFailure(
			new QuestpiePostgresError({
				code: "invalidResult",
				phase: "statement",
				statementName,
				cause: new TypeError("private checkpoint row details"),
			}),
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(DurableCheckpointError);
		expect(failure).toMatchObject({
			code: "CHECKPOINT_INVALID",
			message: "CHECKPOINT_INVALID",
		});
		expect(failure).not.toHaveProperty("cause");
		expect(failure).not.toHaveProperty("statementName");
		expect(failure).not.toHaveProperty("sqlState");
	}
});

test("checkpoint reads preserve database failure identity outside their stored-result decoders", async () => {
	for (const code of [
		"cancelled",
		"statementTimeout",
		"lockTimeout",
		"connectionLost",
		"serializationFailure",
		"deadlock",
		"commitOutcomeUnknown",
	] as const) {
		const failure = new QuestpiePostgresError({
			code,
			phase: "statement",
			statementName: "checkpoint.history",
		});
		await expect(loadFailure(failure)).rejects.toBe(failure);
	}
	for (const statementName of [
		"durable.effect.fence",
		"checkpoint.reserve",
		"checkpoint.complete",
		undefined,
	]) {
		const failure = new QuestpiePostgresError({
			code: "invalidResult",
			phase: "statement",
			statementName,
		});
		await expect(loadFailure(failure)).rejects.toBe(failure);
	}
	const cancelled = new DOMException("cancelled", "AbortError");
	await expect(loadFailure(cancelled)).rejects.toBe(cancelled);
});

test("checkpoint ingress rejects non-text names and primitive references without coercion or reservation", async () => {
	let coercions = 0;
	for (const invalid of [
		...[
			12,
			null,
			undefined,
			true,
			["publish"],
			{
				toString() {
					coercions++;
					return "publish";
				},
			},
		].map((name) => ({ name })),
		...[null, undefined, 12, "publish", true, Symbol("reference")].map(
			(reference) => ({ reference }),
		),
	]) {
		let reservations = 0;
		const run = await createMutationCheckpointRun({
			claim,
			signal: new AbortController().signal,
			bindings: [
				{
					identity: "mutation:publish",
					input: { kind: "object", properties: {} },
					output: { kind: "object", properties: {} },
					contractDigest: "a".repeat(64),
					runtimeGraphDigest: "b".repeat(64),
				},
			],
			store: {
				async load() {
					return 0;
				},
				async reserve() {
					reservations++;
					throw new Error("unexpected reservation");
				},
				async complete() {
					throw new Error("unexpected completion");
				},
			},
			async invoke() {
				throw new Error("unexpected Mutation dispatch");
			},
		});
		const failure = await Reflect.apply(run.step.mutation, undefined, [
			"name" in invalid ? invalid.name : "publish",
			"reference" in invalid
				? invalid.reference
				: run.reference("mutation:publish"),
			{},
		]).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(DurableCheckpointError);
		expect(failure).toMatchObject({ code: "CHECKPOINT_INVALID" });
		await expect(run.finish()).rejects.toBe(failure);
		expect(reservations).toBe(0);
	}
	expect(coercions).toBe(0);
});
