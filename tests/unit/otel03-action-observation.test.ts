import { expect, test } from "bun:test";

import { codec, defineContext, principal } from "questpie";

import {
	createRuntimeActionExecutor,
	type RuntimeActionBinding,
} from "../../packages/runtime/src/action";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";
import {
	createObservationKernel,
	type ExecutionEventV2,
} from "../../packages/runtime/src/observation";
import { DeclaredOperationError } from "../../packages/runtime/src/operation";

const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

function observedActionHarness(
	binding: RuntimeActionBinding<Readonly<{ marker: string }>>,
) {
	const events: ExecutionEventV2[] = [];
	const kernel = createObservationKernel({
		applicationIdentity: "supportDesk",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "a".repeat(64),
	});
	const observed = kernel.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (observed === null) throw new Error("expected observed Execution");
	const actions = createRuntimeActionExecutor({
		application: "application:supportDesk",
		bindings: [binding],
		project: () => Object.freeze({ marker: "ordinary TypeScript" }),
	});
	const context = defineContext({
		name: "action.observation",
		input: codec.object({ tenantId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.tenantId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: (effectKey: string) =>
				actions.invoke(binding.identity, {
					effectKey,
					input: { message: "hello" },
					scope,
				}),
		}),
	});
	return {
		events,
		observed,
		runtime,
		invoke: (effectKey: string) =>
			observed.scope.run(() =>
				runtime.execution(
					{
						principal: principal.user({ id: principalId }),
						context: { tenantId },
						observation: {
							entry: "direct",
							execution: observed.observation,
						},
					},
					(scope) => scope.invoke(effectKey),
				),
			),
	};
}

test("observes one Action and its exact effect under the issued Execution", async () => {
	const events: ExecutionEventV2[] = [];
	const kernel = createObservationKernel({
		applicationIdentity: "supportDesk",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "a".repeat(64),
	});
	const observed = kernel.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (observed === null) throw new Error("expected observed Execution");
	let handlerCalls = 0;
	const binding = {
		identity: "action:notification.send",
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 5_000,
		},
		input: codec.object({ message: codec.text() }),
		output: codec.object({ receipt: codec.text() }),
		declaredErrors: [],
		execute: ({ input, ctx, effect }) => {
			handlerCalls += 1;
			expect(input).toEqual({ message: "hello" });
			expect(ctx).toEqual({ marker: "ordinary TypeScript" });
			expect(effect.id).toMatch(/^[0-9a-f-]{36}$/);
			return { receipt: "sent" };
		},
	} satisfies RuntimeActionBinding<Readonly<{ marker: string }>>;
	const actions = createRuntimeActionExecutor({
		application: "application:supportDesk",
		bindings: [binding],
		project: () => Object.freeze({ marker: "ordinary TypeScript" }),
	});
	const context = defineContext({
		name: "action.observation",
		input: codec.object({ tenantId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.tenantId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:notification.send", {
					effectKey: "notification-1",
					input: { message: "hello" },
					scope,
				}),
		}),
	});

	const result = await observed.scope.run(() =>
		runtime.execution(
			{
				principal: principal.user({
					id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				}),
				context: { tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
				observation: {
					entry: "direct",
					execution: observed.observation,
				},
			},
			(scope) => scope.invoke(),
		),
	);
	expect(result).toEqual({ receipt: "sent" });
	expect(handlerCalls).toBe(1);
	const semantic = events.filter((event) => event.scopeKind !== "execution");
	expect(semantic.map((event) => [event.kind, event.scopeKind])).toEqual([
		["scope.started", "action"],
		["scope.started", "action.effect"],
		["scope.ended", "action.effect"],
		["scope.ended", "action"],
	]);
	expect(semantic[0]).toMatchObject({
		executionId: observed.identity.executionId,
		principalKind: "user",
		resourceIdentity: "action:notification.send",
		start: { entry: "direct", kind: "action" },
	});
	expect(semantic[1]).toMatchObject({
		executionId: observed.identity.executionId,
		principalKind: "user",
		resourceIdentity: "action:notification.send",
		start: { kind: "action.effect" },
	});
	expect(semantic[2]).toMatchObject({
		end: { kind: "action.effect", outcome: "ok" },
	});
	expect(semantic[3]).toMatchObject({
		end: { kind: "action", outcome: "ok" },
	});
	expect(JSON.stringify(events)).not.toContain("notification-1");
	expect(JSON.stringify(events)).not.toContain("hello");
	expect(JSON.stringify(events)).not.toContain("sent");
	await runtime.close();
});

test("does not invent an effect scope for a pre-handler Action rejection", async () => {
	let handlerCalls = 0;
	const harness = observedActionHarness({
		identity: "action:notification.send",
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 5_000,
		},
		input: codec.object({ message: codec.text() }),
		output: codec.object({ receipt: codec.text() }),
		declaredErrors: [],
		execute: () => {
			handlerCalls += 1;
			return { receipt: "never" };
		},
	});

	await expect(harness.invoke("invalid\0effect")).rejects.toMatchObject({
		code: "PROTOCOL_UNSUPPORTED",
	});
	expect(handlerCalls).toBe(0);
	expect(
		harness.events.map((event) => [
			event.kind,
			event.scopeKind,
			event.kind === "scope.ended" ? event.end.outcome : null,
		]),
	).toEqual([
		["scope.started", "execution", null],
		["scope.started", "action", null],
		["scope.ended", "action", "framework_error"],
	]);
	await harness.runtime.close();
});

test("owns authored outcomeUnknown ambiguity on the exact Action effect", async () => {
	let thrown: DeclaredOperationError | undefined;
	const harness = observedActionHarness({
		identity: "action:notification.send",
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 5_000,
		},
		input: codec.object({ message: codec.text() }),
		output: codec.object({ receipt: codec.text() }),
		declaredErrors: [
			{
				key: "outcomeUnknown",
				code: "OUTCOME_UNKNOWN",
				status: 502,
				payload: null,
			},
		],
		execute: ({ errors }) => {
			thrown = errors.outcomeUnknown!();
			throw thrown;
		},
	});

	let caught: unknown;
	try {
		await harness.invoke("ambiguous-effect");
	} catch (error) {
		caught = error;
	}
	expect(caught).toBe(thrown);
	const semantic = harness.events.filter(
		(event) => event.scopeKind !== "execution",
	);
	expect(
		semantic.map((event) =>
			event.kind === "scope.event"
				? event.observationEvent.kind
				: event.kind === "scope.ended"
					? `${event.scopeKind}:${event.end.outcome}`
					: event.scopeKind,
		),
	).toEqual([
		"action",
		"action.effect",
		"action.ambiguous",
		"action.effect:ambiguous",
		"action:declared_error",
	]);
	const effectStart = semantic.find(
		(event) =>
			event.kind === "scope.started" && event.scopeKind === "action.effect",
	);
	const ambiguity = semantic.find((event) => event.kind === "scope.event");
	expect(effectStart).toMatchObject({
		start: { kind: "action.effect", effectId: expect.any(String) },
	});
	expect(ambiguity).toMatchObject({
		observationEvent: {
			kind: "action.ambiguous",
			effectId:
				effectStart?.kind === "scope.started" &&
				effectStart.start.kind === "action.effect"
					? effectStart.start.effectId
					: "missing",
		},
	});
	await harness.runtime.close();
});
