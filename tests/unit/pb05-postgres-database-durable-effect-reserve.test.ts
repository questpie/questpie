import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableEffectReserve } from "../../packages/runtime/src/durable/postgres-database-effect-reserve";
import {
	durableEffectFence,
	durableEffectReservationInsert,
	durableEffectReservationRead,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";
import {
	createPb05OperationalMeasurement,
	instrumentPb05TransactionRunner,
} from "../support/pb05-operational-measurement";

const claim = Object.freeze({
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	resource: "reaction:message.published",
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	leaseToken: "lease:pb05",
	causationId: "call:pb05",
	correlationId: "call:pb05",
} as DurableClaim);

function databaseFor(
	row: Readonly<{
		effectId: string;
		status: "acknowledged" | "ambiguous" | "pending" | "succeeded";
		receipt: string | null;
		inputDigest: string;
	}>,
	calls: Array<Readonly<{ statement: unknown; value: unknown }>>,
): PostgresTransactionRunner {
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return true;
			if (statement === durableEffectReservationInsert) return undefined;
			if (statement === durableEffectReservationRead) return row;
			throw new TypeError("unexpected Durable reservation statement");
		},
	} as PostgresTransaction;
	return {
		transaction: ({ mode, use }) => {
			expect(mode).toEqual({ isolation: "readCommitted", access: "readWrite" });
			return use(transaction);
		},
	} as PostgresTransactionRunner;
}

test("reserves one deterministic effect through exact static statements", async () => {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const effectId = "64a789a4-c319-5d2b-ac27-520d9808a941";
	const inputDigest =
		"8511a4633e1124451288e6801dd0f73f027c843498639d8de0931303667e1d42";
	const measurement = createPb05OperationalMeasurement();
	const database = instrumentPb05TransactionRunner({
		database: databaseFor(
			{ effectId, status: "pending", receipt: null, inputDigest },
			calls,
		),
		measurement,
		population: "durable",
		operation: "effectReserve",
	});
	const reserve = createPostgresDatabaseDurableEffectReserve({
		database,
		application: "application:collaboration",
	});

	await expect(
		reserve(claim, { effectName: "deliver", input: { messageId: "m1" } }),
	).resolves.toEqual({ status: "reserved", effectId });
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableEffectFence,
		durableEffectReservationInsert,
		durableEffectReservationRead,
	]);
	expect(calls[2]?.value).toEqual({
		application: "application:collaboration",
		runId: claim.runId,
		effectName: "deliver",
		effectId,
		inputDigest,
		attemptId: claim.attemptId,
	});
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).operations[
			"durable:effectReserve"
		],
	).toMatchObject({
		statementExecutions: 4,
		distinctStatements: [
			"durable.kernel.mark",
			"durable.effect.fence",
			"durable.effect.reservation.insert",
			"durable.effect.reservation.read",
		],
		transactions: 1,
	});
});

test("returns recovered or conflict without a second authority", async () => {
	const matchingDigest =
		"8511a4633e1124451288e6801dd0f73f027c843498639d8de0931303667e1d42";
	const effectId = "64a789a4-c319-5d2b-ac27-520d9808a941";
	await expect(
		createPostgresDatabaseDurableEffectReserve({
			database: databaseFor(
				{
					effectId,
					status: "succeeded",
					receipt: "provider:receipt",
					inputDigest: matchingDigest,
				},
				[],
			),
			application: "application:collaboration",
		})(claim, { effectName: "deliver", input: { messageId: "m1" } }),
	).resolves.toEqual({
		status: "recovered",
		effectId,
		receipt: "provider:receipt",
	});
	await expect(
		createPostgresDatabaseDurableEffectReserve({
			database: databaseFor(
				{
					effectId,
					status: "pending",
					receipt: null,
					inputDigest: "a".repeat(64),
				},
				[],
			),
			application: "application:collaboration",
		})(claim, { effectName: "deliver", input: { messageId: "m1" } }),
	).resolves.toEqual({ status: "conflict", effectId });
});

test("rejects a stored effect identity that is not derived from the request", async () => {
	await expect(
		createPostgresDatabaseDurableEffectReserve({
			database: databaseFor(
				{
					effectId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
					status: "pending",
					receipt: null,
					inputDigest:
						"8511a4633e1124451288e6801dd0f73f027c843498639d8de0931303667e1d42",
				},
				[],
			),
			application: "application:collaboration",
		})(claim, { effectName: "deliver", input: { messageId: "m1" } }),
	).rejects.toThrow("durable effect identity does not match its input");
});

test("a fenced reservation stops before insert", async () => {
	const statements: unknown[] = [];
	const transaction = {
		async execute(statement) {
			statements.push(statement);
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return false;
			throw new TypeError("fenced reservation must not write");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ use }) => use(transaction),
	} as PostgresTransactionRunner;
	await expect(
		createPostgresDatabaseDurableEffectReserve({
			database,
			application: "application:collaboration",
		})(claim, { effectName: "deliver", input: null }),
	).resolves.toEqual({ status: "fenced" });
	expect(statements).toEqual([durableKernelMarker, durableEffectFence]);
});

test("reservation statements close parameters and structural rows", () => {
	const effectId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
	const digest = "a".repeat(64);
	expect(
		durableEffectReservationInsert.parameters({
			application: "application:collaboration",
			runId: claim.runId,
			effectName: "deliver",
			effectId,
			inputDigest: digest,
			attemptId: claim.attemptId,
		}),
	).toHaveLength(6);
	expect(
		durableEffectReservationInsert.decode({
			command: "INSERT",
			rowCount: 0,
			rows: [],
		}),
	).toBeUndefined();
	expect(
		durableEffectReservationInsert.decode({
			command: "INSERT",
			rowCount: 1,
			rows: [],
		}),
	).toBeUndefined();
	for (const invalid of [
		{
			effectName: "",
			effectId,
			inputDigest: digest,
			attemptId: claim.attemptId,
		},
		{
			effectName: "deliver",
			effectId: "not-a-uuid",
			inputDigest: digest,
			attemptId: claim.attemptId,
		},
		{
			effectName: "deliver",
			effectId,
			inputDigest: "bad",
			attemptId: claim.attemptId,
		},
		{
			effectName: "deliver",
			effectId,
			inputDigest: digest,
			attemptId: "not-a-uuid",
		},
	])
		expect(() =>
			durableEffectReservationInsert.parameters({
				application: "application:collaboration",
				runId: claim.runId,
				...invalid,
			}),
		).toThrow();
	expect(
		durableEffectReservationRead.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "pending", null, digest]],
		}),
	).toEqual({
		effectId,
		status: "pending",
		receipt: null,
		inputDigest: digest,
	});
	for (const result of [
		{
			command: "UPDATE",
			rowCount: 1,
			rows: [[effectId, "pending", null, digest]],
		},
		{ command: "SELECT", rowCount: 0, rows: [] },
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "unknown", null, digest]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "succeeded", null, digest]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "pending", "receipt", digest]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "succeeded", "r".repeat(257), digest]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[effectId, "pending", null, "bad"]],
		},
	] as const)
		expect(() => durableEffectReservationRead.decode(result)).toThrow();
	for (const result of [
		{ command: "INSERT", rowCount: 2, rows: [] },
		{ command: "INSERT", rowCount: 1, rows: [[1]] },
	] as const)
		expect(() => durableEffectReservationInsert.decode(result)).toThrow();
});
