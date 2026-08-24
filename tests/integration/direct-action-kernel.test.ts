import { expect, test } from "bun:test";

import {
	codec,
	defineContext,
	defineService,
	principal,
	type ServiceInstance,
} from "questpie";

import {
	createRuntimeActionExecutor,
	type RuntimeActionBinding,
	type RuntimeActionProjectionScope,
} from "../../packages/runtime/src/action";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";
import {
	DeclaredOperationError,
	OperationAdmissionError,
	OperationFailure,
} from "../../packages/runtime/src/operation";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const inputCodec = {
	kind: "object",
	properties: { message: { kind: "text" } },
} as const;
const outputCodec = {
	kind: "object",
	properties: { receipt: { kind: "text" } },
} as const;

type EffectToken = Readonly<{ token: symbol }>;

function effectOwner() {
	const identities = new WeakMap<EffectToken, string>();
	return Object.freeze({
		issue(id: string): EffectToken {
			const token = Object.freeze({ token: Symbol("opaque Action effect") });
			identities.set(token, id);
			return token;
		},
		read(token: EffectToken): string {
			const identity = identities.get(token);
			if (identity === undefined)
				throw new TypeError("untrusted Effect Identity");
			return identity;
		},
	});
}

test("runs one trusted opaque Effect Identity without deriving or retrying it", async () => {
	const effects = effectOwner();
	const observed: string[] = [];
	let calls = 0;
	type ActionContext = Readonly<{
		principalId: string;
		signal: AbortSignal;
		tenantId: string;
	}>;
	const binding: RuntimeActionBinding<ActionContext> = {
		identity: "action:delivery.send",
		admission: "authenticated",
		input: inputCodec,
		output: outputCodec,
		declaredErrors: [],
		execute: ({ effect }) => {
			calls += 1;
			observed.push(effect.id);
			return { receipt: `accepted:${effect.id}` };
		},
	};
	const actions = createRuntimeActionExecutor({
		bindings: [binding],
		readEffectIdentity: effects.read,
		project: (facts): ActionContext => ({
			principalId: facts.principal.id,
			signal: facts.signal,
			tenantId: facts.tenant.id,
		}),
	});
	const context = defineContext({
		name: "action.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: (input: unknown, effect: EffectToken) =>
				actions.invoke("action:delivery.send", { facts, input, effect }),
		}),
	});
	const trustedEffect = effects.issue("opaque-owned-identity");

	const result = await runtime.execution(
		{ principal: principal.user({ id: "user-1" }), context: { companyId } },
		(scope) => scope.invoke({ message: "hello" }, trustedEffect),
	);

	expect(result).toEqual({ receipt: "accepted:opaque-owned-identity" });
	expect(observed).toEqual(["opaque-owned-identity"]);
	expect(calls).toBe(1);
	await runtime.close();
});

test("rejects forged Principal, facts, Effect Identity, and Policy denial before work", async () => {
	const effects = effectOwner();
	let calls = 0;
	let forgedServiceCalls = 0;
	let projectionCalls = 0;
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					calls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => {
			projectionCalls += 1;
			return { signal: facts.signal };
		},
	});
	const forgedFacts = Object.freeze({
		principal: Object.freeze({
			questpiePrincipal: true,
			kind: "user",
			id: "forged",
		}),
		authority: Object.freeze({ kind: "ordinary" }),
		contextInput: Object.freeze({ companyId }),
		tenant: Object.freeze({ id: companyId }),
		values: Object.freeze({}),
		signal: new AbortController().signal,
		deadline: null,
		liveQueryObservation: null,
	});
	await expect(
		actions.invoke("action:delivery.send", {
			facts: forgedFacts as never,
			input: { message: "hello" },
			effect: effects.issue("trusted-effect"),
		}),
	).rejects.toMatchObject({ code: "INTERNAL" });

	const context = defineContext({
		name: "action.denied-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (executionScope) => ({
			invoke: (effect: EffectToken) =>
				actions.invoke("action:delivery.send", {
					facts: executionScope.facts,
					input: { message: "hello" },
					effect,
				}),
			invokeForgedScope: () =>
				actions.invoke("action:delivery.send", {
					scope: Object.freeze({
						facts: executionScope.facts,
						service: () => {
							forgedServiceCalls += 1;
							return Promise.reject(new Error("must-not-resolve"));
						},
					}) as never,
					input: { message: "hello" },
					effect: effects.issue("trusted-effect"),
				}),
		}),
	});
	await expect(
		runtime.execution(
			{ principal: principal.anonymous(), context: { companyId } },
			(scope) => scope.invoke(effects.issue("trusted-effect")),
		),
	).rejects.toBeInstanceOf(OperationAdmissionError);
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(Object.freeze({ token: Symbol("forged") })),
		),
	).rejects.toMatchObject({ code: "INTERNAL" });
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invokeForgedScope(),
		),
	).rejects.toMatchObject({ code: "INTERNAL" });
	expect(calls).toBe(0);
	expect(forgedServiceCalls).toBe(0);
	expect(projectionCalls).toBe(0);
	await runtime.close();
});

