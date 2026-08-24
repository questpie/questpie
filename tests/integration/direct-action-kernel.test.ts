import { expect, test } from "bun:test";

import { codec, defineContext, principal } from "questpie";

import {
	createRuntimeActionExecutor,
	type RuntimeActionBinding,
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
		project: ({ facts }) => ({
			invoke: (effect: EffectToken) =>
				actions.invoke("action:delivery.send", {
					facts,
					input: { message: "hello" },
					effect,
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
	expect(calls).toBe(0);
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

test("expires Runtime-owned Action facts with their execution lifetime", async () => {
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
		project: ({ facts }) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					facts,
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
