import { expect, test } from "bun:test";

import {
	durableClaimAttemptInsert,
	durableClaimAttemptsExhaust,
	durableClaimAttemptsSupersede,
	durableClaimRunExhaust,
	durableClaimRunLease,
	durableClaimRunSelect,
} from "../../packages/runtime/src/durable/postgres-claim-statements";

const application = "application:collaboration";
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const attemptId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
const leaseDigest = "a".repeat(64);

test("claim statements map their closed parameter contracts", () => {
	expect(durableClaimRunSelect.parameters({ application, runId })).toEqual([
		application,
		runId,
	]);
	expect(
		durableClaimAttemptsExhaust.parameters({ application, runId }),
	).toEqual([application, runId]);
	expect(durableClaimRunExhaust.parameters({ application, runId })).toEqual([
		application,
		runId,
	]);
	expect(
		durableClaimRunLease.parameters({
			application,
			runId,
			attemptNumber: 2,
			attemptId,
			leaseTokenDigest: leaseDigest,
			leaseSeconds: 30,
			deadlineSeconds: 300,
		}),
	).toEqual([application, runId, 2, attemptId, leaseDigest, 30, 300]);
	expect(
		durableClaimAttemptsSupersede.parameters({ application, runId, attemptId }),
	).toEqual([application, runId, attemptId]);
	const leaseExpiresAt = new Date("2026-08-22T00:00:30.000Z");
	const deadlineAt = new Date("2026-08-22T00:05:00.000Z");
	expect(
		durableClaimAttemptInsert.parameters({
			application,
			attemptId,
			runId,
			attemptNumber: 2,
			workerId: "worker:one",
			leaseTokenDigest: leaseDigest,
			leaseExpiresAt,
			deadlineAt,
		}),
	).toEqual([
		application,
		attemptId,
		runId,
		2,
		"worker:one",
		leaseDigest,
		leaseExpiresAt,
		deadlineAt,
	]);
});

test("claim statements reject malformed parameters before PostgreSQL", () => {
	expect(() =>
		durableClaimRunSelect.parameters({ application, runId: "not-a-uuid" }),
	).toThrow("run identity");
	expect(() =>
		durableClaimRunLease.parameters({
			application,
			runId,
			attemptNumber: 0,
			attemptId,
			leaseTokenDigest: leaseDigest,
			leaseSeconds: 30,
			deadlineSeconds: 300,
		}),
	).toThrow("attempt number");
	expect(() =>
		durableClaimAttemptInsert.parameters({
			application,
			attemptId,
			runId,
			attemptNumber: 1,
			workerId: "worker\0one",
			leaseTokenDigest: leaseDigest,
			leaseExpiresAt: new Date(),
			deadlineAt: new Date(),
		}),
	).toThrow("worker identity");
});

test("claim statement decoders close cardinality and scalar shape", () => {
	const selected = durableClaimRunSelect.decode({
		command: "SELECT",
		rowCount: 1,
		rows: [
			[
				runId,
				"018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
				"reaction:messagePublished",
				"tenant:one",
				"user",
				"user:one",
				new Uint8Array([1]),
				new Uint8Array([2]),
				new Uint8Array([3]),
				"b".repeat(64),
				"c".repeat(64),
				"cause:one",
				"correlation:one",
				false,
				1,
			],
		],
	});
	expect(selected).toMatchObject({
		runId,
		principalKind: "user",
		attemptCount: 1,
	});
	expect(Object.isFrozen(selected)).toBe(true);
	expect(() =>
		durableClaimRunSelect.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					runId,
					"018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
					"reaction:messagePublished",
					"tenant:one",
					"root",
					"user:one",
					new Uint8Array(),
					new Uint8Array(),
					new Uint8Array(),
					"b".repeat(64),
					"c".repeat(64),
					"cause",
					"correlation",
					false,
					0,
				],
			],
		}),
	).toThrow("Principal kind");
	expect(
		durableClaimRunLease.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [
				[
					new Date("2026-08-22T00:00:30.000Z"),
					new Date("2026-08-22T00:05:00.000Z"),
				],
			],
		}),
	).toEqual({
		leaseExpiresAt: new Date("2026-08-22T00:00:30.000Z"),
		deadlineAt: new Date("2026-08-22T00:05:00.000Z"),
	});
	expect(() =>
		durableClaimRunLease.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [[new Date(Number.NaN), new Date()]],
		}),
	).toThrow("lease result");
	expect(() =>
		durableClaimAttemptInsert.decode({
			command: "INSERT",
			rowCount: 0,
			rows: [],
		}),
	).toThrow("attempt insert result");
});
