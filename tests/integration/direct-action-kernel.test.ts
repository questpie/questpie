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
	RuntimeActionPostHandlerResourceLimit,
} from "../../packages/runtime/src/action";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";
import {
	DeclaredOperationError,
	OperationAdmissionError,
	OperationFailure,
} from "../../packages/runtime/src/operation";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const application = "application:collaboration" as const;
const effectKey = "provider-request-2026-08-24-0001";
const limits = Object.freeze({
	inputBytes: 1_024,
	resultBytes: 1_024,
	durationMilliseconds: 5_000,
});
const inputCodec = {
	kind: "object",
	properties: { message: { kind: "text" } },
} as const;
const outputCodec = {
	kind: "object",
	properties: { receipt: { kind: "text" } },
} as const;

test("derives one trusted Effect Identity without retrying", async () => {
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
		limits,
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
		application,
		bindings: [binding],
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
		project: (scope) => ({
			invoke: (input: unknown, stableKey: string) =>
				actions.invoke("action:delivery.send", {
					scope,
					input,
					effectKey: stableKey,
				}),
		}),
	});
	const result = await runtime.execution(
		{ principal: principal.user({ id: "user-1" }), context: { companyId } },
		(scope) => scope.invoke({ message: "hello" }, effectKey),
	);

	expect(result).toEqual({
		receipt: "accepted:136ab1a4-7014-5ea7-ab8d-2fcd64f6a4a8",
	});
	expect(observed).toEqual(["136ab1a4-7014-5ea7-ab8d-2fcd64f6a4a8"]);
	await runtime.execution(
		{ principal: principal.user({ id: "user-1" }), context: { companyId } },
		(scope) => scope.invoke({ message: "changed input" }, effectKey),
	);
	expect(observed[1]).toBe(observed[0]);
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: `u${"x".repeat(300)}` }),
				context: { companyId },
			},
			(scope) => scope.invoke({ message: "long trusted fact" }, effectKey),
		),
	).resolves.toMatchObject({ receipt: expect.stringMatching(/^accepted:/u) });
	expect(calls).toBe(3);
	await runtime.close();
});

test("closed-validates ordinary Effect material and Action Resource identities", async () => {
	let calls = 0;
	const binding: RuntimeActionBinding<Readonly<{ signal: AbortSignal }>> = {
		identity: "action:delivery.send",
		admission: "authenticated",
		limits,
		input: inputCodec,
		output: outputCodec,
		declaredErrors: [],
		execute: () => {
			calls += 1;
			return { receipt: "accepted" };
		},
	};
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [binding],
		project: (scope) => Object.freeze({ signal: scope.facts.signal }),
	});
	const context = defineContext({
		name: "action.effect-material",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: (
				stableKey: string,
				aliases: Readonly<Record<string, unknown>> = {},
			) =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey: stableKey,
					...aliases,
				}),
		}),
	});
	const execute = (
		stableKey: string,
		aliases?: Readonly<Record<string, unknown>>,
	) =>
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke(stableKey, aliases),
		);

	await expect(execute("x".repeat(256))).resolves.toEqual({
		receipt: "accepted",
	});
	await expect(execute("😀".repeat(256))).resolves.toEqual({
		receipt: "accepted",
	});
	for (const candidate of [
		"",
		"x".repeat(257),
		"😀".repeat(257),
		"nul\0key",
		"\ud800",
		"\udc00",
		"e\u0301",
	])
		await expect(execute(candidate)).rejects.toMatchObject({
			code: "PROTOCOL_UNSUPPORTED",
		});
	for (const aliases of [
		{ effectId: "forged" },
		{ idempotencyKey: "forged" },
		{ callId: "mutation-alias" },
	])
		await expect(execute(effectKey, aliases)).rejects.toMatchObject({
			code: "PROTOCOL_UNSUPPORTED",
		});
	expect(calls).toBe(2);
	await runtime.close();

	const maxName = [
		"a".repeat(63),
		"b".repeat(63),
		"c".repeat(63),
		"d".repeat(63),
	].join(".");
	expect(() =>
		createRuntimeActionExecutor({
			application: `application:${maxName}`,
			bindings: [{ ...binding, identity: "action:then.fire" }],
			project: (scope) => Object.freeze({ signal: scope.facts.signal }),
		}),
	).not.toThrow();
	for (const invalidIdentity of [
		"action:then",
		"action:x.then",
		"action:Bad",
		"action:double..dot",
		`action:${"x".repeat(64)}`,
		`action:${maxName}.e`,
	])
		expect(() =>
			createRuntimeActionExecutor({
				application,
				bindings: [{ ...binding, identity: invalidIdentity } as never],
				project: (scope) => Object.freeze({ signal: scope.facts.signal }),
			}),
		).toThrow("Runtime Action action identity is invalid");
});

