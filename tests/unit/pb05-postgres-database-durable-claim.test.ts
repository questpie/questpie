import { expect, test } from "bun:test";

import {
	durableClaimAttemptsExhaust,
	durableClaimAttemptInsert,
	durableClaimAttemptsSupersede,
	durableClaimRunExhaust,
	durableClaimRunLease,
	durableClaimRunSelect,
} from "../../packages/runtime/src/durable/postgres-claim-statements";
import { createPostgresDatabaseDurableClaim } from "../../packages/runtime/src/durable/postgres-database-claim";
import {
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { LinkedReactionProjection } from "../../packages/runtime/src/durable/projection";
import { transactionBrand } from "../../packages/runtime/src/postgres/contract";
import {
	QuestpiePostgresError,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";
import {
	createPb05OperationalMeasurement,
	instrumentPb05TransactionRunner,
} from "../support/pb05-operational-measurement";

const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const attemptId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
const leaseToken = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203";
const retryBytes = new TextEncoder().encode(
	JSON.stringify({
		maximumAttempts: 3,
		initialDelayMilliseconds: 1_000,
		maximumDelayMilliseconds: 60_000,
		horizonMilliseconds: 86_400_000,
	}),
);

const reactions = {
	byIdentity: new Map([
		[
			"reaction:messagePublished",
			{
				contractDigest: "b".repeat(64),
			},
		],
	]),
} as unknown as LinkedReactionProjection;

function selectedRun(
	input: Readonly<{ attemptCount?: number; executableDigest?: string }> = {},
) {
	return {
		runId,
		dispatchId,
		resource: "reaction:messagePublished",
		tenantId: "tenant:one",
		principalKind: "user" as const,
		principalId: "user:one",
		contextInputBytes: new Uint8Array([1]),
		payloadBytes: new Uint8Array([2]),
		retryBytes,
		runtimeBuildDigest: "a".repeat(64),
		executableDigest: input.executableDigest ?? "b".repeat(64),
		causationId: "cause:one",
		correlationId: "correlation:one",
		cancellationRequested: false,
		attemptCount: input.attemptCount ?? 0,
	};
}

test("claims through one exact static database transaction", async () => {
	const calls: Array<
		Readonly<{ statement: object; parameters: readonly unknown[] }>
	> = [];
	const leaseExpiresAt = new Date("2026-08-22T00:00:30.000Z");
	const deadlineAt = new Date("2026-08-22T00:05:00.000Z");
	const unmeasured: PostgresTransactionRunner = {
		transaction(input) {
			expect(input.mode).toEqual({
				isolation: "readCommitted",
				access: "readWrite",
			});
			return input.use({
				[transactionBrand]: true,
				async execute(statement, value) {
					calls.push({ statement, parameters: statement.parameters(value) });
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableClaimRunSelect)
						return selectedRun() as never;
					if (statement === durableClaimRunLease)
						return { leaseExpiresAt, deadlineAt } as never;
					if (statement === durableClaimAttemptsSupersede) return [] as never;
					if (statement === durableClaimAttemptInsert)
						return undefined as never;
					if (statement === durableEventSequenceBump)
						return { sequence: 2 } as never;
					if (statement === durableEventInsert) return undefined as never;
					throw new Error("unexpected statement");
				},
			});
		},
	};
	const measurement = createPb05OperationalMeasurement();
	const database = instrumentPb05TransactionRunner({
		database: unmeasured,
		measurement,
		population: "durable",
		operation: "claim",
	});
	const claim = createPostgresDatabaseDurableClaim({
		database,
		application: "application:collaboration",
		reactions,
		randomUUID: (() => {
			const values = [attemptId, leaseToken];
			return () => values.shift()!;
		})(),
	});

	await expect(
		claim({ runId, workerId: "worker:one", leaseMilliseconds: 30_000 }),
	).resolves.toMatchObject({
		status: "claimed",
		claim: {
			runId,
			attemptId,
			attemptNumber: 1,
			leaseToken,
			leaseExpiresAt,
			deadlineAt,
		},
	});
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableClaimRunSelect,
		durableClaimRunLease,
		durableClaimAttemptsSupersede,
		durableClaimAttemptInsert,
		durableEventSequenceBump,
		durableEventInsert,
	]);
	expect(calls[2]?.parameters).toEqual([
		"application:collaboration",
		runId,
		1,
		attemptId,
		expect.stringMatching(/^[0-9a-f]{64}$/),
		30,
		300,
	]);
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).operations[
			"durable:claim"
		],
	).toMatchObject({
		statementExecutions: 7,
		distinctStatements: calls.map(({ statement }) =>
			"name" in statement ? statement.name : "",
		),
		transactions: 1,
	});
});

