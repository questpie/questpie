import { expect, test } from "bun:test";

import {
	runObservedDurableAttempt,
	type DurableAttemptExecutionRequest,
	type DurableWorkerOutcome,
} from "../../packages/runtime/src/durable";
import {
	createObservationKernel,
	type ExecutionEventV2,
	type ObservationAdapterV1,
	type ObservationStartV1,
} from "../../packages/runtime/src/observation";

const request = Object.freeze({
	acceptanceTrace: null,
	capability: "job" as const,
	attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
	attemptNumber: 2,
	contextInput: { tenant: "stored" },
	dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
	principal: Object.freeze({ kind: "user" as const, id: "user:one" }),
	resource: "job:reports.companyDigest",
	runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
	signal: new AbortController().signal,
}) satisfies DurableAttemptExecutionRequest;

function observedWorker() {
	const events: ExecutionEventV2[] = [];
	const kernel = createObservationKernel({
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = kernel.beginExecution({
		entry: "worker",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected worker Execution");
	return { events, execution };
}

test("observes a complete successful Job Attempt under one worker Execution", async () => {
	const { events, execution } = observedWorker();
	const outcome = Object.freeze({
		attemptNumber: 2,
		failureCode: null,
		outcome: "succeeded" as const,
		resource: request.resource,
		runId: request.runId,
	}) satisfies DurableWorkerOutcome;

	await execution.scope.run(() =>
		runObservedDurableAttempt({
			observation: execution.observation,
			request,
			use: async () => outcome,
		}),
	);
	const attempt = events.filter((event) => event.scopeKind === "job.attempt");
	expect(
		attempt.map((event) =>
			event.kind === "scope.event"
				? [event.kind, event.observationEvent.kind]
				: event.kind === "scope.ended"
					? [event.kind, event.end.outcome]
					: [event.kind],
		),
	).toEqual([
		["scope.started"],
		["scope.event", "durable.terminal"],
		["scope.ended", "ok"],
	]);
	expect(attempt[0]).toMatchObject({
		executionId: execution.identity.executionId,
		principalKind: "user",
		resourceIdentity: request.resource,
		start: {
			attemptId: request.attemptId,
			attemptNumber: 2,
			dispatchId: request.dispatchId,
			kind: "job.attempt",
			runId: request.runId,
		},
	});
});

test("starts each Attempt as a fresh root with its first-acceptance link", async () => {
	const acceptanceTrace = Object.freeze({
		format: "questpie.trace-context" as const,
		version: 1 as const,
		traceId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
		spanId: Uint8Array.from({ length: 8 }, (_, index) => index + 17),
		flags: 1,
	});
	const starts: ObservationStartV1[] = [];
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin(input) {
			starts.push(input);
			return Object.freeze({
				context: null,
				run: async <Result>(use: () => Result | Promise<Result>) => await use(),
				event: () => undefined,
				end: () => undefined,
			});
		},
	});
	const kernel = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = kernel.beginExecution({
		entry: "worker",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected worker Execution");
	const outcome = Object.freeze({
		attemptNumber: 2,
		failureCode: null,
		outcome: "succeeded" as const,
		resource: request.resource,
		runId: request.runId,
	}) satisfies DurableWorkerOutcome;

	await execution.scope.run(() =>
		runObservedDurableAttempt({
			observation: execution.observation,
			request: {
				...request,
				acceptanceTrace,
			} as DurableAttemptExecutionRequest,
			use: async () => outcome,
		}),
	);
	expect(starts.find(({ kind }) => kind === "job.attempt")).toMatchObject({
		trace: { kind: "root-with-links", links: [acceptanceTrace] },
	});
});

test("records the database-owned retry delay on a Reaction Attempt", async () => {
	const { events, execution } = observedWorker();
	const reactionRequest = Object.freeze({
		...request,
		capability: "reaction" as const,
		resource: "reaction:messages.published",
	});
	const outcome = Object.freeze({
		attemptNumber: 2,
		failureCode: "HANDLER_FAILED" as const,
		outcome: "retryScheduled" as const,
		resource: reactionRequest.resource,
		retryDelayMilliseconds: 750,
		runId: reactionRequest.runId,
	}) satisfies DurableWorkerOutcome;

	await execution.scope.run(() =>
		runObservedDurableAttempt({
			observation: execution.observation,
			request: reactionRequest,
			use: async () => outcome,
		}),
	);
	const attempt = events.filter(
		(event) => event.scopeKind === "reaction.attempt",
	);
	expect(attempt[1]).toMatchObject({
		observationEvent: {
			attemptNumber: 2,
			kind: "durable.retry_scheduled",
			retryDelayMilliseconds: 750,
		},
	});
	expect(attempt[2]).toMatchObject({
		end: {
			errorCode: "HANDLER_FAILED",
			kind: "reaction.attempt",
			outcome: "retry",
		},
	});
});

test("maps fenced, cancelled, and permanent terminals without changing outcomes", async () => {
	for (const scenario of [
		{
			outcome: "fenced" as const,
			failureCode: null,
			event: "durable.fenced",
			end: "fenced",
		},
		{
			outcome: "cancelled" as const,
			failureCode: null,
			event: "durable.terminal",
			end: "cancelled",
		},
		{
			outcome: "failed" as const,
			failureCode: "VALIDATION_FAILED" as const,
			event: "durable.terminal",
			end: "framework_error",
		},
	] as const) {
		const { events, execution } = observedWorker();
		const outcome = Object.freeze({
			attemptNumber: request.attemptNumber,
			failureCode: scenario.failureCode,
			outcome: scenario.outcome,
			resource: request.resource,
			runId: request.runId,
		}) satisfies DurableWorkerOutcome;

		await expect(
			execution.scope.run(() =>
				runObservedDurableAttempt({
					observation: execution.observation,
					request,
					use: async () => outcome,
				}),
			),
		).resolves.toBe(outcome);
		const attempt = events.filter((event) => event.scopeKind === "job.attempt");
		expect(attempt[1]).toMatchObject({
			observationEvent: { kind: scenario.event },
		});
		expect(attempt[2]).toMatchObject({
			end: {
				kind: "job.attempt",
				outcome: scenario.end,
				...(scenario.failureCode === null
					? {}
					: { errorCode: scenario.failureCode }),
			},
		});
	}
});

test("keeps the same Attempt outcome when observation is absent", async () => {
	let calls = 0;
	const outcome = Object.freeze({
		attemptNumber: request.attemptNumber,
		failureCode: null,
		outcome: "succeeded" as const,
		resource: request.resource,
		runId: request.runId,
	}) satisfies DurableWorkerOutcome;
	expect(
		await runObservedDurableAttempt({
			observation: null,
			request,
			use: async () => {
				calls += 1;
				return outcome;
			},
		}),
	).toBe(outcome);
	expect(calls).toBe(1);
});

test("refuses an omitted Attempt observation decision before work", async () => {
	let calls = 0;
	await expect(
		runObservedDurableAttempt({
			observation: undefined as never,
			request,
			use: async () => {
				calls += 1;
				throw new Error("must not execute");
			},
		}),
	).rejects.toThrow("Durable Attempt observation decision is required");
	expect(calls).toBe(0);
});

test("refuses an omitted first-acceptance trace decision before work", async () => {
	let calls = 0;
	await expect(
		runObservedDurableAttempt({
			observation: null,
			request: { ...request, acceptanceTrace: undefined } as never,
			use: async () => {
				calls += 1;
				throw new Error("must not execute");
			},
		}),
	).rejects.toThrow("Durable Attempt acceptance trace decision is required");
	expect(calls).toBe(0);
});
