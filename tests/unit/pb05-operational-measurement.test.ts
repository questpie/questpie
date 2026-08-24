import { expect, test } from "bun:test";

import {
	definePostgresStatement,
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";
import {
	createPb05OperationalMeasurement,
	instrumentPb05OwnedTransaction,
	instrumentPb05TransactionRunner,
	observePb05AcceptedCallback,
	pb05RepresentativeOperations,
} from "../support/pb05-operational-measurement";

test("PB-05 measurement inventories every representative database population", () => {
	expect(pb05RepresentativeOperations).toEqual({
		readiness: ["startup"],
		context: ["rootBootstrap"],
		query: ["firstPage", "cursorPage"],
		mutation: ["fresh", "replay"],
		realtime: ["reconciliation", "apply", "retention"],
		durable: [
			"claim",
			"heartbeat",
			"effectReserve",
			"effectSettle",
			"terminal",
			"maintenance",
		],
	});
	expect(Object.isFrozen(pb05RepresentativeOperations)).toBe(true);
	for (const operations of Object.values(pb05RepresentativeOperations))
		expect(Object.isFrozen(operations)).toBe(true);
});

test("pure measurement summarizes statements without deriving ceilings", () => {
	const measurement = createPb05OperationalMeasurement();
	let at = 0;
	for (const [population, operations] of Object.entries(
		pb05RepresentativeOperations,
	))
		for (const operation of operations) {
			measurement.statement({
				population,
				operation,
				name: `${population}.${operation}.one`,
				transaction: `${population}:${operation}`,
				startedAtMs: at,
				finishedAtMs: at + 2,
			});
			measurement.statement({
				population,
				operation,
				name: `${population}.${operation}.two`,
				transaction: `${population}:${operation}`,
				startedAtMs: at + 2,
				finishedAtMs: at + 3,
			});
			at += 4;
		}

	const snapshot = measurement.snapshot();
	expect(snapshot.status).toBe("PROVISIONAL_INTERNAL_EVIDENCE");
	expect(snapshot.publicCeilings).toBe(false);
	expect(snapshot.populations.readiness).toMatchObject({
		statementExecutions: 2,
		distinctStatements: 2,
		transactions: 1,
	});
	expect(snapshot.populations.durable).toMatchObject({
		statementExecutions: 12,
		distinctStatements: 12,
		transactions: 6,
	});
	expect(snapshot.operations["query:firstPage"]).toEqual({
		statementExecutions: 2,
		distinctStatements: ["query.firstPage.one", "query.firstPage.two"],
		transactions: 1,
		durationMs: 3,
	});
	expect(Object.isFrozen(snapshot)).toBe(true);
});

test("pure measurement separates idle gaps from contended lock waits", () => {
	const measurement = createPb05OperationalMeasurement();
	measurement.idleGap({
		population: "mutation",
		operation: "fresh",
		phase: "handler",
		startedAtMs: 10,
		finishedAtMs: 17,
	});
	measurement.idleGap({
		population: "realtime",
		operation: "apply",
		phase: "apply",
		startedAtMs: 20,
		finishedAtMs: 25,
	});
	for (const [owner, startedAtMs, acquiredAtMs, finishedAtMs] of [
		["maintenance", 30, 34, 38],
		["reconciliation", 40, 43, 47],
		["retention", 50, 52, 55],
	] as const)
		measurement.contention({
			owner,
			lockIdentity: `lock:${owner}`,
			startedAtMs,
			acquiredAtMs,
			finishedAtMs,
			outcome: "acquired",
		});

	const snapshot = measurement.snapshot({ requireCompleteInventory: false });
	expect(snapshot.idleGaps).toEqual({
		"mutation:fresh:handler": { count: 1, totalMs: 7, maxMs: 7 },
		"realtime:apply:apply": { count: 1, totalMs: 5, maxMs: 5 },
	});
	expect(snapshot.contention).toEqual({
		maintenance: { samples: 1, waitMs: 4, heldMs: 4, acquired: 1 },
		reconciliation: { samples: 1, waitMs: 3, heldMs: 4, acquired: 1 },
		retention: { samples: 1, waitMs: 2, heldMs: 3, acquired: 1 },
	});
});

test("accepted callback observer records the actual Mutation handler and realtime apply", async () => {
	const measurement = createPb05OperationalMeasurement();
	const clock = [10, 17, 20, 25];
	const calls: string[] = [];

	await expect(
		observePb05AcceptedCallback({
			measurement,
			population: "mutation",
			operation: "fresh",
			phase: "handler",
			now: () => clock.shift()!,
			use: async () => {
				calls.push("handler");
				return "mutation-result";
			},
		}),
	).resolves.toBe("mutation-result");
	await expect(
		observePb05AcceptedCallback({
			measurement,
			population: "realtime",
			operation: "apply",
			phase: "apply",
			now: () => clock.shift()!,
			use: async () => {
				calls.push("apply");
			},
		}),
	).resolves.toBeUndefined();

	expect(calls).toEqual(["handler", "apply"]);
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).idleGaps,
	).toEqual({
		"mutation:fresh:handler": { count: 1, totalMs: 7, maxMs: 7 },
		"realtime:apply:apply": { count: 1, totalMs: 5, maxMs: 5 },
	});
});

