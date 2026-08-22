import { expect, test } from "bun:test";

import { appendPostgresDatabaseDurableRunEvent } from "../../packages/runtime/src/durable/postgres-database-event";
import {
	durableEventInsert,
	durableEventSequenceBump,
} from "../../packages/runtime/src/durable/postgres-statements";
import type { PostgresTransaction } from "../../packages/runtime/src/postgres/contract";

const input = Object.freeze({
	application: "application:collaboration",
	claim: Object.freeze({
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1",
		resource: "reaction:message.published",
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
		leaseToken: "lease:pb05",
		causationId: "call:pb05",
		correlationId: "call:pb05",
	}),
	kind: "effectSettled",
});

test("appends a Durable event through the exact static statement pair", async () => {
	const calls: Array<Readonly<{ statement: unknown; value: unknown }>> = [];
	const transaction = {
		async execute(statement, value) {
			calls.push({ statement, value });
			if (statement === durableEventSequenceBump)
				return Object.freeze({ sequence: 7 });
			if (statement === durableEventInsert) return undefined;
			throw new TypeError("unexpected Durable event statement");
		},
	} as PostgresTransaction;

	await appendPostgresDatabaseDurableRunEvent(transaction, input);

	expect(calls).toEqual([
		{
			statement: durableEventSequenceBump,
			value: {
				application: input.application,
				runId: input.claim.runId,
			},
		},
		{
			statement: durableEventInsert,
			value: {
				application: input.application,
				runId: input.claim.runId,
				sequence: 7,
				resource: input.claim.resource,
				dispatchId: input.claim.dispatchId,
				attemptId: input.claim.attemptId,
				leaseTokenDigest:
					"6bf615ef7aaf17a110703827bfff8f42cbcb5e842fc60afaf2dd1a69230ff024",
				causationId: input.claim.causationId,
				correlationId: input.claim.correlationId,
				kind: input.kind,
				errorCode: null,
			},
		},
	]);
});

test("a missing Durable run refuses the event insert", async () => {
	const statements: unknown[] = [];
	const transaction = {
		async execute(statement) {
			statements.push(statement);
			if (statement === durableEventSequenceBump) return null;
			throw new TypeError("event insert must not execute");
		},
	} as PostgresTransaction;

	await expect(
		appendPostgresDatabaseDurableRunEvent(transaction, input),
	).rejects.toThrow("Durable run history has no run");
	expect(statements).toEqual([durableEventSequenceBump]);
});

test("static Durable event statements reject malformed database results", () => {
	expect(
		durableEventSequenceBump.decode({
			command: "UPDATE",
			rowCount: 0,
			rows: [],
		}),
	).toBeNull();
	expect(
		durableEventSequenceBump.decode({
			command: "UPDATE",
			rowCount: 1,
			rows: [[8]],
		}),
	).toEqual({ sequence: 8 });
	for (const result of [
		{ command: "SELECT", rowCount: 1, rows: [[1]] },
		{ command: "UPDATE", rowCount: 0, rows: [[1]] },
		{ command: "UPDATE", rowCount: 1, rows: [] },
		{ command: "UPDATE", rowCount: 1, rows: [[0]] },
		{ command: "UPDATE", rowCount: 1, rows: [[1_025]] },
		{ command: "UPDATE", rowCount: 1, rows: [["1"]] },
	] as const)
		expect(() => durableEventSequenceBump.decode(result)).toThrow(
			"event sequence",
		);

	expect(
		durableEventInsert.decode({
			command: "INSERT",
			rowCount: 1,
			rows: [],
		}),
	).toBeUndefined();
	for (const result of [
		{ command: "UPDATE", rowCount: 1, rows: [] },
		{ command: "INSERT", rowCount: 0, rows: [] },
		{ command: "INSERT", rowCount: 1, rows: [[]] },
	] as const)
		expect(() => durableEventInsert.decode(result)).toThrow(
			"event insert result",
		);
});

test("static Durable event statements close their parameter contracts", () => {
	expect(
		durableEventSequenceBump.parameters({
			application: input.application,
			runId: input.claim.runId,
		}),
	).toEqual([input.application, input.claim.runId]);
	const validInsert = {
		application: input.application,
		runId: input.claim.runId,
		sequence: 1_024,
		resource: input.claim.resource,
		dispatchId: input.claim.dispatchId,
		attemptId: input.claim.attemptId,
		leaseTokenDigest: "a".repeat(64),
		causationId: input.claim.causationId,
		correlationId: input.claim.correlationId,
		kind: "failed" as const,
		errorCode: "HANDLER_FAILED" as const,
	};
	expect(durableEventInsert.parameters(validInsert)).toEqual([
		input.application,
		input.claim.runId,
		1_024,
		input.claim.resource,
		input.claim.dispatchId,
		input.claim.attemptId,
		"a".repeat(64),
		input.claim.causationId,
		input.claim.correlationId,
		"failed",
		"HANDLER_FAILED",
	]);
	for (const invalid of [
		{ ...validInsert, sequence: 0 },
		{ ...validInsert, sequence: 1_025 },
		{ ...validInsert, runId: "not-a-uuid" },
		{ ...validInsert, dispatchId: "not-a-uuid" },
		{ ...validInsert, attemptId: "not-a-uuid" },
		{ ...validInsert, leaseTokenDigest: "a".repeat(63) },
		{ ...validInsert, resource: "bad\0resource" },
		{ ...validInsert, kind: "unknown" },
		{ ...validInsert, errorCode: "UNKNOWN" },
	])
		expect(() =>
			durableEventInsert.parameters(
				invalid as Parameters<typeof durableEventInsert.parameters>[0],
			),
		).toThrow();
});
