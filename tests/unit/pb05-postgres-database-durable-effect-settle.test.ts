import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableEffectSettle } from "../../packages/runtime/src/durable/postgres-database-effect-settle";
import {
	durableEffectFence,
	durableEffectSettle,
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres/contract";

const claim = Object.freeze({
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
	resource: "reaction:message.published",
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
	leaseToken: "lease:pb05",
	causationId: "call:pb05",
	correlationId: "call:pb05",
} as DurableClaim);

test("settles a Durable effect and appends one event in one static transaction", async () => {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return true;
			if (statement === durableEffectSettle)
				return "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
			if (statement === durableEventSequenceBump)
				return Object.freeze({ sequence: 2 });
			if (statement === durableEventInsert) return undefined;
			throw new TypeError("unexpected Durable effect statement");
		},
	} as PostgresTransaction;
	const database = {
		transaction: async ({ mode, use }) => {
			expect(mode).toEqual({ isolation: "readCommitted", access: "readWrite" });
			return use(transaction);
		},
	} as PostgresTransactionRunner;

	const settle = createPostgresDatabaseDurableEffectSettle({
		database,
		application: "application:collaboration",
	});
	await expect(
		settle(claim, { effectName: "deliver", receipt: "provider:receipt" }),
	).resolves.toBe("applied");
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableEffectFence,
		durableEffectSettle,
		durableEventSequenceBump,
		durableEventInsert,
	]);
	expect(calls[1]?.value).toEqual({
		application: "application:collaboration",
		runId: claim.runId,
		attemptId: claim.attemptId,
		leaseTokenDigest:
			"6bf615ef7aaf17a110703827bfff8f42cbcb5e842fc60afaf2dd1a69230ff024",
	});
	expect(calls[2]?.value).toEqual({
		application: "application:collaboration",
		runId: claim.runId,
		effectName: "deliver",
		receipt: "provider:receipt",
		attemptId: claim.attemptId,
	});
});

test("a fenced Durable effect settlement performs no write or event", async () => {
	const statements: unknown[] = [];
	const transaction = {
		async execute(statement) {
			statements.push(statement);
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return false;
			throw new TypeError("fenced effect must not write");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ use }) => use(transaction),
	} as PostgresTransactionRunner;

	await expect(
		createPostgresDatabaseDurableEffectSettle({
			database,
			application: "application:collaboration",
		})(claim, { effectName: "deliver", receipt: "provider:receipt" }),
	).resolves.toBe("fenced");
	expect(statements).toEqual([durableKernelMarker, durableEffectFence]);
});

test("an already-settled effect commits without duplicating its event", async () => {
	const statements: unknown[] = [];
	const transaction = {
		async execute(statement) {
			statements.push(statement);
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return true;
			if (statement === durableEffectSettle) return null;
			throw new TypeError("duplicate event must not execute");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ use }) => use(transaction),
	} as PostgresTransactionRunner;

	await expect(
		createPostgresDatabaseDurableEffectSettle({
			database,
			application: "application:collaboration",
		})(claim, { effectName: "deliver", receipt: "provider:receipt" }),
	).resolves.toBe("applied");
	expect(statements).toEqual([
		durableKernelMarker,
		durableEffectFence,
		durableEffectSettle,
	]);
});

test("static Durable effect statements close parameters and results", () => {
	const digest = "a".repeat(64);
	expect(
		durableEffectFence.parameters({
			application: "application:collaboration",
			runId: claim.runId,
			attemptId: claim.attemptId,
			leaseTokenDigest: digest,
		}),
	).toEqual([
		"application:collaboration",
		claim.runId,
		claim.attemptId,
		digest,
	]);
	expect(durableEffectFence.text.endsWith("FOR UPDATE")).toBe(true);
	expect(
		durableEffectSettle.parameters({
			application: "application:collaboration",
			runId: claim.runId,
			effectName: "e".repeat(63),
			receipt: "r".repeat(256),
			attemptId: claim.attemptId,
		}),
	).toHaveLength(5);
	expect(
		durableEffectSettle.parameters({
			application: "application:collaboration",
			runId: claim.runId,
			effectName: "effect",
			receipt: "",
			attemptId: claim.attemptId,
		}),
	).toHaveLength(5);
	for (const invalid of [
		{ effectName: "", receipt: "receipt" },
		{ effectName: "e".repeat(64), receipt: "receipt" },
		{ effectName: "effect", receipt: "r".repeat(257) },
	])
		expect(() =>
			durableEffectSettle.parameters({
				application: "application:collaboration",
				runId: claim.runId,
				attemptId: claim.attemptId,
				...invalid,
			}),
		).toThrow();

	expect(
		durableEffectFence.decode({ command: "SELECT", rowCount: 0, rows: [] }),
	).toBe(false);
	expect(
		durableEffectFence.decode({ command: "SELECT", rowCount: 1, rows: [[1]] }),
	).toBe(true);
	expect(
		durableEffectSettle.decode({ command: "UPDATE", rowCount: 0, rows: [] }),
	).toBeNull();
	expect(
		durableEffectSettle.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [["018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3"]],
		}),
	).toBe("018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3");
	for (const [statement, result] of [
		[durableEffectFence, { command: "SELECT", rowCount: 1, rows: [[true]] }],
		[durableEffectFence, { command: "SELECT", rowCount: 0, rows: [[1]] }],
		[durableEffectSettle, { command: "UPDATE", rowCount: 1, rows: [] }],
		[durableEffectSettle, { command: "UPDATE", rowCount: 1, rows: [["bad"]] }],
	] as const)
		expect(() => statement.decode(result)).toThrow();
});