test("accepted callback observer validates before work and preserves its primary failure", async () => {
	const measurement = createPb05OperationalMeasurement();
	let calls = 0;
	await expect(
		observePb05AcceptedCallback({
			measurement,
			population: "realtime",
			operation: "reconciliation",
			phase: "apply",
			use: async () => {
				calls += 1;
			},
		}),
	).rejects.toThrow("invalid PB-05 idle-gap callback config");
	expect(calls).toBe(0);

	const primary = new Error("accepted callback failed");
	const clock = [10, 5];
	let rejected: unknown;
	try {
		await observePb05AcceptedCallback({
			measurement,
			population: "mutation",
			operation: "fresh",
			phase: "handler",
			now: () => clock.shift()!,
			use: async () => {
				throw primary;
			},
		});
	} catch (error) {
		rejected = error;
	}
	expect(rejected).toBe(primary);
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).idleGaps,
	).toEqual({});
});

test("measurement refuses missing inventory and malformed clocks", () => {
	const measurement = createPb05OperationalMeasurement();
	expect(() => measurement.snapshot()).toThrow(
		"missing PB-05 representative operation readiness:startup",
	);
	for (const observation of [
		{
			population: "query",
			operation: "firstPage",
			name: "query.first-page",
			transaction: "query:one",
			startedAtMs: 2,
			finishedAtMs: 1,
		},
		{
			population: "unknown",
			operation: "firstPage",
			name: "query.first-page",
			transaction: "query:one",
			startedAtMs: 1,
			finishedAtMs: 2,
		},
	])
		expect(() => measurement.statement(observation)).toThrow(
			"invalid PB-05 statement observation",
		);
});

test("transaction runner instrument records exact statements and preserves failures", async () => {
	const statement = definePostgresStatement({
		name: "query.representative",
		text: "select 1",
		parameterCount: 0,
		parameters: () => [],
		decode: () => "decoded",
	});
	const failureStatement = definePostgresStatement({
		name: "query.failure",
		text: "select 2",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});
	const failure = new Error("query failed");
	const modes: unknown[] = [];
	const database: PostgresTransactionRunner = {
		transaction: async ({ mode, use }) => {
			modes.push(mode);
			return use({
				[transactionBrand]: true,
				execute: async (executed) => {
					if (executed === failureStatement) throw failure;
					return "decoded" as never;
				},
			});
		},
	};
	const measurement = createPb05OperationalMeasurement();
	const clock = [1, 4, 10, 15];
	const instrumented = instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "query",
		operation: "firstPage",
		now: () => clock.shift()!,
	});

	await instrumented.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		use: async (transaction) => {
			await expect(transaction.execute(statement, undefined)).resolves.toBe(
				"decoded",
			);
			await expect(
				transaction.execute(failureStatement, undefined),
			).rejects.toBe(failure);
		},
	});

	expect(modes).toEqual([{ isolation: "repeatableRead", access: "readOnly" }]);
	expect(
		measurement.snapshot({ requireCompleteInventory: false }).operations[
			"query:firstPage"
		],
	).toEqual({
		statementExecutions: 2,
		distinctStatements: ["query.representative", "query.failure"],
		transactions: 1,
		durationMs: 14,
	});
});

test("transaction instrumentation rejects invalid config before database admission", () => {
	let transactions = 0;
	const database: PostgresTransactionRunner = {
		transaction: async () => {
			transactions += 1;
			return undefined;
		},
	};
	const measurement = createPb05OperationalMeasurement();

	expect(() =>
		instrumentPb05TransactionRunner({
			database,
			measurement,
			population: "query",
			operation: "unknown",
		}),
	).toThrow("invalid PB-05 instrumentation config");
	expect(transactions).toBe(0);
});