test("rejects forged Principal, facts, Effect material, and Policy denial before work", async () => {
	let calls = 0;
	let forgedServiceCalls = 0;
	let projectionCalls = 0;
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					calls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
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
			scope: Object.freeze({ facts: forgedFacts }) as never,
			input: { message: "hello" },
			effectKey,
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
			invoke: (stableKey: string) =>
				actions.invoke("action:delivery.send", {
					scope: executionScope,
					input: { message: "hello" },
					effectKey: stableKey,
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
					effectKey,
				}),
		}),
	});
	await expect(
		runtime.execution(
			{ principal: principal.anonymous(), context: { companyId } },
			(scope) => scope.invoke(effectKey),
		),
	).rejects.toBeInstanceOf(OperationAdmissionError);
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("not\u0000trusted"),
		),
	).rejects.toMatchObject({ code: "PROTOCOL_UNSUPPORTED" });
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

test("keeps a validated declared Action outcome typed", async () => {
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
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
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
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
				}),
		}),
	});
	const pending = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
		},
		(scope) => scope.invoke(),
	);
	await entered;
	expect(calls).toBe(1);
	settle("ambiguous");

	await expect(pending).rejects.toEqual(
		new DeclaredOperationError("DELIVERY_OUTCOME_UNKNOWN", 502),
	);
	await runtime.close();
});

test("propagates only owned cancellation without erasing known results", async () => {
	const owned = new DOMException("caller left", "AbortError");
	const controller = new AbortController();
	let mode: "cancel" | "result" | "unrelated" = "cancel";
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
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
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
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

test("reports an abort that wins before a later Action result", async () => {
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
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
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
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
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
	const reason = new DOMException("caller left", "AbortError");
	controller.abort(reason);
	await expect(actionOutcome).rejects.toBe(reason);
	finishHandler();
	finishRoot();
	await expect(root).rejects.toMatchObject({ name: "AbortError" });
	await runtime.close();
});

test("keeps a validated result when owned cleanup observes a racing abort", async () => {
	const controller = new AbortController();
	const reason = new DOMException("deadline raced cleanup", "AbortError");
	let disposals = 0;
	const provider = defineService({
		name: "action.settled-result-provider",
		lifetime: "execution",
		effect: "external",
		create: () => Object.freeze({ ready: true }),
		dispose: () => {
			disposals += 1;
			controller.abort(reason);
		},
	});
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => ({ receipt: "known-before-cleanup" }),
			},
		],
		project: async (scope) => {
			await scope.service(provider);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.settled-result-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	let actionOutcome!: Promise<unknown>;
	let markActionStarted!: () => void;
	const actionStarted = new Promise<void>((resolve) => {
		markActionStarted = resolve;
	});
	const runtime = createApplicationRuntime({
		services: [provider],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
				}),
		}),
	});
	const root = runtime.execution(
		{
			principal: principal.user({ id: "user-1" }),
			context: { companyId },
			signal: controller.signal,
		},
		(scope) => {
			actionOutcome = scope.invoke();
			markActionStarted();
			return actionOutcome;
		},
	);
	void root.catch(() => undefined);

	await actionStarted;
	await expect(actionOutcome).resolves.toEqual({
		receipt: "known-before-cleanup",
	});
	await expect(root).rejects.toBe(reason);
	expect(disposals).toBe(1);
	await runtime.close();
});

