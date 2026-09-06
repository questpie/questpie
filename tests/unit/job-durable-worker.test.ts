import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
	createPostgresDatabaseDurableAttemptObservation,
	createPostgresDatabaseDurableKernel,
	runObservedDurableAttempt,
} from "../../packages/runtime/src/durable";
import { linkJobProjection } from "../../packages/runtime/src/durable/job-projection";
import { linkReactionProjection } from "../../packages/runtime/src/durable/projection";
import type {
	DurableClaim,
	DurableKernel,
	DurableTransition,
} from "../../packages/runtime/src/durable/rows";
import {
	createDurableWorker,
	type DurableAttemptExecution,
	type DurableWorkAttemptRequest,
} from "../../packages/runtime/src/durable/worker";
import {
	createObservationKernel,
	type ExecutionEventV2,
	type ObservationAdapterV1,
} from "../../packages/runtime/src/observation";
import {
	transactionBrand,
	type PostgresStatement,
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
			input: { kind: "object", properties: { companyId: { kind: "text" } } },
			output: { kind: "object", properties: { reportId: { kind: "text" } } },
			declaredErrors: {
				REJECTED: { code: "REJECTED", status: 422, payload: null },
			},
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
	reactions: [
		{
			identity: "reaction:messages.published",
			input: { kind: "object", properties: { messageId: { kind: "text" } } },
			output: {
				kind: "object",
				properties: { delivered: { kind: "boolean" } },
			},
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry,
			effects: ["deliver"],
			contractDigest: digest("c"),
			origin: {
				path: "src/message-published.ts",
				exportName: "messagePublished",
				packageId: null,
			},
		},
	],
});

function claim(
	input: Readonly<{
		resource: string;
		executableDigest: string;
		semanticVersion: number;
		payload: unknown;
	}>,
): DurableClaim {
	return Object.freeze({
		acceptanceTrace: null,
		runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
		dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
		resource: input.resource,
		semanticVersion: input.semanticVersion,
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
		contextInputBytes: new TextEncoder().encode(
			JSON.stringify({ tenant: "stored" }),
		),
		payloadBytes: new TextEncoder().encode(JSON.stringify(input.payload)),
		retry,
		runtimeBuildDigest: digest("a"),
		executableDigest: input.executableDigest,
		causationId: "cause:one",
		correlationId: "correlation:one",
		cancellationRequested: false,
	});
}

function kernelFor(
	claimed: DurableClaim,
	transition: DurableTransition = Object.freeze({
		status: "applied",
		state: "succeeded",
		deadLetter: false,
	}),
): Readonly<{
	kernel: DurableKernel;
	succeeded: Uint8Array[];
	failed: string[];
}> {
	const succeeded: Uint8Array[] = [];
	const failed: string[] = [];
	return {
		succeeded,
		failed,
		kernel: {
			application: "application:test",
			admit: async () => [
				{
					runId: claimed.runId,
					resource: claimed.resource,
					executableDigest: claimed.executableDigest,
				},
			],
			reapCancelled: async () => 0,
			claim: async () => ({ status: "claimed", claim: claimed }),
			heartbeat: async () => ({
				status: "held",
				cancellationRequested: false,
				deadlineExpired: false,
			}),
			succeed: async (_claim, bytes) => {
				succeeded.push(bytes);
				return transition;
			},
			fail: async (_claim, failure) => {
				failed.push(failure.code);
				return transition;
			},
			cancel: async () => transition,
			inspect: async () => null,
			events: async () => [],
		},
	};
}

const unusedLedger = {
	reserve: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	settle: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	markAmbiguous: async () => {
		throw new Error("Job must not reach the Reaction effect ledger");
	},
	read: async () => [],
} as never;
const attemptExecution: DurableAttemptExecution<undefined> = (
	_request,
	work,
) => {
	work.enter();
	return work.preparationError === undefined
		? work.use(undefined)
		: work.failure(work.preparationError);
};