test("transaction instrumentation refuses an invalid start clock before SQL", async () => {
	const statement = definePostgresStatement({
		name: "query.clock",
		text: "select 1",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});
	for (const now of [
		() => Number.NaN,
		() => {
			throw new Error("clock unavailable");
		},
	]) {
		let executions = 0;
		const database: PostgresTransactionRunner = {
			transaction: ({ use }) =>
				use({
					[transactionBrand]: true,
					execute: async () => {
						executions += 1;
						return undefined as never;
					},
				}),
		};
		const instrumented = instrumentPb05TransactionRunner({
			database,
			measurement: createPb05OperationalMeasurement(),
			population: "query",
			operation: "firstPage",
			now,
		});

		await expect(
			instrumented.transaction({
				mode: { isolation: "repeatableRead", access: "readOnly" },
				use: (transaction) => transaction.execute(statement, undefined),
			}),
		).rejects.toThrow();
		expect(executions).toBe(0);
	}
});

test("observer and finish-clock failures cannot replace a database failure", async () => {
	const statement = definePostgresStatement({
		name: "query.primary-failure",
		text: "select 1",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});
	const primary = new Error("primary database failure");
	for (const clock of [
		[10, 5],
		[10, new Error("finish clock failed")],
	] as const) {
		const values = [...clock];
		const database: PostgresTransactionRunner = {
			transaction: ({ use }) =>
				use({
					[transactionBrand]: true,
					execute: async () => {
						throw primary;
					},
				}),
		};
		const instrumented = instrumentPb05TransactionRunner({
			database,
			measurement: createPb05OperationalMeasurement(),
			population: "query",
			operation: "firstPage",
			now: () => {
				const value = values.shift();
				if (value instanceof Error) throw value;
				return value!;
			},
		});

		await expect(
			instrumented.transaction({
				mode: { isolation: "repeatableRead", access: "readOnly" },
				use: (transaction) => transaction.execute(statement, undefined),
			}),
		).rejects.toBe(primary);
	}
});

test("observer failure after successful SQL remains visible", async () => {
	const statement = definePostgresStatement({
		name: "query.observer-failure",
		text: "select 1",
		parameterCount: 0,
		parameters: () => [],
		decode: () => "result",
	});
	const database: PostgresTransactionRunner = {
		transaction: ({ use }) =>
			use({
				[transactionBrand]: true,
				execute: async () => "result" as never,
			}),
	};
	const clock = [10, 5];
	const instrumented = instrumentPb05TransactionRunner({
		database,
		measurement: createPb05OperationalMeasurement(),
		population: "query",
		operation: "firstPage",
		now: () => clock.shift()!,
	});

	await expect(
		instrumented.transaction({
			mode: { isolation: "repeatableRead", access: "readOnly" },
			use: (transaction) => transaction.execute(statement, undefined),
		}),
	).rejects.toThrow("invalid PB-05 statement observation");
});

test("shared transaction observer keeps reconciliation and apply attribution distinct", async () => {
	const reconciliation = definePostgresStatement({
		name: "live-query.reconciliation",
		text: "select 1",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});
	const apply = definePostgresStatement({
		name: "live-query.apply",
		text: "select 2",
		parameterCount: 0,
		parameters: () => [],
		decode: () => undefined,
	});
	let transactions = 0;
	const database: PostgresTransactionRunner = {
		transaction: ({ use }) => {
			transactions += 1;
			return use({
				[transactionBrand]: true,
				execute: async () => undefined as never,
			});
		},
	};
	const measurement = createPb05OperationalMeasurement();
	const measured = instrumentPb05TransactionRunner({
		database,
		measurement,
		population: "realtime",
		operation: "reconciliation",
	});

	await measured.transaction({
		mode: { isolation: "repeatableRead", access: "readWrite" },
		use: async (transaction) => {
			await transaction.execute(reconciliation, undefined);
			const applyTransaction = instrumentPb05OwnedTransaction({
				transaction,
				measurement,
				population: "realtime",
				operation: "apply",
			});
			await applyTransaction.execute(apply, undefined);
		},
	});

	const snapshot = measurement.snapshot({ requireCompleteInventory: false });
	expect(transactions).toBe(1);
	expect(snapshot.populations.realtime).toEqual({
		statementExecutions: 2,
		distinctStatements: 2,
		transactions: 1,
	});
	expect(snapshot.operations["realtime:reconciliation"]).toMatchObject({
		statementExecutions: 1,
		distinctStatements: ["live-query.reconciliation"],
		transactions: 1,
	});
	expect(snapshot.operations["realtime:apply"]).toMatchObject({
		statementExecutions: 1,
		distinctStatements: ["live-query.apply"],
		transactions: 1,
	});
});

test("shared transaction observer refuses an uninstrumented owned transaction", () => {
	const transaction = {
		[transactionBrand]: true,
		execute: async () => undefined as never,
	};
	expect(() =>
		instrumentPb05OwnedTransaction({
			transaction,
			measurement: createPb05OperationalMeasurement(),
			population: "realtime",
			operation: "apply",
		}),
	).toThrow("PB-05 shared transaction is not instrumented");
});