test("skips unavailable and refuses incompatible executable work before mutation", async () => {
	for (const selection of [
		null,
		selectedRun({ executableDigest: "c".repeat(64) }),
	]) {
		const calls: object[] = [];
		const database: PostgresTransactionRunner = {
			transaction: (input) =>
				input.use({
					[transactionBrand]: true,
					async execute(statement) {
						calls.push(statement);
						if (statement === durableKernelMarker) return undefined as never;
						if (statement === durableClaimRunSelect) return selection as never;
						throw new Error("claim must not mutate");
					},
				}),
		};
		const claim = createPostgresDatabaseDurableClaim({
			database,
			application: "application:collaboration",
			reactions,
		});
		await expect(claim({ runId, workerId: "worker:one" })).resolves.toEqual(
			selection === null
				? { status: "skipped" }
				: { status: "refused", code: "EXECUTABLE_RETIRED" },
		);
		expect(calls).toEqual([durableKernelMarker, durableClaimRunSelect]);
	}
});

test("terminalizes an exhausted claim and records one failed event", async () => {
	const calls: object[] = [];
	const exhaustedRetry = new TextEncoder().encode(
		JSON.stringify({
			maximumAttempts: 1,
			initialDelayMilliseconds: 1_000,
			maximumDelayMilliseconds: 60_000,
			horizonMilliseconds: 86_400_000,
		}),
	);
	const stale = {
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6204",
		leaseTokenDigest: "d".repeat(64),
	};
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(statement) {
					calls.push(statement);
					if (statement === durableKernelMarker) return undefined as never;
					if (statement === durableClaimRunSelect)
						return {
							...selectedRun({ attemptCount: 1 }),
							retryBytes: exhaustedRetry,
						} as never;
					if (statement === durableClaimAttemptsExhaust)
						return [stale] as never;
					if (statement === durableClaimRunExhaust) return undefined as never;
					if (statement === durableEventSequenceBump)
						return { sequence: 3 } as never;
					if (statement === durableEventInsert) return undefined as never;
					throw new Error("unexpected statement");
				},
			}),
	};
	const claim = createPostgresDatabaseDurableClaim({
		database,
		application: "application:collaboration",
		reactions,
	});

	await expect(claim({ runId, workerId: "worker:one" })).resolves.toEqual({
		status: "skipped",
	});
	expect(calls).toEqual([
		durableKernelMarker,
		durableClaimRunSelect,
		durableClaimAttemptsExhaust,
		durableClaimRunExhaust,
		durableEventSequenceBump,
		durableEventInsert,
	]);
});

test("normalizes only database serialization failure to a skipped claim", async () => {
	const failure = new QuestpiePostgresError({
		code: "serializationFailure",
		phase: "statement",
		retry: "safeBeforeCommit",
	});
	const claim = createPostgresDatabaseDurableClaim({
		database: { transaction: () => Promise.reject(failure) },
		application: "application:collaboration",
		reactions,
	});
	await expect(claim({ runId, workerId: "worker:one" })).resolves.toEqual({
		status: "skipped",
	});

	const ordinary = new QuestpiePostgresError({
		code: "queryFailed",
		phase: "statement",
	});
	const failing = createPostgresDatabaseDurableClaim({
		database: { transaction: () => Promise.reject(ordinary) },
		application: "application:collaboration",
		reactions,
	});
	await expect(failing({ runId, workerId: "worker:one" })).rejects.toBe(
		ordinary,
	);
});
