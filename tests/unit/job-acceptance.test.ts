import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import { principal } from "questpie";

import {
	createJobAcceptance,
	JobAcceptanceConflict,
	type JobAcceptanceRecord,
	type JobAcceptanceTransaction,
} from "../../packages/runtime/src/durable";
import type { LinkedJobMember } from "../../packages/runtime/src/durable";
import {
	createPostgresJobAcceptanceTransaction,
	type LinkedPostgresMutationTransactionStatements,
} from "../../packages/runtime/src/mutation";
import {
	createObservationKernel,
	type ExecutionEventV2,
	type ObservationAdapterV1,
} from "../../packages/runtime/src/observation";
import {
	definePostgresStatement,
	QuestpiePostgresError,
	transactionBrand,
	type PostgresParameter,
	type PostgresStatement,
} from "../../packages/runtime/src/postgres/contract";

const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const acceptedAt = new Date("2026-08-25T08:00:00.000Z");
const notBefore = new Date("2026-08-25T09:30:00.000Z");

const job = Object.freeze({
	identity: "job:reports.companyDigest",
	member: "reports.companyDigest",
	semanticVersion: 2,
	input: {
		kind: "object",
		properties: { companyId: { kind: "uuid" } },
	},
	output: { kind: "object", properties: {} },
	declaredErrors: Object.freeze({}),
	runAs: Object.freeze({ actor: "caller", whenDenied: "fail" }),
	retry: Object.freeze({
		maximumAttempts: 3,
		initialDelayMilliseconds: 1_000,
		backoff: "exponential",
		maximumDelayMilliseconds: 60_000,
		jitter: "full",
		horizonMilliseconds: 86_400_000,
	}),
	contractDigest: "c".repeat(64),
}) as LinkedJobMember;

function memoryTransaction() {
	const records = new Map<string, JobAcceptanceRecord>();
	const writes: JobAcceptanceRecord[] = [];
	const transaction: JobAcceptanceTransaction = {
		async accept(record) {
			writes.push(record);
			const current = records.get(record.dispatchId);
			if (current)
				return Object.freeze({
					status: "existing" as const,
					requestDigest: current.requestDigest,
				});
			records.set(record.dispatchId, record);
			return Object.freeze({ status: "accepted" as const });
		},
	};
	return { records, transaction, writes };
}

function acceptance(
	transaction: JobAcceptanceTransaction,
	overrides: Readonly<{
		acceptedAt?: Date;
		contextInput?: Readonly<{ companyId: string }>;
		principalId?: string;
	}> = {},
) {
	return createJobAcceptance({
		application: "application:collaboration",
		tenantId,
		principal: principal.user({ id: overrides.principalId ?? principalId }),
		contextInput: overrides.contextInput ?? { companyId: "tenant" },
		contextInputCodec: {
			kind: "object",
			properties: { companyId: { kind: "text" } },
		},
		runtimeBuildDigest: "d".repeat(64),
		acceptedAt: overrides.acceptedAt ?? acceptedAt,
		signal: new AbortController().signal,
		causation: Object.freeze({
			kind: "mutationDispatch",
			id: "mutation-call",
			correlationId: "mutation-call",
		}),
		transaction,
	});
}

test("accepts independently keyed Jobs and replays an equivalent canonical request", async () => {
	const store = memoryTransaction();
	const firstOwner = acceptance(store.transaction);
	const first = await firstOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:morning", notBefore },
	);
	const second = await firstOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:evening" },
	);
	const replayOwner = acceptance(store.transaction, {
		acceptedAt: new Date("2026-08-25T08:05:00.000Z"),
	});
	const replay = await replayOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:morning", notBefore },
	);

	expect(first).toEqual(replay);
	expect(first).not.toEqual(second);
	expect(store.writes[0]?.dispatchId).toBe(
		"c98cbc88-0e2a-5321-a90d-1d15b988ad45",
	);
	expect(first.resource).toBe("job:reports.companyDigest");
	expect(store.records.size).toBe(2);
	expect(store.writes).toHaveLength(3);
	expect(store.writes[0]).toMatchObject({
		runId: first.runId,
		resource: "job:reports.companyDigest",
		semanticVersion: 2,
		state: "delayed",
		availableAt: notBefore,
	});
	expect(store.writes[1]).toMatchObject({
		runId: second.runId,
		state: "ready",
		availableAt: acceptedAt,
	});
});

