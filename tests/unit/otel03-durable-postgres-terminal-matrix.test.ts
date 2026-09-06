import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
	createPostgresDatabaseDurableAttemptObservation,
	createPostgresDatabaseDurableKernel,
	runObservedDurableAttempt,
} from "../../packages/runtime/src/durable";
import { linkJobProjection } from "../../packages/runtime/src/durable/job-projection";
import { linkReactionProjection } from "../../packages/runtime/src/durable/projection";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";
import { createDurableWorker } from "../../packages/runtime/src/durable/worker";
import {
	createObservationKernel,
	type ObservationAdapterV1,
} from "../../packages/runtime/src/observation";
import {
	transactionBrand,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";

const digest = (character: string) => character.repeat(64);
const retry = Object.freeze({
	maximumAttempts: 3,
	initialDelayMilliseconds: 1_000,
	backoff: "exponential" as const,
	maximumDelayMilliseconds: 60_000,
	jitter: "full" as const,
	horizonMilliseconds: 86_400_000,
});
const jobs = linkJobProjection({
	format: "questpie.job-projection",
	version: 1,
	jobs: [
		{
			identity: "job:reports.companyDigest",
			semanticVersion: 2,
			input: {
				kind: "object",
				properties: { companyId: { kind: "text" } },
			},
			output: {
				kind: "object",
				properties: { reportId: { kind: "text" } },
			},
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry,
			signals: {},
			schedule: null,
			contractDigest: digest("b"),
			origin: {
				path: "src/company-digest.ts",
				exportName: "companyDigest",
				packageId: null,
			},
		},
	],
});
const reactions = linkReactionProjection({
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [],
});
const unusedLedger = Object.freeze({
	reserve: async () => {
		throw new Error("Job must not reserve a Reaction effect");
	},
	settle: async () => {
		throw new Error("Job must not settle a Reaction effect");
	},
	markAmbiguous: async () => {
		throw new Error("Job must not mark a Reaction effect ambiguous");
	},
	read: async () => [],
}) as never;

function durableClaim(
	input: Readonly<{
		cancellationRequested?: boolean;
		contextInputBytes?: Uint8Array;
		payload: unknown;
	}>,
): DurableClaim {
	return Object.freeze({
		acceptanceTrace: null,
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
		resource: "job:reports.companyDigest",
		semanticVersion: 2,
		attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
		attemptNumber: 1,
		queueDelayMilliseconds: 125,
		leaseToken: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203",
		leaseMilliseconds: 30_000,
		leaseExpiresAt: new Date("2026-08-25T00:00:30.000Z"),
		deadlineAt: new Date("2026-08-25T00:05:00.000Z"),
		workerId: "worker:test",
		tenantId: "tenant:stored",
		principal: Object.freeze({ kind: "user" as const, id: "user:one" }),
		contextInputBytes:
			input.contextInputBytes ?? new TextEncoder().encode("{}"),
		payloadBytes: new TextEncoder().encode(JSON.stringify(input.payload)),
		retry,
		runtimeBuildDigest: digest("a"),
		executableDigest: digest("b"),
		causationId: "cause:one",
		correlationId: "correlation:one",
		cancellationRequested: input.cancellationRequested ?? false,
	});
}

test("keeps every non-success terminal branch on the active Attempt PostgreSQL carrier", async () => {
	const retryStatements = [
		"durable.kernel.mark",
		"durable.retry.run",
		"durable.terminal.attempt",
		"durable.event.sequence.bump",
		"durable.event.insert",
	];
	const terminalStatements = [
		"durable.kernel.mark",
		"durable.terminal.run",
		"durable.terminal.attempt",
		"durable.event.sequence.bump",
		"durable.event.insert",
	];
	const scenarios = [
		{
			name: "retry",
			claim: durableClaim({ payload: { companyId: "company:one" } }),
			execute: async () => {
				throw new Error("retry me");
			},
			statements: retryStatements,
			outcome: "retryScheduled",
			failureCode: "HANDLER_FAILED",
		},
		{
			name: "permanent validation failure",
			claim: durableClaim({ payload: { companyId: 42 } }),
			execute: async () => {
				throw new Error("invalid input must not reach the handler");
			},
			statements: terminalStatements,
			outcome: "failed",
			failureCode: "VALIDATION_FAILED",
		},
		{
			name: "pre-cancelled",
			claim: durableClaim({
				cancellationRequested: true,
				payload: { companyId: "company:one" },
			}),
			execute: async () => ({ reportId: "ignored" }),
			statements: terminalStatements,
			outcome: "cancelled",
			failureCode: null,
		},
		{
			name: "preparation failure",
			claim: durableClaim({
				contextInputBytes: new TextEncoder().encode("{"),
				payload: { companyId: "company:one" },
			}),
			execute: async () => {
				throw new Error("invalid Context must not reach the handler");
			},
			statements: retryStatements,
			outcome: "retryScheduled",
			failureCode: "HANDLER_FAILED",
		},
	] as const;

	for (const scenario of scenarios) {
		const statements: string[] = [];
		const observed: Array<Readonly<{ parent: string; principalKind: string }>> =
			[];
		const active = new AsyncLocalStorage<string>();
		const adapter: ObservationAdapterV1 = Object.freeze({
			format: "questpie.runtime-observability",
			version: 1,
			extract: () => null,
			begin(input) {
				if (input.kind === "postgresql")
					observed.push({
						parent: active.getStore() ?? "none",
						principalKind: input.principalKind,
					});
				return Object.freeze({
					context: null,
					run: async <Result>(use: () => Result | Promise<Result>) =>
						await active.run(input.kind, use),
					event: () => undefined,
					end: () => undefined,
				});
			},
		});
		const observation = createObservationKernel({
			adapter,
			applicationIdentity: "application:terminal-matrix",
			createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
			runtimeBuildDigest: digest("a"),
		});
		const execution = observation.beginExecution({
			entry: "worker",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		});
		if (!execution) throw new Error("expected worker Execution");
		const database: PostgresTransactionRunner = {
			transaction: (input) =>
				input.use({
					[transactionBrand]: true,
					async execute(statement, value) {
						statements.push(statement.name);
						switch (statement.name) {
							case "durable.kernel.mark":
							case "durable.terminal.attempt":
							case "durable.event.insert":
								return undefined as never;
							case "durable.retry.run":
								return { state: "delayed" } as never;
							case "durable.terminal.run":
								return {
									state: (value as Readonly<{ state: string }>).state,
								} as never;
							case "durable.event.sequence.bump":
								return { sequence: 1 } as never;
							default:
								throw new TypeError(`unexpected ${statement.name}`);
						}
					},
				}),
		};
		const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
			database,
		});
		const databaseKernel = createPostgresDatabaseDurableKernel({
			application: "application:terminal-matrix",
			runtimeBuildDigest: digest("a"),
			attemptDatabase: attemptPostgres.database,
			database,
			jobs,
			reactions,
			random: () => 0,
		});
		const worker = createDurableWorker({
			attemptExecution: (request, work) =>
				runObservedDurableAttempt({
					observation: execution.observation,
					request,
					use: () =>
						attemptPostgres.run({
							observation: execution.observation,
							principalKind: request.principal.kind,
							signal: request.signal,
							use: () => {
								work.enter();
								return work.preparationError === undefined
									? work.use(undefined)
									: work.failure(work.preparationError);
							},
						}),
				}),
			execute: scenario.execute,
			heartbeatMilliseconds: 10_000,
			jobs,
			kernel: {
				...databaseKernel,
				admit: async () => [
					{
						executableDigest: scenario.claim.executableDigest,
						resource: scenario.claim.resource,
						runId: scenario.claim.runId,
					},
				],
				reapCancelled: async () => 0,
				claim: async () => ({ status: "claimed", claim: scenario.claim }),
			},
			leaseMilliseconds: 30_000,
			ledger: unusedLedger,
			reactions,
		});

		const result = await execution.scope.run(() => worker.poll());
		expect(result.outcomes[0], scenario.name).toMatchObject({
			outcome: scenario.outcome,
			failureCode: scenario.failureCode,
		});
		expect(statements, scenario.name).toEqual(scenario.statements);
		expect(observed, scenario.name).toEqual(
			scenario.statements.map(() => ({
				parent: "job.attempt",
				principalKind: "user",
			})),
		);
	}
});
