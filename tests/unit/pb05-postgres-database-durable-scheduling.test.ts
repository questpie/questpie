import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableScheduling } from "../../packages/runtime/src/durable/postgres-database-scheduling";
import {
	durableAdmissionSelect,
	durableCancelledAttemptsComplete,
	durableCancelledRunsReap,
} from "../../packages/runtime/src/durable/postgres-scheduling-statements";
import {
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import { QuestpiePostgresError } from "../../packages/runtime/src/postgres/contract";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const executableDigest = "a".repeat(64);

function harness(
	input?: Readonly<{
		serializationFailure?: boolean;
		cancelledCount?: number;
	}>,
) {
	const modes: unknown[] = [];
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableAdmissionSelect)
				return [
					{
						runId,
						resource: "reaction:messagePublished",
						executableDigest,
					},
				];
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableCancelledRunsReap)
				return Array.from({ length: input?.cancelledCount ?? 1 }, () => ({
					runId,
					resource: "reaction:messagePublished",
					dispatchId,
					causationId: "cause-1",
					correlationId: "correlation-1",
				}));
			if (statement === durableCancelledAttemptsComplete) return undefined;
			if (statement === durableEventSequenceBump) return { sequence: 2 };
			if (statement === durableEventInsert) return undefined;
			throw new TypeError("unexpected scheduling statement");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ mode, use }) => {
			modes.push(mode);
			if (input?.serializationFailure)
				return Promise.reject(
					new QuestpiePostgresError({
						code: "serializationFailure",
						phase: "statement",
						retry: "safeBeforeCommit",
					}),
				);
			return use(transaction);
		},
	} as PostgresTransactionRunner;
	return {
		calls,
		modes,
		scheduling: createPostgresDatabaseDurableScheduling({
			database,
			application: "application:collaboration",
			executableDigests: [executableDigest],
			maximumBatch: 8,
		}),
	};
}

test("admits through one read-only static statement", async () => {
	const { calls, modes, scheduling } = harness();
	await expect(scheduling.admit(4)).resolves.toEqual([
		{
			runId,
			resource: "reaction:messagePublished",
			executableDigest,
		},
	]);
	expect(modes).toEqual([{ isolation: "readCommitted", access: "readOnly" }]);
	expect(calls).toEqual([
		{
			statement: durableAdmissionSelect,
			value: {
				application: "application:collaboration",
				executableDigests: [executableDigest],
				batch: 4,
			},
		},
	]);
});

test("reaps cancellation, completes attempts, and appends one event atomically", async () => {
	const { calls, modes, scheduling } = harness();
	await expect(scheduling.reapCancelled(3)).resolves.toBe(1);
	expect(modes).toEqual([{ isolation: "readCommitted", access: "readWrite" }]);
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableCancelledRunsReap,
		durableCancelledAttemptsComplete,
		durableEventSequenceBump,
		durableEventInsert,
	]);
	expect(calls[4]?.value).toMatchObject({ kind: "cancelled", runId });
});

test("a cancellation serialization loser becomes no work", async () => {
	const { scheduling } = harness({ serializationFailure: true });
	await expect(scheduling.reapCancelled()).resolves.toBe(0);
});

test("does not normalize an unclassified driver-shaped error", async () => {
	const cause = Object.freeze({ errno: "40001" });
	const scheduling = createPostgresDatabaseDurableScheduling({
		database: {
			transaction: () => Promise.reject(cause),
		} as PostgresTransactionRunner,
		application: "application:collaboration",
		executableDigests: [executableDigest],
		maximumBatch: 8,
	});
	await expect(scheduling.reapCancelled()).rejects.toBe(cause);
});

test("rejects a cancellation result larger than the requested limit", async () => {
	const { calls, scheduling } = harness({ cancelledCount: 2 });
	await expect(scheduling.reapCancelled(1)).rejects.toThrow(
		"cancellation reap result",
	);
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableCancelledRunsReap,
	]);
});

test("scheduling contracts reject bounds and malformed database results", async () => {
	const { scheduling } = harness();
	await expect(scheduling.admit(0)).rejects.toThrow("between 1 and 8");
	await expect(scheduling.reapCancelled(9)).rejects.toThrow("between 1 and 8");
	expect(() =>
		durableAdmissionSelect.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [["bad", "reaction:x", executableDigest]],
		}),
	).toThrow("admission");
	expect(() =>
		durableCancelledRunsReap.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [[runId, "reaction:x", dispatchId, "cause"]],
		}),
	).toThrow("cancellation reap result");
	expect(() =>
		durableCancelledAttemptsComplete.decode({
			command: "UPDATE",
			rowCount: 9,
			rows: [],
		}),
	).toThrow("attempt completion result");
});
