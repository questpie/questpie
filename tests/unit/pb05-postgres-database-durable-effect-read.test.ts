import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableEffectRead } from "../../packages/runtime/src/durable/postgres-database-effect-read";
import { durableEffectRead } from "../../packages/runtime/src/durable/postgres-statements";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

test("reads frozen Durable effects through one exact read-only statement", async () => {
	const rows = Object.freeze([
		Object.freeze({
			effectName: "deliver",
			effectId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
			status: "pending" as const,
			receipt: null,
		}),
	]);
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableEffectRead) return rows;
			throw new TypeError("unexpected Durable effect read");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ mode, use }) => {
			expect(mode).toEqual({ isolation: "readCommitted", access: "readOnly" });
			return use(transaction);
		},
	} as PostgresTransactionRunner;
	const read = createPostgresDatabaseDurableEffectRead({
		database,
		application: "application:collaboration",
	});
	const result = await read("018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0");
	expect(result).toBe(rows);
	expect(Object.isFrozen(result)).toBe(true);
	expect(calls).toEqual([
		{
			statement: durableEffectRead,
			value: {
				application: "application:collaboration",
				runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			},
		},
	]);
});

test("the static effect read closes parameters, ordering, and row semantics", () => {
	const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
	const effectId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
	expect(
		durableEffectRead.parameters({
			application: "application:collaboration",
			runId,
		}),
	).toEqual(["application:collaboration", runId]);
	expect(durableEffectRead.text.endsWith("ORDER BY effect_name")).toBe(true);
	const decoded = durableEffectRead.decode({
		command: "SELECT",
		rowCount: 2,
		rows: [
			["deliver", effectId, "pending", null],
			[
				"notify",
				"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				"succeeded",
				"receipt",
			],
		],
	});
	expect(decoded).toEqual([
		{ effectName: "deliver", effectId, status: "pending", receipt: null },
		{
			effectName: "notify",
			effectId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			status: "succeeded",
			receipt: "receipt",
		},
	]);
	expect(Object.isFrozen(decoded)).toBe(true);
	expect(decoded.every(Object.isFrozen)).toBe(true);
	for (const result of [
		{ command: "UPDATE", rowCount: 0, rows: [] },
		{ command: "SELECT", rowCount: 1, rows: [] },
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["deliver", effectId, "unknown", null]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["deliver", effectId, "pending", "receipt"]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["deliver", effectId, "succeeded", null]],
		},
		{ command: "SELECT", rowCount: 1, rows: [["", effectId, "pending", null]] },
	] as const)
		expect(() => durableEffectRead.decode(result)).toThrow();
});