test("executes and settles a Job through the shared worker without Reaction effects", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(claimed);
	const ownership: string[] = [];
	let request: DurableWorkAttemptRequest | undefined;
	const worker = createDurableWorker({
		kernel: {
			...state.kernel,
			succeed: async (claim, bytes) => {
				ownership.push("settlement");
				return state.kernel.succeed(claim, bytes);
			},
		},
		ledger: unusedLedger,
		reactions,
		jobs,
		workerId: "worker:test",
		attemptExecution: async (_attempt, work) => {
			ownership.push("attempt:start");
			work.enter();
			const outcome = await work.use(Object.freeze({ marker: "worker" }));
			ownership.push("attempt:end");
			return outcome;
		},
		execute: async (attempt, execution) => {
			ownership.push("handler");
			expect(execution).toEqual({ marker: "worker" });
			request = attempt;
			expect(attempt.capability).toBe("job");
			if (attempt.capability !== "job") throw new Error("expected Job");
			expect(attempt.job.identity).toBe("job:reports.companyDigest");
			expect(attempt.run).toEqual({
				id: claimed.runId,
				dispatchId: claimed.dispatchId,
			});
			expect("effect" in attempt.run).toBe(false);
			attempt.assertResolvedTenant("tenant:stored");
			return { reportId: "report:one" };
		},
	});

	expect(await worker.poll()).toMatchObject({
		admitted: 1,
		claimed: 1,
		outcomes: [{ outcome: "succeeded", failureCode: null }],
	});
	expect(request).toBeDefined();
	expect(JSON.parse(new TextDecoder().decode(state.succeeded[0]))).toEqual({
		reportId: "report:one",
	});
	expect(ownership).toEqual([
		"attempt:start",
		"handler",
		"settlement",
		"attempt:end",
	]);
});

test("settles a pre-cancelled claim without entering Context or handler work", async () => {
	const claimed = Object.freeze({
		...claim({
			resource: "job:reports.companyDigest",
			executableDigest: digest("b"),
			semanticVersion: 2,
			payload: { companyId: "company:one" },
		}),
		cancellationRequested: true,
	});
	const state = kernelFor(claimed);
	let handlerCalls = 0;
	let cancellationSettlements = 0;
	const worker = createDurableWorker({
		kernel: {
			...state.kernel,
			cancel: async (attempt) => {
				cancellationSettlements += 1;
				return state.kernel.cancel(attempt);
			},
		},
		ledger: unusedLedger,
		reactions,
		jobs,
		attemptExecution: (request, work) => {
			expect(request.signal.aborted).toBe(true);
			work.enter();
			return work.failure(request.signal.reason);
		},
		execute: async () => {
			handlerCalls += 1;
			return { reportId: "unreachable" };
		},
	});

	expect(await worker.poll()).toMatchObject({
		outcomes: [{ outcome: "cancelled", failureCode: null }],
	});
	expect(handlerCalls).toBe(0);
	expect(cancellationSettlements).toBe(1);
});

test("settles corrupt stored Context and pre-handler Context failures", async () => {
	for (const failure of ["stored-bytes", "context-bootstrap"] as const) {
		const base = claim({
			resource: "job:reports.companyDigest",
			executableDigest: digest("b"),
			semanticVersion: 2,
			payload: { companyId: "company:one" },
		});
		const claimed = Object.freeze({
			...base,
			...(failure === "stored-bytes"
				? { contextInputBytes: new TextEncoder().encode("{") }
				: {}),
		});
		const state = kernelFor(claimed);
		let handlerCalls = 0;
		const worker = createDurableWorker({
			kernel: state.kernel,
			ledger: unusedLedger,
			reactions,
			jobs,
			attemptExecution: (_request, work) => {
				work.enter();
				if (failure === "stored-bytes") {
					expect(work.preparationError).toBeInstanceOf(SyntaxError);
					return work.failure(work.preparationError);
				}
				return work.failure(new Error("Context bootstrap failed"));
			},
			execute: async () => {
				handlerCalls += 1;
				return { reportId: "unreachable" };
			},
		});

		expect(await worker.poll()).toMatchObject({
			outcomes: [{ outcome: "failed", failureCode: "HANDLER_FAILED" }],
		});
		expect(handlerCalls).toBe(0);
		expect(state.failed).toEqual(["HANDLER_FAILED"]);
	}
});

test("retries an ordinary Job handler failure through the shared kernel", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({
			status: "applied",
			state: "delayed",
			deadLetter: false,
			retryDelayMilliseconds: 750,
		}),
	);
	const worker = createDurableWorker({
		attemptExecution,
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async () => {
			throw new Error("transient Job failure");
		},
	});

	expect((await worker.poll()).outcomes).toEqual([
		expect.objectContaining({
			outcome: "retryScheduled",
			failureCode: "HANDLER_FAILED",
			retryDelayMilliseconds: 750,
		}),
	]);
	expect(state.failed).toEqual(["HANDLER_FAILED"]);
});