test("observes the exact Job acceptance owner and accepted identity", async () => {
	const events: ExecutionEventV2[] = [];
	const observation = createObservationKernel({
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = observation.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected observed Execution");
	const store = memoryTransaction();
	const owner = createJobAcceptance({
		application: "application:collaboration",
		tenantId,
		principal: principal.user({ id: principalId }),
		contextInput: { companyId: "tenant" },
		contextInputCodec: {
			kind: "object",
			properties: { companyId: { kind: "text" } },
		},
		runtimeBuildDigest: "d".repeat(64),
		acceptedAt,
		signal: new AbortController().signal,
		causation: Object.freeze({
			kind: "explicit",
			id: "server-execution",
			correlationId: "server-execution",
		}),
		observation: execution.observation,
		transaction: store.transaction,
	});

	const receipt = await execution.scope.run(() =>
		owner.accept(job, { companyId: tenantId }, { idempotencyKey: "observed" }),
	);
	const acceptanceEvents = events.filter(
		(event) => event.scopeKind === "job.accept",
	);
	expect(
		acceptanceEvents.map((event) =>
			event.kind === "scope.event"
				? event.observationEvent.kind
				: event.kind === "scope.ended"
					? event.end.outcome
					: event.kind,
		),
	).toEqual(["scope.started", "durable.accepted", "ok"]);
	expect(acceptanceEvents[0]).toMatchObject({
		executionId: execution.identity.executionId,
		principalKind: "user",
		resourceIdentity: job.identity,
		start: { kind: "job.accept" },
	});
	expect(acceptanceEvents[1]).toMatchObject({
		observationEvent: {
			dispatchId: store.writes[0]?.dispatchId,
			kind: "durable.accepted",
			runId: receipt.runId,
		},
	});
	await expect(
		execution.scope.run(() =>
			owner.accept(
				job,
				{ companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1" },
				{ idempotencyKey: "observed" },
			),
		),
	).rejects.toBeInstanceOf(JobAcceptanceConflict);
	expect(
		events
			.filter((event) => event.scopeKind === "job.accept")
			.slice(3)
			.map((event) =>
				event.kind === "scope.ended"
					? [event.kind, event.end.outcome, event.end.errorCode]
					: [event.kind],
			),
	).toEqual([
		["scope.started"],
		["scope.ended", "declared_error", "JOB_ACCEPTANCE_CONFLICT"],
	]);
});

test("persists only the accepting Job scope trace context", async () => {
	const acceptedTrace = Object.freeze({
		format: "questpie.trace-context" as const,
		version: 1 as const,
		traceId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
		spanId: Uint8Array.from({ length: 8 }, (_, index) => index + 17),
		flags: 1,
	});
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin(input) {
			return Object.freeze({
				context: input.kind === "job.accept" ? acceptedTrace : null,
				run: async <Result>(use: () => Result | Promise<Result>) => await use(),
				event: () => undefined,
				end: () => undefined,
			});
		},
	});
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = observation.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected observed Execution");
	const store = memoryTransaction();
	const owner = createJobAcceptance({
		application: "application:collaboration",
		acceptedAt,
		causation: {
			kind: "explicit",
			id: "explicit:trace",
			correlationId: "explicit:trace",
		},
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		observation: execution.observation,
		principal: principal.user({ id: principalId }),
		runtimeBuildDigest: "d".repeat(64),
		signal: new AbortController().signal,
		tenantId,
		transaction: store.transaction,
	});

	await execution.scope.run(() =>
		owner.accept(job, { companyId: tenantId }, { idempotencyKey: "trace" }),
	);
	expect(store.writes[0]?.acceptanceTrace).toEqual(acceptedTrace);
});

test("keeps the durable receipt and ledger input when the adapter faults", async () => {
	const faultingAdapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin() {
			throw new Error("adapter unavailable");
		},
	});
	const observedStore = memoryTransaction();
	const observation = createObservationKernel({
		adapter: faultingAdapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = observation.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected fault-contained Execution");
	const observed = createJobAcceptance({
		application: "application:collaboration",
		acceptedAt,
		causation: {
			kind: "explicit",
			id: "explicit:fault",
			correlationId: "explicit:fault",
		},
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		observation: execution.observation,
		principal: principal.user({ id: principalId }),
		runtimeBuildDigest: "d".repeat(64),
		signal: new AbortController().signal,
		tenantId,
		transaction: observedStore.transaction,
	});
	const absentStore = memoryTransaction();
	const absent = createJobAcceptance({
		application: "application:collaboration",
		acceptedAt,
		causation: {
			kind: "explicit",
			id: "explicit:fault",
			correlationId: "explicit:fault",
		},
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		principal: principal.user({ id: principalId }),
		runtimeBuildDigest: "d".repeat(64),
		signal: new AbortController().signal,
		tenantId,
		transaction: absentStore.transaction,
	});

	const observedReceipt = await execution.scope.run(() =>
		observed.accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "fault-neutral" },
		),
	);
	const absentReceipt = await absent.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "fault-neutral" },
	);

	expect(observedReceipt).toEqual(absentReceipt);
	expect(observedStore.writes).toEqual(absentStore.writes);
	expect(observedStore.writes[0]?.acceptanceTrace).toBeNull();
});