test("sanitizes malformed input, output, declared errors, and handler failures once", async () => {
	let calls = 0;
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
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
		project: (scope) => ({
			invoke: (input: unknown) =>
				actions.invoke("action:delivery.send", {
					scope,
					input,
					effectKey,
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

test("enforces exact semantic input, result, and declared-error byte limits", async () => {
	let calls = 0;
	let outcome: "declared" | "result" = "result";
	const binding: RuntimeActionBinding<Readonly<{ signal: AbortSignal }>> = {
		identity: "action:delivery.bytes",
		admission: "authenticated",
		limits: {
			inputBytes: 4,
			resultBytes: 4,
			durationMilliseconds: 5_000,
		},
		input: { kind: "text" },
		output: { kind: "text" },
		declaredErrors: [
			{
				key: "rejected",
				code: "PROVIDER_REJECTED",
				status: 422,
				payload: { kind: "text" },
			},
		],
		execute: ({ input, errors }) => {
			calls += 1;
			if (outcome === "declared") throw errors.rejected("xx");
			return input;
		},
	};
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [binding],
		project: (scope) => Object.freeze({ signal: scope.facts.signal }),
	});
	const context = defineContext({
		name: "action.byte-limits",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			executionScope: scope,
			invoke: (input: string) =>
				actions.invoke("action:delivery.bytes", { scope, input, effectKey }),
		}),
	});

	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("x"),
		),
	).resolves.toBe("x");
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("xx"),
		),
	).rejects.toEqual(new OperationFailure("RESOURCE_LIMIT"));
	expect(calls).toBe(1);

	const oversizedOutput = {
		...binding,
		execute: () => "xx",
	} satisfies RuntimeActionBinding<Readonly<{ signal: AbortSignal }>>;
	const oversizedOutputActions = createRuntimeActionExecutor({
		application,
		bindings: [oversizedOutput],
		project: (scope) => Object.freeze({ signal: scope.facts.signal }),
	});
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) =>
				oversizedOutputActions.invoke("action:delivery.bytes", {
					scope: scope.executionScope,
					input: "x",
					effectKey,
				}),
		),
	).rejects.toBeInstanceOf(RuntimeActionPostHandlerResourceLimit);

	outcome = "declared";
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("x"),
		),
	).rejects.toBeInstanceOf(RuntimeActionPostHandlerResourceLimit);
	await runtime.close();
});

test("rejects every incomplete or unsafe Action limit map", () => {
	const base = {
		identity: "action:delivery.limits",
		admission: "authenticated",
		input: { kind: "text" },
		output: { kind: "text" },
		declaredErrors: [],
		execute: () => "ok",
	} as const;
	for (const candidate of [
		undefined,
		{},
		{ inputBytes: 1, resultBytes: 1 },
		{ inputBytes: 0, resultBytes: 1, durationMilliseconds: 1 },
		{ inputBytes: 1, resultBytes: 0, durationMilliseconds: 1 },
		{ inputBytes: 1, resultBytes: 1, durationMilliseconds: -1 },
		{ inputBytes: 1, resultBytes: 1, durationMilliseconds: 1.5 },
		{
			inputBytes: 1,
			resultBytes: 1,
			durationMilliseconds: Number.MAX_SAFE_INTEGER + 1,
		},
		{ inputBytes: 1, resultBytes: 1, durationMilliseconds: 1, extra: 1 },
	])
		expect(() =>
			createRuntimeActionExecutor({
				application,
				bindings: [{ ...base, limits: candidate } as never],
				project: () => Object.freeze({ signal: new AbortController().signal }),
			}),
		).toThrow("Runtime Action binding inventory is invalid");
});

test("cancel-before-handler and duplicate inventories fail without work", async () => {
	let calls = 0;
	const binding: RuntimeActionBinding<Readonly<{ signal: AbortSignal }>> = {
		identity: "action:delivery.send",
		admission: "authenticated",
		limits,
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
			application,
			bindings: [binding, binding],
			project: (facts) => ({ signal: facts.signal }),
		}),
	).toThrow("Runtime Action binding inventory is invalid");

	const actions = createRuntimeActionExecutor({
		application,
		bindings: [binding],
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
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
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
	let calls = 0;
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					calls += 1;
					return { receipt: "unused" };
				},
			},
		],
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
					effectKey,
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