test("fails a Job before handler work when fresh Context resolves another Tenant", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({ status: "applied", state: "failed", deadLetter: true }),
	);
	let handlerReached = false;
	const worker = createDurableWorker({
		attemptExecution,
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async (attempt) => {
			attempt.assertResolvedTenant("tenant:changed");
			handlerReached = true;
			return { reportId: "report:must-not-exist" };
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "failed",
		failureCode: "RUN_AS_DENIED",
	});
	expect(handlerReached).toBe(false);
	expect(state.failed).toEqual(["RUN_AS_DENIED"]);
});

test("settles a declared Job error permanently through the shared failure vocabulary", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const state = kernelFor(
		claimed,
		Object.freeze({ status: "applied", state: "failed", deadLetter: true }),
	);
	const worker = createDurableWorker({
		attemptExecution,
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async (attempt) => {
			if (attempt.capability !== "job") throw new Error("expected Job");
			throw attempt.errors.REJECTED!({ reason: "blocked" });
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "failed",
		failureCode: "REACTION_ERROR",
	});
	expect(state.failed).toEqual(["REACTION_ERROR"]);
});

test("refuses an incompatible Job before claim", async () => {
	let claims = 0;
	const kernel = kernelFor(
		claim({
			resource: "job:reports.companyDigest",
			executableDigest: digest("d"),
			semanticVersion: 2,
			payload: { companyId: "company:one" },
		}),
	).kernel;
	const worker = createDurableWorker({
		attemptExecution,
		kernel: { ...kernel, claim: async () => (claims += 1) as never },
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async () => {
			throw new Error("incompatible Job must not execute");
		},
	});

	expect((await worker.poll()).outcomes).toEqual([
		expect.objectContaining({
			outcome: "refusedIncompatible",
			failureCode: "EXECUTABLE_RETIRED",
		}),
	]);
	expect(claims).toBe(0);
});

test("executes a Reaction and its effect surface through the shared worker", async () => {
	const claimed = claim({
		resource: "reaction:messages.published",
		executableDigest: digest("c"),
		semanticVersion: 1,
		payload: { messageId: "message:one" },
	});
	const state = kernelFor(claimed);
	const worker = createDurableWorker({
		attemptExecution,
		kernel: state.kernel,
		ledger: unusedLedger,
		reactions,
		jobs,
		execute: async (attempt) => {
			expect(attempt.capability).toBe("reaction");
			expect(attempt.reaction.identity).toBe("reaction:messages.published");
			expect(typeof attempt.run.effect).toBe("function");
			return { delivered: true };
		},
	});

	expect((await worker.poll()).outcomes[0]).toMatchObject({
		outcome: "succeeded",
		failureCode: null,
	});
});

test("refuses worker work before the single Attempt entry", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	let handlerCalls = 0;
	const worker = createDurableWorker({
		attemptExecution: (_request, work) => work.use(undefined),
		execute: async () => {
			handlerCalls += 1;
			return { reportId: "unreachable" };
		},
		jobs,
		kernel: kernelFor(claimed).kernel,
		ledger: unusedLedger,
		reactions,
	});

	await expect(worker.poll()).rejects.toThrow(
		"Durable Attempt was not entered",
	);
	expect(handlerCalls).toBe(0);
});

test("waits for an in-flight automatic heartbeat before terminal settlement", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	let heartbeatStarted: () => void = () => undefined;
	const started = new Promise<void>((resolve) => {
		heartbeatStarted = resolve;
	});
	let releaseHeartbeat: () => void = () => undefined;
	const released = new Promise<void>((resolve) => {
		releaseHeartbeat = resolve;
	});
	let settlements = 0;
	const state = kernelFor(claimed);
	const worker = createDurableWorker({
		attemptExecution,
		execute: async () => {
			await started;
			return { reportId: "report:one" };
		},
		heartbeatMilliseconds: 1,
		jobs,
		kernel: {
			...state.kernel,
			heartbeat: async () => {
				heartbeatStarted();
				await released;
				return {
					status: "held" as const,
					cancellationRequested: false,
					deadlineExpired: false,
				};
			},
			succeed: async (...input) => {
				settlements += 1;
				return state.kernel.succeed(...input);
			},
		},
		ledger: unusedLedger,
		reactions,
	});

	const polling = worker.poll();
	await started;
	await new Promise((resolve) => setTimeout(resolve, 0));
	const settlementsBeforeRelease = settlements;
	releaseHeartbeat();
	await polling;
	expect(settlementsBeforeRelease).toBe(0);
	expect(settlements).toBe(1);
});