test("keeps direct Job acceptance PostgreSQL under its accepting Execution", async () => {
	const identities = [
		"mutation.dispatch.accept",
		"mutation.dispatch.event.insert",
		"mutation.dispatch.kernel.mark",
		"mutation.dispatch.run.insert",
		"mutation.job.acceptance.claim",
		"mutation.job.acceptance.read",
	] as const;
	const linkedEntries = identities.map((identity) => ({
		identity,
		statement: definePostgresStatement({
			name: identity,
			operation: identity.includes("insert") ? "INSERT" : "SELECT",
			text: "SELECT 1",
			parameterCount: 0,
			parameters: (value: readonly PostgresParameter[]) => value,
			decode: () => [],
		}) as PostgresStatement<readonly PostgresParameter[], readonly never[]>,
	}));
	const linked = Object.freeze({
		statements: linkedEntries,
		get: (identity: string) =>
			linkedEntries.find((entry) => entry.identity === identity),
	}) as LinkedPostgresMutationTransactionStatements;
	const events: ExecutionEventV2[] = [];
	const parents: string[] = [];
	const durableTrace = Object.freeze({
		format: "questpie.trace-context" as const,
		version: 1 as const,
		traceId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
		spanId: Uint8Array.from({ length: 8 }, (_, index) => index + 17),
		flags: 1,
	});
	let runParameters: readonly PostgresParameter[] | null = null;
	const active = new AsyncLocalStorage<string>();
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin(input) {
			if (input.kind === "postgresql")
				parents.push(active.getStore() ?? "none");
			return Object.freeze({
				context: input.kind === "job.accept" ? durableTrace : null,
				run: async <Result>(use: () => Result | Promise<Result>) =>
					await active.run(input.kind, use),
				event: () => undefined,
				end: () => undefined,
			});
		},
	});
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "d".repeat(64),
	});
	const execution = observation.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (execution === null) throw new Error("expected observed Execution");
	const signal = new AbortController().signal;
	const transaction = createPostgresJobAcceptanceTransaction({
		application: "application:collaboration",
		callId: "explicit:call",
		observation: {
			execution: execution.observation,
			principalKind: "user",
			signal,
		},
		sourceOperation: "execution:jobs.accept",
		statements: linked,
		transaction: {
			[transactionBrand]: true,
			execute: async (statement, parameters) => {
				if (statement.name === "mutation.dispatch.kernel.mark")
					return [{ enabled: "on" }] as never;
				if (statement.name === "mutation.job.acceptance.claim")
					return [{ dispatchId: parameters[7] }] as never;
				if (statement.name === "mutation.dispatch.accept")
					return [{ dispatchId: parameters[1] }] as never;
				if (statement.name === "mutation.dispatch.run.insert") {
					runParameters = parameters;
					return [{ runId: parameters[1] }] as never;
				}
				return [] as never;
			},
		},
	});
	const owner = createJobAcceptance({
		application: "application:collaboration",
		acceptedAt,
		causation: {
			kind: "explicit",
			id: "explicit:call",
			correlationId: "explicit:call",
		},
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		observation: execution.observation,
		principal: principal.user({ id: principalId }),
		runtimeBuildDigest: "d".repeat(64),
		signal,
		tenantId,
		transaction,
	});

	await execution.scope.run(() =>
		owner.accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "postgres-observed" },
		),
	);
	const semantic = events.filter((event) => event.scopeKind !== "execution");
	expect(semantic[0]).toMatchObject({
		kind: "scope.started",
		scopeKind: "job.accept",
	});
	expect(
		semantic
			.filter((event) => event.scopeKind === "postgresql")
			.filter((event) => event.kind === "scope.started")
			.map((event) => event.start),
	).toHaveLength(6);
	expect(parents).toEqual(Array.from({ length: 6 }, () => "execution"));
	expect(runParameters?.slice(-3)).toEqual([
		durableTrace.traceId,
		durableTrace.spanId,
		durableTrace.flags,
	]);
	expect(new Set(semantic.map((event) => event.executionId))).toEqual(
		new Set([execution.identity.executionId]),
	);
	expect(semantic.at(-2)).toMatchObject({
		observationEvent: { kind: "durable.accepted" },
		scopeKind: "job.accept",
	});
	expect(semantic.at(-1)).toMatchObject({
		end: { kind: "job.accept", outcome: "ok" },
		scopeKind: "job.accept",
	});
});