test("isolates concurrent Action Services and cleans them after every outcome", async () => {
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
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
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
					effectKey: `provider:${message}`,
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
		creations: 2,
		disposals: 2,
		sends: 2,
	});
	await expect(
		runtime.execution(
			{ principal: principal.user({ id: "user-1" }), context: { companyId } },
			(scope) => scope.invoke("reject"),
		),
	).rejects.toEqual(new DeclaredOperationError("PROVIDER_REJECTED", 422));
	expect({ creations, disposals, sends }).toEqual({
		creations: 3,
		disposals: 3,
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
		creations: 4,
		disposals: 4,
		sends: 2,
	});
	await runtime.close();
});

test("preserves owned cancellation while an external Service is projecting", async () => {
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
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits,
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
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
					effectKey,
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

test("rejects non-external or application Service projection before owned work", async () => {
	let applicationCreations = 0;
	let applicationDisposals = 0;
	let executionCreations = 0;
	let mode:
		| "application-create"
		| "application-dispose"
		| "read"
		| "transitive-create"
		| "transitive-dispose" = "read";
	let readCreations = 0;
	let handlerCalls = 0;
	const transactionSafe = defineService({
		name: "action.transaction-safe",
		lifetime: "execution",
		effect: "read",
		create: () => {
			readCreations += 1;
			return Object.freeze({ read: () => "must-not-project" });
		},
	});
	const applicationCreate = defineService({
		name: "action.application-create",
		lifetime: "application",
		effect: "external",
		create: () => {
			applicationCreations += 1;
			return new Promise<never>(() => undefined);
		},
	});
	const applicationDispose = defineService({
		name: "action.application-dispose",
		lifetime: "application",
		effect: "read",
		create: () => {
			applicationCreations += 1;
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			applicationDisposals += 1;
			return new Promise<never>(() => undefined);
		},
	});
	const transitiveCreate = defineService({
		name: "action.transitive-create",
		lifetime: "execution",
		effect: "external",
		dependencies: { applicationCreate },
		create: () => {
			executionCreations += 1;
			return Object.freeze({ ready: true });
		},
	});
	const transitiveDispose = defineService({
		name: "action.transitive-dispose",
		lifetime: "execution",
		effect: "external",
		dependencies: { applicationDispose },
		create: () => {
			executionCreations += 1;
			return Object.freeze({ ready: true });
		},
	});
	const actions = createRuntimeActionExecutor({
		application,
		bindings: [
			{
				identity: "action:delivery.send",
				admission: "authenticated",
				limits: { ...limits, durationMilliseconds: 5 },
				input: inputCodec,
				output: outputCodec,
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return { receipt: "must-not-run" };
				},
			},
		],
		project: async (scope) => {
			const candidate =
				mode === "read"
					? transactionSafe
					: mode === "application-create"
						? applicationCreate
						: mode === "application-dispose"
							? applicationDispose
							: mode === "transitive-create"
								? transitiveCreate
								: transitiveDispose;
			await scope.service(candidate as never);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.read-service-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [
			transactionSafe,
			applicationCreate,
			applicationDispose,
			transitiveCreate,
			transitiveDispose,
		],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.send", {
					scope,
					input: { message: "hello" },
					effectKey,
				}),
		}),
	});

	for (const selected of [
		"read",
		"application-create",
		"application-dispose",
		"transitive-create",
		"transitive-dispose",
	] as const) {
		mode = selected;
		await expect(
			runtime.execution(
				{
					principal: principal.user({ id: "user-1" }),
					context: { companyId },
				},
				(scope) => scope.invoke(),
			),
		).rejects.toMatchObject({ code: "INTERNAL" });
	}
	expect({
		applicationCreations,
		applicationDisposals,
		executionCreations,
		handlerCalls,
		readCreations,
	}).toEqual({
		applicationCreations: 0,
		applicationDisposals: 0,
		executionCreations: 0,
		handlerCalls: 0,
		readCreations: 0,
	});
	await expect(
		Promise.race([
			runtime.close(),
			new Promise<never>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error("rejected graph retained close")),
					100,
				),
			),
		]),
	).resolves.toBeUndefined();
});
