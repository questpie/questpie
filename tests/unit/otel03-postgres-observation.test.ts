import { expect, test } from "bun:test";

import {
	createObservationKernel,
	type ExecutionEventV2,
} from "../../packages/runtime/src/observation";
import { observePostgresTransaction } from "../../packages/runtime/src/observation/postgres";
import {
	definePostgresAdministrativeStatement,
	definePostgresStatement,
	transactionBrand,
	type PostgresTransaction,
} from "../../packages/runtime/src/postgres/contract";

const statement = definePostgresStatement({
	name: "tickets.detail",
	operation: "SELECT",
	text: "SELECT id FROM tickets WHERE id = $1",
	parameterCount: 1,
	parameters: (id: string) => [id],
	decode: () => Object.freeze({ id: "ticket-1" }),
});

function execution(events: ExecutionEventV2[]) {
	const kernel = createObservationKernel({
		applicationIdentity: "supportDesk",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "a".repeat(64),
		wallClock: () => new Date("2026-08-31T12:00:00.000Z"),
	});
	const observed = kernel.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (observed === null) throw new Error("expected observed execution");
	return observed;
}

test("observes one compiler-owned PostgreSQL statement under its exact Execution", async () => {
	const events: ExecutionEventV2[] = [];
	const observed = execution(events);
	let calls = 0;
	const result = Object.freeze({ id: "ticket-1" });
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute(received, value) {
			calls += 1;
			expect(received).toBe(statement);
			expect(value).toBe("ticket-1");
			return result as never;
		},
	};
	const wrapped = observePostgresTransaction({
		execution: observed.observation,
		failure: () => ({ outcome: "framework_error" }),
		principalKind: "user",
		transaction,
	});

	const returned = await observed.scope.run(() =>
		wrapped.execute(statement, "ticket-1"),
	);
	expect(returned).toBe(result);
	expect(calls).toBe(1);
	expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
		["scope.started", "execution"],
		["scope.started", "postgresql"],
		["scope.ended", "postgresql"],
	]);
	expect(events[1]).toMatchObject({
		executionId: events[0]!.executionId,
		executionSequence: events[0]!.executionSequence,
		principalKind: "user",
		start: {
			databaseOperation: "SELECT",
			kind: "postgresql",
			statementIdentity: "tickets.detail",
		},
	});
	expect(events[2]).toMatchObject({
		end: { kind: "postgresql", outcome: "ok" },
	});
	expect(JSON.stringify(events)).not.toContain(statement.text);
	expect(JSON.stringify(events)).not.toContain("ticket-1");
});

test("projects the complete closed PostgreSQL operation set without SQL inference", async () => {
	const events: ExecutionEventV2[] = [];
	const observed = execution(events);
	const operations = ["SELECT", "INSERT", "UPDATE", "DELETE", "CALL"] as const;
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute() {
			return undefined as never;
		},
	};
	const wrapped = observePostgresTransaction({
		execution: observed.observation,
		failure: () => ({ outcome: "framework_error" }),
		principalKind: "service",
		transaction,
	});

	for (const operation of operations)
		await wrapped.execute(
			definePostgresStatement({
				name: `closed.${operation.toLowerCase()}`,
				operation,
				text: "opaque compiler-owned SQL",
				parameterCount: 0,
				parameters: () => [],
				decode: () => undefined,
			}),
			undefined,
		);

	expect(
		events
			.filter(
				(event) =>
					event.kind === "scope.started" && event.scopeKind === "postgresql",
			)
			.map((event) =>
				event.kind === "scope.started" && event.start.kind === "postgresql"
					? event.start.databaseOperation
					: null,
			),
	).toEqual(operations);
});

test("preserves the database failure and closes the PostgreSQL scope once", async () => {
	const events: ExecutionEventV2[] = [];
	const observed = execution(events);
	const failure = new Error("private database detail");
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute() {
			throw failure;
		},
	};
	const wrapped = observePostgresTransaction({
		execution: observed.observation,
		failure: (error) => {
			expect(error).toBe(failure);
			return { errorCode: "queryFailed", outcome: "framework_error" };
		},
		principalKind: "service",
		transaction,
	});

	let caught: unknown;
	try {
		await wrapped.execute(statement, "ticket-1");
	} catch (error) {
		caught = error;
	}
	expect(caught).toBe(failure);
	expect(events.at(-1)).toMatchObject({
		end: {
			errorCode: "queryFailed",
			kind: "postgresql",
			outcome: "framework_error",
		},
	});
	expect(JSON.stringify(events)).not.toContain("private database detail");
});

test("refuses administrative statements and a second observation wrapper", async () => {
	const events: ExecutionEventV2[] = [];
	const observed = execution(events);
	let calls = 0;
	const transaction: PostgresTransaction = {
		[transactionBrand]: true,
		async execute() {
			calls += 1;
			return undefined as never;
		},
	};
	const wrapped = observePostgresTransaction({
		execution: observed.observation,
		failure: () => ({ outcome: "framework_error" }),
		principalKind: "service",
		transaction,
	});
	const administrative = definePostgresAdministrativeStatement({
		name: "readiness.search-path",
		text: "SET LOCAL search_path = pg_catalog",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});

	await expect(wrapped.execute(administrative, undefined)).rejects.toThrow(
		"administrative PostgreSQL statement cannot be observed",
	);
	expect(() =>
		observePostgresTransaction({
			execution: observed.observation,
			failure: () => ({ outcome: "framework_error" }),
			principalKind: "service",
			transaction: wrapped,
		}),
	).toThrow("PostgreSQL transaction is already observed");
	expect(calls).toBe(0);
});