test("classifies exact Job acceptance database and owned abort failures", async () => {
	for (const scenario of [
		{ code: "statementTimeout", outcome: "framework_error", reason: null },
		{
			code: "cancelled",
			outcome: "cancelled",
			reason: new DOMException("cancelled", "AbortError"),
		},
		{
			code: "cancelled",
			outcome: "deadline",
			reason: new DOMException("deadline", "TimeoutError"),
		},
	] as const) {
		const events: ExecutionEventV2[] = [];
		const observation = createObservationKernel({
			applicationIdentity: "application:collaboration",
			createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
			events: (event) => events.push(event),
			runtimeBuildDigest: "d".repeat(64),
		});
		const execution = observation.beginExecution({
			entry: "direct",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		});
		if (execution === null) throw new Error("expected observed Execution");
		const controller = new AbortController();
		if (scenario.reason !== null) controller.abort(scenario.reason);
		const failure = new QuestpiePostgresError({
			code: scenario.code,
			phase: "statement",
		});
		const owner = createJobAcceptance({
			application: "application:collaboration",
			acceptedAt,
			causation: {
				kind: "explicit",
				id: "explicit:failure",
				correlationId: "explicit:failure",
			},
			contextInput: {},
			contextInputCodec: { kind: "object", properties: {} },
			observation: execution.observation,
			principal: principal.user({ id: principalId }),
			runtimeBuildDigest: "d".repeat(64),
			signal: controller.signal,
			tenantId,
			transaction: { accept: async () => Promise.reject(failure) },
		});

		await expect(
			execution.scope.run(() =>
				owner.accept(
					job,
					{ companyId: tenantId },
					{ idempotencyKey: `failure:${scenario.outcome}` },
				),
			),
		).rejects.toBe(failure);
		expect(
			events.find(
				(event) =>
					event.scopeKind === "job.accept" && event.kind === "scope.ended",
			),
		).toMatchObject({
			end: {
				errorCode: scenario.code,
				kind: "job.accept",
				outcome: scenario.outcome,
			},
		});
	}
});