test("keeps known Action outcomes authoritative across a concurrent abort", async () => {
	const effects = effectOwner();
	const controller = new AbortController();
	let settle!: (value: "ambiguous" | "result") => void;
	const outcome = new Promise<"ambiguous" | "result">((resolve) => {
		settle = resolve;
	});
	let calls = 0;
	let markEntered!: () => void;
	const entered = new Promise<void>((resolve) => {
		markEntered = resolve;
	});
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [
					{
						key: "outcomeUnknown",
						code: "DELIVERY_OUTCOME_UNKNOWN",
						status: 502,
						payload: null,
					},
				],
				execute: async ({ errors }) => {
					calls += 1;
					markEntered();
					const selected = await outcome;
					if (selected === "ambiguous") throw errors.outcomeUnknown();
					return { receipt: "provider-accepted" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.outcome-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					facts,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	const pending = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => scope.invoke(),
	);
	await entered;
	expect(calls).toBe(1);
	controller.abort(new DOMException("caller left", "AbortError"));
	settle("ambiguous");

	await expect(pending).rejects.toEqual(
		new DeclaredOperationError("DELIVERY_OUTCOME_UNKNOWN", 502),
	);
	await runtime.close();
});

test("propagates only owned cancellation without erasing known results", async () => {
	const effects = effectOwner();
	const owned = new DOMException("caller left", "AbortError");
	const controller = new AbortController();
	let mode: "cancel" | "result" | "unrelated" = "cancel";
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: async ({ ctx }) => {
					entered();
					if (mode === "unrelated")
						throw new DOMException("provider abort", "AbortError");
					if (mode === "result") return { receipt: "known-result" };
					await new Promise<never>((_resolve, reject) =>
						ctx.signal.addEventListener(
							"abort",
							() => reject(ctx.signal.reason),
							{
								once: true,
							},
						),
					);
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.cancel-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					facts,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	const cancellation = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => scope.invoke(),
	);
	await started;
	controller.abort(owned);
	await expect(cancellation).rejects.toBe(owned);

	mode = "unrelated";
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(),
		),
	).rejects.toMatchObject({ code: "INTERNAL" });
	mode = "result";
	expect(
		await runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(),
		),
	).toEqual({ receipt: "known-result" });
	await runtime.close();
});

