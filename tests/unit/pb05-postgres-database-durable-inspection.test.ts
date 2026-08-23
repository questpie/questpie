import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableInspection } from "../../packages/runtime/src/durable/postgres-database-inspection";
import {
	durableRunEventsRead,
	durableRunInspect,
} from "../../packages/runtime/src/durable/postgres-inspection-statements";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const attemptId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";

test("reads a run and its append-only event history in read-only transactions", async () => {
	const modes: unknown[] = [];
	const calls: unknown[] = [];
	const availableAt = new Date("2026-08-23T00:00:00.000Z");
	const transaction = {
		execute(statement) {
			calls.push(statement);
			if (statement === durableRunInspect)
				return Promise.resolve({
					runId,
					version: 2,
					dispatchId,
					resource: "reaction:messagePublished",
					state: "running",
					attemptCount: 1,
					currentAttemptId: attemptId,
					cancellationRequested: false,
					deadLetter: false,
					failureCode: null,
					resultBytes: null,
					availableAt,
					terminalAt: null,
				});
			if (statement === durableRunEventsRead)
				return Promise.resolve([
					{
						sequence: 1,
						kind: "accepted",
						attemptId: null,
						leaseTokenDigest: null,
						errorCode: null,
					},
				]);
			throw new TypeError("unexpected inspection statement");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ mode, use }) => {
			modes.push(mode);
			return use(transaction);
		},
	} as PostgresTransactionRunner;
	const inspection = createPostgresDatabaseDurableInspection({
		database,
		application: "application:collaboration",
	});
	await expect(inspection.inspect(runId)).resolves.toMatchObject({
		state: "running",
		currentAttemptId: attemptId,
	});
	await expect(inspection.events(runId)).resolves.toEqual([
		{
			sequence: 1,
			kind: "accepted",
			attemptId: null,
			leaseTokenDigest: null,
			errorCode: null,
		},
	]);
	expect(modes).toEqual([
		{ isolation: "readCommitted", access: "readOnly" },
		{ isolation: "readCommitted", access: "readOnly" },
	]);
	expect(calls).toEqual([durableRunInspect, durableRunEventsRead]);
});

test("inspection decoders reject malformed and reordered results", () => {
	expect(() =>
		durableRunInspect.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					runId,
					dispatchId,
					"reaction:x",
					"unknown",
					0,
					null,
					false,
					false,
					null,
					null,
					new Date(),
					null,
					1,
				],
			],
		}),
	).toThrow("inspection result");
	expect(() =>
		durableRunInspect.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					runId,
					dispatchId,
					"reaction:x",
					"succeeded",
					1,
					attemptId,
					false,
					false,
					null,
					new Uint8Array([1]),
					new Date(),
					new Date(),
					3,
				],
			],
		}),
	).toThrow("inspection result");
	expect(() =>
		durableRunEventsRead.decode({
			command: "SELECT",
			rowCount: 2,
			rows: [
				[2, "attemptStarted", attemptId, "a".repeat(64), null],
				[1, "accepted", null, null, null],
			],
		}),
	).toThrow("event history result");
	expect(() =>
		durableRunEventsRead.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [[1, "invented", null, null, null]],
		}),
	).toThrow("event history result");
});