test("conflicts when one scoped Job identity changes input, notBefore, Context, or run-as", async () => {
	for (const changed of ["input", "notBefore", "context", "runAs"] as const) {
		const store = memoryTransaction();
		await acceptance(store.transaction).accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "same-key", notBefore },
		);
		const next =
			changed === "context"
				? acceptance(store.transaction, {
						contextInput: { companyId: "changed" },
					})
				: acceptance(store.transaction);
		const changedJob =
			changed === "runAs"
				? ({
						...job,
						runAs: { actor: "service", whenDenied: "fail" },
					} as unknown as LinkedJobMember)
				: job;
		const attempt = next.accept(
			changedJob,
			{
				companyId:
					changed === "input"
						? "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1"
						: tenantId,
			},
			{
				idempotencyKey: "same-key",
				notBefore:
					changed === "notBefore"
						? new Date("2026-08-25T09:31:00.000Z")
						: notBefore,
			},
		);
		await expect(attempt).rejects.toBeInstanceOf(JobAcceptanceConflict);
	}
});

test("preserves explicit causation and distinct accepted and delayed timestamps", async () => {
	const store = memoryTransaction();
	const owner = createJobAcceptance({
		application: "application:collaboration",
		tenantId,
		principal: principal.user({ id: principalId }),
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		acceptedAt,
		causation: Object.freeze({
			kind: "explicit",
			id: "server-execution",
			correlationId: "server-execution",
		}),
		transaction: store.transaction,
	});

	await owner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "direct", notBefore },
	);
	expect(store.writes[0]).toMatchObject({
		causationKind: "explicit",
		acceptedAt,
		availableAt: notBefore,
		state: "delayed",
	});
});

test("validates bounded NFC idempotency identity and absolute notBefore before persistence", async () => {
	const store = memoryTransaction();
	const owner = acceptance(store.transaction);
	for (const idempotencyKey of [
		"",
		"e\u0301",
		"x\0y",
		"x".repeat(257),
		"😀".repeat(257),
	]) {
		await expect(
			owner.accept(job, { companyId: tenantId }, { idempotencyKey }),
		).rejects.toThrow("Job idempotency key is invalid");
	}
	await expect(
		owner.accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "valid", notBefore: new Date(Number.NaN) },
		),
	).rejects.toThrow("Job notBefore must be an absolute timestamp");
	expect(store.writes).toHaveLength(0);
});

test("scopes stable identity by Principal while keeping idempotency material opaque", async () => {
	const store = memoryTransaction();
	const key = "private/customer@example.test";
	const first = await acceptance(store.transaction).accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: key },
	);
	const second = await acceptance(store.transaction, {
		principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
	}).accept(job, { companyId: tenantId }, { idempotencyKey: key });

	expect(first).not.toEqual(second);
	expect(JSON.stringify([...store.records.values()])).not.toContain(key);
});

test("reserves the command limit before concurrent persistence", async () => {
	const release = Promise.withResolvers<void>();
	const writes: JobAcceptanceRecord[] = [];
	const owner = acceptance({
		async accept(record) {
			writes.push(record);
			await release.promise;
			return Object.freeze({ status: "accepted" as const });
		},
	});
	const attempts = Array.from({ length: 101 }, (_, index) =>
		owner.accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: `concurrent:${index}` },
		),
	);

	await Promise.resolve();
	const writesBeforeRelease = writes.length;
	release.resolve();
	const outcomes = await Promise.allSettled(attempts);

	expect(writesBeforeRelease).toBe(100);
	expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(
		100,
	);
	expect(outcomes[100]).toMatchObject({
		status: "rejected",
		reason: expect.objectContaining({
			message: "Job acceptance transaction exceeds its command limit",
		}),
	});
});
