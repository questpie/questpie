import { expect, test } from "bun:test";

import { createPostgresDatabaseDurableEffectAmbiguous } from "../../packages/runtime/src/durable/postgres-database-effect-ambiguous";
import {
	durableEffectAmbiguous,
	durableEffectFence,
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

test("marks one Durable effect ambiguous and appends one event atomically", async () => {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return true;
			if (statement === durableEffectAmbiguous)
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

	const markAmbiguous = createPostgresDatabaseDurableEffectAmbiguous({
		database,
		application: "application:collaboration",
	});
	await expect(markAmbiguous(claim, { effectName: "deliver" })).resolves.toBe(
		"applied",
	);
	expect(calls.map(({ statement }) => statement)).toEqual([
		durableKernelMarker,
		durableEffectFence,
		durableEffectAmbiguous,
		durableEventSequenceBump,
		durableEventInsert,
	]);
	expect(calls[2]?.value).toEqual({
		application: "application:collaboration",
		runId: claim.runId,
		effectName: "deliver",
	});
});

test("a fenced ambiguous transition performs no write or event", async () => {
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
		createPostgresDatabaseDurableEffectAmbiguous({
			database,
			application: "application:collaboration",
		})(claim, { effectName: "deliver" }),
	).resolves.toBe("fenced");
	expect(statements).toEqual([durableKernelMarker, durableEffectFence]);
});

test("an already-ambiguous effect does not duplicate its event", async () => {
	const statements: unknown[] = [];
	const transaction = {
		async execute(statement) {
			statements.push(statement);
			if (statement === durableKernelMarker) return undefined;
			if (statement === durableEffectFence) return true;
			if (statement === durableEffectAmbiguous) return null;
			throw new TypeError("duplicate event must not execute");
		},
	} as PostgresTransaction;
	const database = {
		transaction: ({ use }) => use(transaction),
	} as PostgresTransactionRunner;

	await expect(
		createPostgresDatabaseDurableEffectAmbiguous({
			database,
			application: "application:collaboration",
		})(claim, { effectName: "deliver" }),
	).resolves.toBe("applied");
	expect(statements).toEqual([
		durableKernelMarker,
		durableEffectFence,
		durableEffectAmbiguous,
	]);
});

test("the static ambiguous statement closes parameters and results", () => {
	expect(
		durableEffectAmbiguous.parameters({
			application: "application:collaboration",
			runId: claim.runId,
			effectName: "e".repeat(63),
		}),
	).toEqual(["application:collaboration", claim.runId, "e".repeat(63)]);
	for (const effectName of ["", "e".repeat(64)])
		expect(() =>
			durableEffectAmbiguous.parameters({
				application: "application:collaboration",
				runId: claim.runId,
				effectName,
			}),
		).toThrow();
	expect(
		durableEffectAmbiguous.decode({ command: "UPDATE", rowCount: 0, rows: [] }),
	).toBeNull();
	expect(
		durableEffectAmbiguous.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [["018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3"]],
		}),
	).toBe("018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3");
	for (const result of [
		{ command: "SELECT", rowCount: 0, rows: [] },
		{ command: "UPDATE", rowCount: 1, rows: [] },
		{ command: "UPDATE", rowCount: 1, rows: [["bad"]] },
	] as const)
		expect(() => durableEffectAmbiguous.decode(result)).toThrow();
});
