import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
	createPostgresDatabaseDurableKernel,
	createPostgresDatabaseDurableAttemptObservation,
	createPostgresDatabaseDurableEffectLedger,
	type DurableClaim,
} from "../../packages/runtime/src/durable";
import {
	createObservationKernel,
	type ExecutionEventV2,
	type ObservationAdapterV1,
} from "../../packages/runtime/src/observation";
import {
	definePostgresStatement,
	QuestpiePostgresError,
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

const statement = definePostgresStatement({
	name: "durable.attempt.probe",
	operation: "SELECT",
	text: "SELECT attempt-owned state",
	parameterCount: 0,
	parameters: () => [],
	decode: () => "ok",
});

function parentRecordingAdapter(parents: string[]): ObservationAdapterV1 {
	const active = new AsyncLocalStorage<string>();
	return Object.freeze({
		format: "questpie.runtime-observability" as const,
		version: 1 as const,
		extract: () => null,
		begin(input) {
			if (input.kind === "postgresql")
				parents.push(active.getStore() ?? "none");
			return Object.freeze({
				context: null,
				run: async <Result>(use: () => Result | Promise<Result>) =>
					await active.run(input.kind, use),
				event: () => undefined,
				end: () => undefined,
			});
		},
	});
}

test("requires one explicit Attempt observation decision and parents its SQL", async () => {
	let transactions = 0;
	const database = {
		async transaction<Input>(input: {
			use(transaction: {
				execute(received: typeof statement): Promise<string>;
			}): Promise<Input>;
		}): Promise<Input> {
			transactions += 1;
			return input.use({
				[transactionBrand]: true as const,
				async execute(received) {
					expect(received).toBe(statement);
					return "ok";
				},
			});
		},
	} as PostgresTransactionRunner;
	const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
		database,
	});

	await expect(
		attemptPostgres.database.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use: (transaction) => transaction.execute(statement, undefined),
		}),
	).rejects.toThrow(
		"Durable Attempt PostgreSQL observation decision is required",
	);
	expect(transactions).toBe(0);

	await expect(
		attemptPostgres.run({
			observation: null,
			principalKind: "service",
			signal: undefined,
			use: () =>
				attemptPostgres.database.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					use: (transaction) => transaction.execute(statement, undefined),
				}),
		}),
	).resolves.toBe("ok");

	const events: ExecutionEventV2[] = [];
	const parents: string[] = [];
	const kernel = createObservationKernel({
		adapter: parentRecordingAdapter(parents),
		applicationIdentity: "application:durable-attempt-test",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = kernel.beginExecution({
		entry: "worker",
		kind: "execution",
		principalKind: "service",
		trace: { kind: "root" },
	});
	if (!execution) throw new Error("expected worker Execution");
	const attempt = execution.observation.begin({
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
		attemptNumber: 1,
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
		kind: "reaction.attempt",
		principalKind: "service",
		resourceIdentity: "reaction:messages.published",
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
		trace: { kind: "root" },
	});

	await expect(
		execution.scope.run(() =>
			attempt.run(() =>
				attemptPostgres.run({
					observation: execution.observation,
					principalKind: "service",
					signal: undefined,
					use: () =>
						attemptPostgres.database.transaction({
							mode: { isolation: "readCommitted", access: "readOnly" },
							use: (transaction) => transaction.execute(statement, undefined),
						}),
				}),
			),
		),
	).resolves.toBe("ok");
	expect(parents).toEqual(["reaction.attempt"]);
	expect(events.filter((event) => event.scopeKind === "postgresql")).toEqual([
		expect.objectContaining({
			kind: "scope.started",
			start: {
				databaseOperation: "SELECT",
				kind: "postgresql",
				statementIdentity: statement.name,
			},
		}),
		expect.objectContaining({
			end: { kind: "postgresql", outcome: "ok" },
			kind: "scope.ended",
		}),
	]);
});

test("refuses a raw runner in Attempt-owned Durable adapters", () => {
	const database: PostgresTransactionRunner = {
		transaction: () => Promise.reject(new Error("database must not run")),
	};
	expect(() =>
		createPostgresDatabaseDurableKernel({
			application: "application:durable-attempt-test",
			runtimeBuildDigest: "d".repeat(64),
			attemptDatabase: database as never,
			database,
			reactions: { byIdentity: new Map() } as never,
		}),
	).toThrow("Durable Attempt PostgreSQL runner is required");
	expect(() =>
		createPostgresDatabaseDurableEffectLedger({
			application: "application:durable-attempt-test",
			attemptDatabase: database as never,
			database,
		}),
	).toThrow("Durable Attempt PostgreSQL runner is required");
});