test("marks the Runtime-owned Attempt deadline with TimeoutError", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	let deadlineReason: unknown;
	const state = kernelFor(claimed);
	const worker = createDurableWorker({
		attemptExecution,
		execute: async (attempt) => {
			await attempt.attempt.heartbeat();
			deadlineReason = attempt.signal.reason;
			return { reportId: "report:one" };
		},
		jobs,
		kernel: {
			...state.kernel,
			heartbeat: async () => ({
				status: "held",
				cancellationRequested: false,
				deadlineExpired: true,
			}),
		},
		ledger: unusedLedger,
		reactions,
	});

	await worker.poll();
	expect(deadlineReason).toBeInstanceOf(DOMException);
	expect((deadlineReason as DOMException).name).toBe("TimeoutError");
});

test("keeps automatic heartbeat and terminal SQL inside the active Job Attempt", async () => {
	const claimed = claim({
		resource: "job:reports.companyDigest",
		executableDigest: digest("b"),
		semanticVersion: 2,
		payload: { companyId: "company:one" },
	});
	const statementNames: string[] = [];
	let heartbeatObserved: () => void = () => undefined;
	const heartbeat = new Promise<void>((resolve) => {
		heartbeatObserved = resolve;
	});
	const database: PostgresTransactionRunner = {
		transaction: (input) =>
			input.use({
				[transactionBrand]: true,
				async execute(statement: PostgresStatement<unknown, unknown>) {
					statementNames.push(statement.name);
					switch (statement.name) {
						case "durable.kernel.mark":
						case "durable.terminal.attempt":
						case "durable.event.insert":
							return undefined as never;
						case "durable.heartbeat.run":
							return {
								held: true,
								cancellationRequested: false,
							} as never;
						case "durable.heartbeat.attempt":
							heartbeatObserved();
							return { found: true, deadlineExpired: false } as never;
						case "durable.terminal.run":
							return { state: "succeeded" } as never;
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
		application: "application:test",
		runtimeBuildDigest: digest("a"),
		database,
		attemptDatabase: attemptPostgres.database,
		reactions,
		jobs,
	});
	const parents: string[] = [];
	const active = new AsyncLocalStorage<string>();
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
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
	const events: ExecutionEventV2[] = [];
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:test",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: digest("a"),
	});
	const execution = observation.beginExecution({
		entry: "worker",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (!execution) throw new Error("expected worker Execution");
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
							return work.use(undefined);
						},
					}),
			}),
		execute: async () => {
			await heartbeat;
			return { reportId: "report:one" };
		},
		heartbeatMilliseconds: 1,
		kernel: {
			...databaseKernel,
			admit: async () => [
				{
					executableDigest: claimed.executableDigest,
					resource: claimed.resource,
					runId: claimed.runId,
				},
			],
			reapCancelled: async () => 0,
			claim: async () => ({ status: "claimed", claim: claimed }),
		},
		ledger: unusedLedger,
		leaseMilliseconds: 100,
		reactions,
		jobs,
	});

	await expect(execution.scope.run(() => worker.poll())).resolves.toMatchObject(
		{
			outcomes: [{ outcome: "succeeded", failureCode: null }],
		},
	);
	expect(statementNames).toEqual([
		"durable.kernel.mark",
		"durable.heartbeat.run",
		"durable.heartbeat.attempt",
		"durable.kernel.mark",
		"durable.terminal.run",
		"durable.terminal.attempt",
		"durable.event.sequence.bump",
		"durable.event.insert",
	]);
	expect(parents).toEqual(statementNames.map(() => "job.attempt"));
	expect(
		events
			.filter(
				(event) =>
					event.kind === "scope.started" && event.scopeKind === "postgresql",
			)
			.map((event) =>
				event.kind === "scope.started" && event.start.kind === "postgresql"
					? [event.start.databaseOperation, event.start.statementIdentity]
					: null,
			),
	).toEqual([
		["SELECT", "durable.kernel.mark"],
		["UPDATE", "durable.heartbeat.run"],
		["UPDATE", "durable.heartbeat.attempt"],
		["SELECT", "durable.kernel.mark"],
		["UPDATE", "durable.terminal.run"],
		["UPDATE", "durable.terminal.attempt"],
		["UPDATE", "durable.event.sequence.bump"],
		["INSERT", "durable.event.insert"],
	]);
});
