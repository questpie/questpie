import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableHeartbeat } from "../../packages/runtime/src/durable/postgres-database-heartbeat";
import {
	durableAttemptHeartbeat,
	durableKernelMarker,
	durableRunHeartbeat,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import { transactionBrand } from "../../packages/runtime/src/postgres/contract";
import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres/contract";

const claim = Object.freeze({
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
	resource: "reaction:messagePublished",
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
	attemptNumber: 1,
	leaseToken: "lease-token",
	leaseMilliseconds: 30_000,
	leaseExpiresAt: new Date("2026-08-22T00:00:30.000Z"),
	deadlineAt: new Date("2026-08-22T00:05:00.000Z"),
	workerId: "worker-1",
	tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	principal: { kind: "user", id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4" },
	contextInputBytes: new Uint8Array([1]),
	payloadBytes: new Uint8Array([2]),
	retry: {
		maximumAttempts: 3,
		initialDelayMilliseconds: 1_000,
		backoff: "exponential",
		maximumDelayMilliseconds: 60_000,
		jitter: "full",
		horizonMilliseconds: 86_400_000,
	},
	runtimeBuildDigest: "a".repeat(64),
	executableDigest: "b".repeat(64),
	causationId: "cause",
	correlationId: "correlation",
	cancellationRequested: false,
}) satisfies DurableClaim;

test("heartbeats the run and attempt through one static database transaction", async () => {
	const calls: Array<
		Readonly<{ name: string; parameters: readonly unknown[] }>
	> = [];
	const database: PostgresTransactionRunner = {
		transaction: (input) => {
			expect(input.mode).toEqual({
				isolation: "readCommitted",
				access: "readWrite",
			});
			return input.use({
				[transactionBrand]: true,
				async execute(statement, value) {
					calls.push({
						name: statement.name,
						parameters: statement.parameters(value),
					});
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableRunHeartbeat)
						return { held: true, cancellationRequested: true } as never;
					if (statement === durableAttemptHeartbeat)
						return { found: true, deadlineExpired: false } as never;
					throw new Error("unexpected statement");
				},
			});
		},
	};
	const heartbeat = createPostgresDatabaseDurableHeartbeat({
		database,
		application: "application:collaboration",
	});

	await expect(heartbeat(claim)).resolves.toEqual({
		status: "held",
		cancellationRequested: true,
		deadlineExpired: false,
	});
	expect(calls).toEqual([
		{ name: "durable.kernel.mark", parameters: [] },
		{
			name: "durable.heartbeat.run",
			parameters: [
				"application:collaboration",
				claim.runId,
				claim.attemptId,
				expect.stringMatching(/^[0-9a-f]{64}$/),
				30,
			],
		},
		{
			name: "durable.heartbeat.attempt",
			parameters: ["application:collaboration", claim.attemptId, 30],
		},
	]);
});

test("a fenced run skips the attempt heartbeat", async () => {
	const calls: string[] = [];
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(statement) {
					calls.push(statement.name);
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableRunHeartbeat)
						return {
							held: false,
							cancellationRequested: false,
						} as never;
					throw new Error("attempt heartbeat must be skipped");
				},
			}),
	};
	const heartbeat = createPostgresDatabaseDurableHeartbeat({
		database,
		application: "application:collaboration",
	});

	await expect(heartbeat(claim)).resolves.toEqual({
		status: "fenced",
		cancellationRequested: false,
		deadlineExpired: false,
	});
	expect(calls).toEqual(["durable.kernel.mark", "durable.heartbeat.run"]);
});

test("a missing attempt rejects after the exact run update", async () => {
	const calls: string[] = [];
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(statement) {
					calls.push(statement.name);
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableRunHeartbeat)
						return {
							held: true,
							cancellationRequested: false,
						} as never;
					return { found: false, deadlineExpired: false } as never;
				},
			}),
	};
	const heartbeat = createPostgresDatabaseDurableHeartbeat({
		database,
		application: "application:collaboration",
	});

	await expect(heartbeat(claim)).rejects.toThrow(
		"Durable heartbeat lost its attempt",
	);
	expect(calls).toEqual([
		"durable.kernel.mark",
		"durable.heartbeat.run",
		"durable.heartbeat.attempt",
	]);
});

test("static heartbeat statements reject malformed database results", () => {
	expect(() =>
		durableKernelMarker.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [["off"]],
		}),
	).toThrow("marker result");
	for (const invalid of [
		{ command: "SELECT", rowCount: 1, rows: [[true]] },
		{ command: "UPDATE", rowCount: null, rows: [] },
		{ command: "UPDATE", rowCount: 2, rows: [[true], [false]] },
		{ command: "UPDATE", rowCount: 1, rows: [] },
		{ command: "UPDATE", rowCount: 1, rows: [["true"]] },
	] as const)
		expect(() => durableRunHeartbeat.decode(invalid)).toThrow(
			"run heartbeat result",
		);
	expect(
		durableAttemptHeartbeat.decode({
			command: "UPDATE",
			rowCount: 0,
			rows: [],
		}),
	).toEqual({ found: false, deadlineExpired: false });
});

test("static heartbeat statements reject malformed parameters before PostgreSQL", () => {
	expect(() =>
		durableRunHeartbeat.parameters({
			application: "application:collaboration",
			runId: "not-a-uuid",
			attemptId: claim.attemptId,
			leaseTokenDigest: "a".repeat(64),
			leaseSeconds: 30,
		}),
	).toThrow("run identity");
	expect(() =>
		durableAttemptHeartbeat.parameters({
			application: "application:collaboration",
			attemptId: claim.attemptId,
			leaseSeconds: 0,
		}),
	).toThrow("lease duration");
});