test("preserves Attempt PostgreSQL errors while closing safe cancellation outcomes", async () => {
	const scenarios = [
		{
			name: "framework_error",
			error: new Error("framework secret must not escape"),
			reason: undefined,
			expected: { outcome: "framework_error" },
		},
		{
			name: "cancelled",
			error: new QuestpiePostgresError({
				code: "cancelled",
				phase: "statement",
				statementName: statement.name,
			}),
			reason: new DOMException("caller secret", "AbortError"),
			expected: { errorCode: "cancelled", outcome: "cancelled" },
		},
		{
			name: "deadline",
			error: new QuestpiePostgresError({
				code: "cancelled",
				phase: "statement",
				statementName: statement.name,
			}),
			reason: new DOMException("deadline secret", "TimeoutError"),
			expected: { errorCode: "cancelled", outcome: "deadline" },
		},
	] as const;

	for (const scenario of scenarios) {
		const controller = new AbortController();
		if (scenario.reason !== undefined) controller.abort(scenario.reason);
		const database: PostgresTransactionRunner = {
			transaction: (input) =>
				input.use({
					[transactionBrand]: true,
					execute: () => Promise.reject(scenario.error),
				}),
		};
		const events: ExecutionEventV2[] = [];
		const kernel = createObservationKernel({
			applicationIdentity: "application:durable-attempt-test",
			createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
			events: (event) => events.push(event),
			runtimeBuildDigest: "d".repeat(64),
		});
		const execution = kernel.beginExecution({
			entry: "worker",
			kind: "execution",
			principalKind: "service",
			trace: { kind: "root" },
		});
		if (!execution) throw new Error("expected worker Execution");
		const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
			database,
		});

		await expect(
			execution.scope.run(() =>
				attemptPostgres.run({
					observation: execution.observation,
					principalKind: "service",
					signal: controller.signal,
					use: () =>
						attemptPostgres.database.transaction({
							mode: { isolation: "readCommitted", access: "readOnly" },
							use: (transaction) => transaction.execute(statement, undefined),
						}),
				}),
			),
		).rejects.toBe(scenario.error);
		const ended = events.find(
			(event) =>
				event.kind === "scope.ended" && event.scopeKind === "postgresql",
		);
		expect(ended, scenario.name).toMatchObject({ end: scenario.expected });
		expect(JSON.stringify(ended)).not.toContain("secret");
	}
});

test("observes Reaction effect writes but leaves external effect inspection raw", async () => {
	const statementNames: string[] = [];
	let reserved: Readonly<{ effectId: string; inputDigest: string }> | undefined;
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(statement, value) {
					statementNames.push(statement.name);
					switch (statement.name) {
						case "durable.kernel.mark":
						case "durable.effect.reservation.insert":
						case "durable.event.insert":
							if (statement.name === "durable.effect.reservation.insert")
								reserved = value as typeof reserved;
							return undefined as never;
						case "durable.effect.fence":
							return true as never;
						case "durable.effect.reservation.read":
							if (!reserved) throw new Error("reservation was not inserted");
							return {
								...reserved,
								status: "pending",
								receipt: null,
							} as never;
						case "durable.effect.settle":
						case "durable.effect.ambiguous":
							return reserved?.effectId as never;
						case "durable.event.sequence.bump":
							return { sequence: 1 } as never;
						case "durable.effect.read":
							return [] as never;
						default:
							throw new TypeError(`unexpected ${statement.name}`);
					}
				},
			}),
	};
	const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
		database,
	});
	const ledger = createPostgresDatabaseDurableEffectLedger({
		application: "application:durable-effect-test",
		attemptDatabase: attemptPostgres.database,
		database,
	});
	const claim = Object.freeze({
		acceptanceTrace: null,
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
		attemptNumber: 1,
		cancellationRequested: false,
		causationId: "cause:one",
		contextInputBytes: new TextEncoder().encode("{}"),
		correlationId: "correlation:one",
		deadlineAt: new Date("2026-08-25T00:05:00.000Z"),
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
		executableDigest: "e".repeat(64),
		leaseExpiresAt: new Date("2026-08-25T00:00:30.000Z"),
		leaseMilliseconds: 30_000,
		leaseToken: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203",
		payloadBytes: new TextEncoder().encode("{}"),
		principal: { id: "service:worker", kind: "service" },
		resource: "reaction:messages.published",
		retry: {
			backoff: "exponential",
			horizonMilliseconds: 86_400_000,
			initialDelayMilliseconds: 1_000,
			jitter: "full",
			maximumAttempts: 3,
			maximumDelayMilliseconds: 60_000,
		},
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
		runtimeBuildDigest: "d".repeat(64),
		semanticVersion: 1,
		tenantId: "tenant:stored",
		workerId: "worker:test",
	}) satisfies DurableClaim;
	const events: ExecutionEventV2[] = [];
	const parents: string[] = [];
	const kernel = createObservationKernel({
		adapter: parentRecordingAdapter(parents),
		applicationIdentity: "application:durable-effect-test",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = kernel.beginExecution({
		entry: "worker",
		kind: "execution",
		principalKind: "service",
		trace: { kind: "root" },
	});
	if (!execution) throw new Error("expected worker Execution");
	const attempt = execution.observation.begin({
		attemptId: claim.attemptId,
		attemptNumber: claim.attemptNumber,
		dispatchId: claim.dispatchId,
		kind: "reaction.attempt",
		principalKind: "service",
		resourceIdentity: claim.resource,
		runId: claim.runId,
		trace: { kind: "root" },
	});

	await execution.scope.run(() =>
		attempt.run(() =>
			attemptPostgres.run({
				observation: execution.observation,
				principalKind: "service",
				signal: undefined,
				use: async () => {
					expect(
						await ledger.reserve(claim, {
							effectName: "deliver",
							input: { message: "hello" },
						}),
					).toMatchObject({ status: "reserved" });
					expect(
						await ledger.settle(claim, {
							effectName: "deliver",
							receipt: "receipt:one",
						}),
					).toBe("applied");
					expect(
						await ledger.markAmbiguous(claim, { effectName: "deliver" }),
					).toBe("applied");
				},
			}),
		),
	);
	const observedStatementCount = statementNames.length;
	await expect(ledger.read(claim.runId)).resolves.toEqual([]);

	expect(parents).toEqual(
		Array.from({ length: observedStatementCount }, () => "reaction.attempt"),
	);
	expect(statementNames.at(-1)).toBe("durable.effect.read");
	expect(
		events.filter(
			(event) =>
				event.kind === "scope.started" && event.scopeKind === "postgresql",
		),
	).toHaveLength(observedStatementCount);
});