test("retains a validated Action result when its root aborts after handler start", async () => {
	const effects = effectOwner();
	const controller = new AbortController();
	let finishHandler!: () => void;
	const handlerMayFinish = new Promise<void>((resolve) => {
		finishHandler = resolve;
	});
	let handlerEntered!: () => void;
	const entered = new Promise<void>((resolve) => {
		handlerEntered = resolve;
	});
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: async () => {
					handlerEntered();
					await handlerMayFinish;
					return { receipt: "known-after-abort" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.result-race-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					facts,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	let actionOutcome!: Promise<unknown>;
	let finishRoot!: () => void;
	const keepRootOpen = new Promise<void>((resolve) => {
		finishRoot = resolve;
	});
	const root = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => {
			actionOutcome = scope.invoke();
			return keepRootOpen;
		},
	);
	void root.catch(() => undefined);
	await entered;
	controller.abort(new DOMException("caller left", "AbortError"));
	finishHandler();

	await expect(actionOutcome).resolves.toEqual({
		receipt: "known-after-abort",
	});
	finishRoot();
	await expect(root).rejects.toMatchObject({ name: "AbortError" });
	await runtime.close();
});

test("sanitizes malformed input, output, declared errors, and handler failures once", async () => {
	const effects = effectOwner();
	let calls = 0;
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [
					{
						key: "outcomeUnknown",
						code: "DELIVERY_OUTCOME_UNKNOWN",
						status: 502,
						payload: {
							kind: "object",
							properties: { provider: { kind: "text" } },
						},
					},
				],
				execute: ({ input, errors }) => {
					calls += 1;
					const message = (input as Readonly<{ message: string }>).message;
					if (message === "invalid-output") return { receipt: 3 };
					if (message === "invalid-payload")
						throw errors.outcomeUnknown({ provider: 3 });
					if (message === "forged-declared")
						throw new DeclaredOperationError("NOT_DECLARED", 418);
					throw new OperationFailure("NOT_FOUND");
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.sanitation-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: (input: unknown) =>
				actions.invoke("action:delivery.send", {
					facts,
					input,
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	const invoke = (input: unknown) =>
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(input),
		);

	await expect(invoke({ wrong: "shape" })).rejects.toMatchObject({
		code: "PROTOCOL_UNSUPPORTED",
	});
	for (const message of [
		"invalid-output",
		"invalid-payload",
		"forged-declared",
		"raw-framework-error",
	])
		await expect(invoke({ message })).rejects.toMatchObject({
			code: "INTERNAL",
		});
	expect(calls).toBe(4);
	await runtime.close();
});

test("cancel-before-handler and duplicate inventories fail without work", async () => {
	const effects = effectOwner();
	let calls = 0;
	const binding: RuntimeActionBinding<Readonly<{ signal: AbortSignal }>> = {
		identity: "action:delivery.send",
		admission: "authenticated",
		input: inputCodec,
		output: outputCodec,
		declaredErrors: [],
		execute: () => {
			calls += 1;
			return { receipt: "must-not-run" };
		},
	};
	expect(() =>
		createRuntimeActionExecutor({
			bindings: [binding, binding],
			readEffectIdentity: effects.read,
			project: (facts) => ({ signal: facts.signal }),
		}),
	).toThrow("Runtime Action binding inventory is invalid");

	const actions = createRuntimeActionExecutor({
		bindings: [binding],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.pre-cancel-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const controller = new AbortController();
	controller.abort(new DOMException("already gone", "AbortError"));
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					facts,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: "user-1" }),
				context: { companyId },
				signal: controller.signal,
			},
			(scope) => scope.invoke(),
		),
	).rejects.toMatchObject({ name: "AbortError", message: "already gone" });
	expect(calls).toBe(0);
	await runtime.close();
});

test("expires Runtime-owned Action scope with its execution lifetime", async () => {
	const effects = effectOwner();
	let calls = 0;
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					calls += 1;
					return { receipt: "unused" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: (facts) => ({ signal: facts.signal }),
	});
	const context = defineContext({
		name: "action.expired-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (executionScope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope: executionScope,
					input: { message: "late" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});
	let invokeAfterRoot!: () => Promise<unknown>;
	await runtime.execution(
		{ principal: principal.user({ id: "user-1" }), context: { companyId } },
		(scope) => {
			invokeAfterRoot = scope.invoke;
		},
	);

	await expect(invokeAfterRoot()).rejects.toMatchObject({ code: "INTERNAL" });
	expect(calls).toBe(0);
	await runtime.close();
});

test("projects one external execution Service and cleans it after Action outcomes", async () => {
	const effects = effectOwner();
	let creations = 0;
	let disposals = 0;
	let sends = 0;
	let cancelEntered!: () => void;
	const enteredCancellation = new Promise<void>((resolve) => {
		cancelEntered = resolve;
	});
	const delivery = defineService({
		name: "action.delivery-provider",
		lifetime: "execution",
		effect: "external",
		create: () => {
			creations += 1;
			return Object.freeze({
				send(message: string) {
					sends += 1;
					return `provider:${message}`;
				},
			});
		},
		dispose: () => {
			disposals += 1;
		},
	});
	type ActionContext = Readonly<{
		provider: ServiceInstance<typeof delivery>;
		signal: AbortSignal;
	}>;
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [
					{
						key: "providerRejected",
						code: "PROVIDER_REJECTED",
						status: 422,
						payload: null,
					},
				],
				execute: async ({ input, ctx, errors }) => {
					const message = (input as Readonly<{ message: string }>).message;
					if (message === "reject") throw errors.providerRejected();
					if (message === "cancel") {
						cancelEntered();
						await new Promise<never>((_resolve, reject) =>
							ctx.signal.addEventListener(
								"abort",
								() => reject(ctx.signal.reason),
								{ once: true },
							),
						);
					}
					return { receipt: ctx.provider.send(message) };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: async (
			scope: RuntimeActionProjectionScope,
		): Promise<ActionContext> =>
			Object.freeze({
				provider: await scope.service(delivery),
				signal: scope.facts.signal,
			}),
	});
	const context = defineContext({
		name: "action.service-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [delivery],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: (message: string) =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message },
					effect: effects.issue(`opaque:${message}`),
				}),
		}),
	});

	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			async (scope) => Promise.all([scope.invoke("one"), scope.invoke("two")]),
		),
	).resolves.toEqual([
		{ receipt: "provider:one" },
		{ receipt: "provider:two" },
	]);
	expect({ creations, disposals, sends }).toEqual({
		creations: 1,
		disposals: 1,
		sends: 2,
	});
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("reject"),
		),
	).rejects.toEqual(new DeclaredOperationError("PROVIDER_REJECTED", 422));
	expect({ creations, disposals, sends }).toEqual({
		creations: 2,
		disposals: 2,
		sends: 2,
	});

	const controller = new AbortController();
	const cancellation = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => scope.invoke("cancel"),
	);
	await enteredCancellation;
	controller.abort(new DOMException("caller left", "AbortError"));
	await expect(cancellation).rejects.toMatchObject({ name: "AbortError" });
	expect({ creations, disposals, sends }).toEqual({
		creations: 3,
		disposals: 3,
		sends: 2,
	});
	await runtime.close();
});

test("preserves owned cancellation while an external Service is projecting", async () => {
	const effects = effectOwner();
	const lifecycle: string[] = [];
	let handlerCalls = 0;
	let markCreateEntered!: () => void;
	const createEntered = new Promise<void>((resolve) => {
		markCreateEntered = resolve;
	});
	const support = defineService({
		name: "action.cancellation-support",
		lifetime: "execution",
		effect: "read",
		create: () => {
			lifecycle.push("create:support");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			lifecycle.push("dispose:support");
		},
	});
	const delivery = defineService({
		name: "action.cancellation-delivery",
		lifetime: "execution",
		effect: "external",
		dependencies: { support },
		create: async ({ services, signal }) => {
			expect(services.support.ready).toBe(true);
			lifecycle.push("create:delivery:start");
			markCreateEntered();
			await new Promise<never>((_resolve, reject) => {
				const rejectAbort = () => reject(signal.reason);
				if (signal.aborted) rejectAbort();
				else signal.addEventListener("abort", rejectAbort, { once: true });
			});
		},
	});
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: async (scope) =>
			Object.freeze({
				provider: await scope.service(delivery),
			}),
	});
	const context = defineContext({
		name: "action.service-cancellation-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	let actionInvocation!: Promise<unknown>;
	const runtime = createApplicationRuntime({
		services: [support, delivery],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () => {
				actionInvocation = actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				});
				return actionInvocation;
			},
		}),
	});
	const controller = new AbortController();
	const reason = new DOMException(
		"caller left during projection",
		"AbortError",
	);
	const root = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => scope.invoke(),
	);
	await createEntered;
	controller.abort(reason);
	await expect(root).rejects.toBe(reason);
	await expect(actionInvocation).rejects.toBe(reason);
	expect(handlerCalls).toBe(0);
	expect(lifecycle).toEqual([
		"create:support",
		"create:delivery:start",
		"dispose:support",
	]);
	await expect(runtime.close()).resolves.toBeUndefined();
});

test("rejects transaction-safe Service projection before creation or handler work", async () => {
	const effects = effectOwner();
	let creations = 0;
	let handlerCalls = 0;
	const transactionSafe = defineService({
		name: "action.transaction-safe",
		lifetime: "execution",
		effect: "read",
		create: () => {
			creations += 1;
			return Object.freeze({ read: () => "must-not-project" });
		},
	});
	const actions = createRuntimeActionExecutor({
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
		readEffectIdentity: effects.read,
		project: async (scope) => {
			await scope.service(transactionSafe as never);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.read-service-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [transactionSafe],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effect: effects.issue("opaque-owned-identity"),
				}),
		}),
	});

	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(),
		),
	).rejects.toMatchObject({ code: "INTERNAL" });
	expect({ creations, handlerCalls }).toEqual({
		creations: 0,
		handlerCalls: 0,
	});
	await runtime.close();
});
