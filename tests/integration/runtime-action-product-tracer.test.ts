import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";

import {
	createRuntimeActionExecutor,
	type RuntimeActionBinding,
} from "../../packages/runtime/src/action";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";
import { OperationFailure } from "../../packages/runtime/src/operation";
import { OperationAdmissionError } from "../../packages/runtime/src/operation";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const callerId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

test("ordinary Action derives one bounded Effect and cancels its Service child scope", async () => {
	const lifecycle: string[] = [];
	let blocked = false;
	let handlerCalls = 0;
	let observedEffect = "";
	let projectedRootDeadline: number | null = null;
	let createSignal: AbortSignal | undefined;
	const dependency = defineService({
		name: "action.tracer-dependency",
		lifetime: "execution",
		effect: "read",
		create: () => {
			lifecycle.push("create:dependency");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			lifecycle.push("dispose:dependency");
		},
	});
	const provider = defineService({
		name: "action.tracer-provider",
		lifetime: "execution",
		effect: "external",
		dependencies: { dependency },
		create: async ({ services, signal }) => {
			expect(services.dependency.ready).toBe(true);
			createSignal = signal;
			lifecycle.push("create:provider");
			if (blocked)
				await new Promise<never>((_resolve, reject) => {
					const cancel = () => reject(signal.reason);
					if (signal.aborted) cancel();
					else signal.addEventListener("abort", cancel, { once: true });
				});
			return Object.freeze({ send: (message: string) => `sent:${message}` });
		},
		dispose: () => {
			lifecycle.push("dispose:provider");
		},
	});
	type ActionContext = Readonly<{
		provider: Readonly<{ send(message: string): string }>;
		sameProvider: boolean;
		signal: AbortSignal;
	}>;
	const binding = {
		identity: "action:delivery.publish",
		admission: "authenticated",
		limits: {
			inputBytes: 1_024,
			resultBytes: 1_024,
			durationMilliseconds: 25,
		},
		input: {
			kind: "object",
			properties: { message: { kind: "text" } },
		},
		output: {
			kind: "object",
			properties: { receipt: { kind: "text" } },
		},
		declaredErrors: [],
		execute: ({ input, ctx, effect }) => {
			handlerCalls += 1;
			observedEffect = effect.id;
			expect(ctx.sameProvider).toBe(true);
			if ((input as Readonly<{ message: string }>).message === "hang")
				return new Promise<never>(() => undefined);
			return {
				receipt: ctx.provider.send(
					(input as Readonly<{ message: string }>).message,
				),
			};
		},
	} satisfies RuntimeActionBinding<ActionContext>;
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [binding],
		project: async (scope): Promise<ActionContext> => {
			projectedRootDeadline = scope.facts.deadline;
			const [first, second] = await Promise.all([
				scope.service(provider),
				scope.service(provider),
			]);
			return Object.freeze({
				provider: first,
				sameProvider: first === second,
				signal: scope.facts.signal,
			});
		},
	});
	const context = defineContext({
		name: "action.product-tracer",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [dependency, provider],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: (message: string, effectKey: string) =>
				actions.invoke("action:delivery.publish", {
					scope,
					input: { message },
					effectKey,
				}),
		}),
	});

	const rootDeadline = Date.now() + 10_000;
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: callerId }),
				context: { companyId },
				deadline: rootDeadline,
			},
			(scope) => scope.invoke("hello", "provider-request-2026-08-24-0001"),
		),
	).resolves.toEqual({ receipt: "sent:hello" });
	expect(projectedRootDeadline).toBe(rootDeadline);
	expect(observedEffect).toBe("6a58264b-7e1b-58db-abfa-b46e3cd5cd7f");
	expect(lifecycle).toEqual([
		"create:dependency",
		"create:provider",
		"dispose:provider",
		"dispose:dependency",
	]);
	await expect(
		Promise.race([
			runtime.execution(
				{
					principal: principal.user({ id: callerId }),
					context: { companyId },
				},
				(scope) => scope.invoke("hang", "never-settling-handler"),
			),
			new Promise<never>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error("Action deadline did not settle")),
					250,
				),
			),
		]),
	).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
	expect(lifecycle.slice(-4)).toEqual([
		"create:dependency",
		"create:provider",
		"dispose:provider",
		"dispose:dependency",
	]);

	blocked = true;
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: callerId }),
				context: { companyId },
			},
			(scope) => scope.invoke("blocked", "second-provider-request"),
		),
	).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
	expect(createSignal?.aborted).toBe(true);
	expect(handlerCalls).toBe(2);
	expect(lifecycle).toEqual([
		"create:dependency",
		"create:provider",
		"dispose:provider",
		"dispose:dependency",
		"create:dependency",
		"create:provider",
		"dispose:provider",
		"dispose:dependency",
		"create:dependency",
		"create:provider",
		"dispose:dependency",
	]);

	await runtime.close();
});

test("Action admission wins before an elapsed local or shorter root budget", async () => {
	let projectionCalls = 0;
	let handlerCalls = 0;
	const times = [0, 10, 11];
	const binding = {
		identity: "action:delivery.publish",
		admission: "authenticated",
		limits: {
			inputBytes: 1,
			resultBytes: 1,
			durationMilliseconds: 1,
		},
		input: { kind: "text" },
		output: { kind: "text" },
		declaredErrors: [],
		execute: () => {
			handlerCalls += 1;
			return "must-not-run";
		},
	} satisfies RuntimeActionBinding<Readonly<{ signal: AbortSignal }>>;
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [binding],
		clock: {
			cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
			monotonicNow: () => times.shift() ?? 11,
			rootRemainingMilliseconds: () => null,
			schedule: (callback, delay) => setTimeout(callback, delay),
		},
		project: (scope) => {
			projectionCalls += 1;
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.product-order",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.publish", {
					scope,
					input: { invalid: true },
					effectKey: "invalid\u0000key",
				}),
		}),
	});

	await expect(
		runtime.execution(
			{ principal: principal.anonymous(), context: { companyId } },
			(scope) => scope.invoke(),
		),
	).rejects.toEqual(new OperationAdmissionError("unauthenticated"));
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: callerId }),
				context: { companyId },
			},
			(scope) => scope.invoke(),
		),
	).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
	expect({ projectionCalls, handlerCalls }).toEqual({
		projectionCalls: 0,
		handlerCalls: 0,
	});
	await runtime.close();

	const rootBoundActions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				...binding,
				limits: {
					inputBytes: 1_024,
					resultBytes: 1_024,
					durationMilliseconds: 100,
				},
				execute: () => new Promise<never>(() => undefined),
			},
		],
		clock: {
			cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
			monotonicNow: performance.now.bind(performance),
			rootRemainingMilliseconds: () => 5,
			schedule: (callback, delay) => setTimeout(callback, delay),
		},
		project: (scope) => Object.freeze({ signal: scope.facts.signal }),
	});
	const rootBoundRuntime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				rootBoundActions.invoke("action:delivery.publish", {
					scope,
					input: "valid",
					effectKey: "root-budget",
				}),
		}),
	});
	await expect(
		Promise.race([
			rootBoundRuntime.execution(
				{
					principal: principal.user({ id: callerId }),
					context: { companyId },
				},
				(scope) => scope.invoke(),
			),
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("root budget was ignored")), 50),
			),
		]),
	).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
	await rootBoundRuntime.close();
});

test("Action Policy hides a failed pre-admission clock sample", async () => {
	let clockMode: "nonfinite" | "throw" = "throw";
	let handlerCalls = 0;
	let projectionCalls = 0;
	let rootRemainingCalls = 0;
	let scheduleCalls = 0;
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				identity: "action:delivery.clockAdmission",
				admission: "authenticated",
				limits: {
					inputBytes: 32,
					resultBytes: 32,
					durationMilliseconds: 10,
				},
				input: { kind: "text" },
				output: { kind: "text" },
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return "must-not-run";
				},
			},
		],
		clock: {
			cancel: () => undefined,
			monotonicNow: () => {
				if (clockMode === "throw") throw new Error("clock unavailable");
				return Number.NaN;
			},
			rootRemainingMilliseconds: () => {
				rootRemainingCalls += 1;
				return null;
			},
			schedule: () => {
				scheduleCalls += 1;
				return Object.freeze({ timer: true });
			},
		},
		project: (scope) => {
			projectionCalls += 1;
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.clock-admission-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.clockAdmission", {
					scope,
					input: { invalid: true },
					effectKey: "invalid\0effect",
				}),
		}),
	});
	for (const mode of ["throw", "nonfinite"] as const) {
		clockMode = mode;
		await expect(
			runtime.execution(
				{ principal: principal.anonymous(), context: { companyId } },
				(scope) => scope.invoke(),
			),
		).rejects.toEqual(new OperationAdmissionError("unauthenticated"));
	}
	for (const mode of ["throw", "nonfinite"] as const) {
		clockMode = mode;
		await expect(
			runtime.execution(
				{
					principal: principal.user({ id: callerId }),
					context: { companyId },
				},
				(scope) => scope.invoke(),
			),
		).rejects.toEqual(new OperationFailure("INTERNAL"));
	}
	expect({
		handlerCalls,
		projectionCalls,
		rootRemainingCalls,
		scheduleCalls,
	}).toEqual({
		handlerCalls: 0,
		projectionCalls: 0,
		rootRemainingCalls: 0,
		scheduleCalls: 0,
	});
	await runtime.close();
});

test("Action deadline terminally detaches noncooperative Service creation and late cleanup", async () => {
	let resolveCreate!: (instance: Readonly<{ ready: true }>) => void;
	const createMaySettle = new Promise<Readonly<{ ready: true }>>((resolve) => {
		resolveCreate = resolve;
	});
	let rejectDispose!: (error: Error) => void;
	const disposeMaySettle = new Promise<never>((_resolve, reject) => {
		rejectDispose = reject;
	});
	let disposeCalls = 0;
	let handlerCalls = 0;
	const lifecycle: string[] = [];
	const unhandled: unknown[] = [];
	const observeUnhandled = (error: unknown) => unhandled.push(error);
	process.on("unhandledRejection", observeUnhandled);
	const support = defineService({
		name: "action.noncooperative-support",
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
	const provider = defineService({
		name: "action.noncooperative-provider",
		lifetime: "execution",
		effect: "external",
		dependencies: { support },
		create: ({ services }) => {
			expect(services.support.ready).toBe(true);
			lifecycle.push("create:provider");
			return createMaySettle;
		},
		dispose: () => {
			disposeCalls += 1;
			lifecycle.push("dispose:provider");
			return disposeMaySettle;
		},
	});
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				identity: "action:delivery.noncooperative",
				admission: "authenticated",
				limits: {
					inputBytes: 32,
					resultBytes: 32,
					durationMilliseconds: 5,
				},
				input: { kind: "text" },
				output: { kind: "text" },
				declaredErrors: [],
				execute: () => {
					handlerCalls += 1;
					return "must-not-run";
				},
			},
		],
		project: async (scope) => {
			await scope.service(provider);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.noncooperative-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [support, provider],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.noncooperative", {
					scope,
					input: "hello",
					effectKey: "noncooperative-create",
				}),
		}),
	});
	try {
		await expect(
			Promise.race([
				runtime.execution(
					{
						principal: principal.user({ id: callerId }),
						context: { companyId },
					},
					(scope) => scope.invoke(),
				),
				new Promise<never>((_resolve, reject) =>
					setTimeout(() => reject(new Error("create retained Action")), 100),
				),
			]),
		).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
		await expect(
			Promise.race([
				runtime.close(),
				new Promise<never>((_resolve, reject) =>
					setTimeout(() => reject(new Error("late create retained root")), 100),
				),
			]),
		).resolves.toBeUndefined();
		expect({ disposeCalls, handlerCalls }).toEqual({
			disposeCalls: 0,
			handlerCalls: 0,
		});
		expect(lifecycle).toEqual(["create:support", "create:provider"]);

		resolveCreate(Object.freeze({ ready: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(disposeCalls).toBe(1);
		expect(lifecycle).toEqual([
			"create:support",
			"create:provider",
			"dispose:provider",
		]);
		rejectDispose(new Error("late detached disposal failed"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect({ disposeCalls, unhandled }).toEqual({
			disposeCalls: 1,
			unhandled: [],
		});
		expect(lifecycle).toEqual([
			"create:support",
			"create:provider",
			"dispose:provider",
			"dispose:support",
		]);
	} finally {
		process.off("unhandledRejection", observeUnhandled);
	}
});

test("detached Action cleanup observes a late Service creation rejection", async () => {
	let rejectCreate!: (error: Error) => void;
	const createMayReject = new Promise<never>((_resolve, reject) => {
		rejectCreate = reject;
	});
	const unhandled: unknown[] = [];
	const observeUnhandled = (error: unknown) => unhandled.push(error);
	process.on("unhandledRejection", observeUnhandled);
	const provider = defineService({
		name: "action.late-reject-provider",
		lifetime: "execution",
		effect: "external",
		create: () => createMayReject,
	});
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				identity: "action:delivery.lateReject",
				admission: "authenticated",
				limits: {
					inputBytes: 32,
					resultBytes: 32,
					durationMilliseconds: 5,
				},
				input: { kind: "text" },
				output: { kind: "text" },
				declaredErrors: [],
				execute: () => "must-not-run",
			},
		],
		project: async (scope) => {
			await scope.service(provider);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.late-reject-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [provider],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.lateReject", {
					scope,
					input: "hello",
					effectKey: "late-reject",
				}),
		}),
	});
	try {
		await expect(
			runtime.execution(
				{
					principal: principal.user({ id: callerId }),
					context: { companyId },
				},
				(scope) => scope.invoke(),
			),
		).rejects.toEqual(new OperationFailure("DEADLINE_EXCEEDED"));
		await runtime.close();
		rejectCreate(new Error("late Service create rejected"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(unhandled).toEqual([]);
	} finally {
		process.off("unhandledRejection", observeUnhandled);
	}
});

test("validated Action result wins when Service disposal never settles", async () => {
	let disposeCalls = 0;
	const provider = defineService({
		name: "action.never-disposed-provider",
		lifetime: "execution",
		effect: "external",
		create: () => Object.freeze({ ready: true }),
		dispose: () => {
			disposeCalls += 1;
			return new Promise<never>(() => undefined);
		},
	});
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				identity: "action:delivery.known",
				admission: "authenticated",
				limits: {
					inputBytes: 32,
					resultBytes: 32,
					durationMilliseconds: 5,
				},
				input: { kind: "text" },
				output: { kind: "text" },
				declaredErrors: [],
				execute: () => "known",
			},
		],
		project: async (scope) => {
			await scope.service(provider);
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const context = defineContext({
		name: "action.never-disposed-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [provider],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.known", {
					scope,
					input: "hello",
					effectKey: "known-result",
				}),
		}),
	});

	await expect(
		Promise.race([
			runtime.execution(
				{
					principal: principal.user({ id: callerId }),
					context: { companyId },
				},
				(scope) => scope.invoke(),
			),
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("disposal retained result")), 100),
			),
		]),
	).resolves.toBe("known");
	expect(disposeCalls).toBe(1);
	await expect(
		Promise.race([
			runtime.close(),
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("disposal retained close")), 100),
			),
		]),
	).resolves.toBeUndefined();
});

test("Action re-arms oversized safe deadlines without overflowing host timers", async () => {
	let now = 0;
	let nextTimer = 0;
	const callbacks = new Map<number, () => void>();
	const scheduled: number[] = [];
	const actions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [
			{
				identity: "action:delivery.longBudget",
				admission: "authenticated",
				limits: {
					inputBytes: 32,
					resultBytes: 32,
					durationMilliseconds: Number.MAX_SAFE_INTEGER,
				},
				input: { kind: "text" },
				output: { kind: "text" },
				declaredErrors: [],
				execute: () => new Promise<never>(() => undefined),
			},
		],
		clock: {
			monotonicNow: () => now,
			rootRemainingMilliseconds: () => null,
			schedule: (callback, delay) => {
				nextTimer += 1;
				scheduled.push(delay);
				callbacks.set(nextTimer, callback);
				return nextTimer;
			},
			cancel: (timer) => {
				callbacks.delete(timer as number);
			},
		},
		project: (scope) => Object.freeze({ signal: scope.facts.signal }),
	});
	const context = defineContext({
		name: "action.long-budget-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: (scope) => ({
			invoke: () =>
				actions.invoke("action:delivery.longBudget", {
					scope,
					input: "hello",
					effectKey: "long-budget",
				}),
		}),
	});
	const pending = runtime.execution(
		{ principal: principal.user({ id: callerId }), context: { companyId } },
		(scope) => scope.invoke(),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(scheduled).toEqual([2_147_483_647]);
	now = Number.MAX_SAFE_INTEGER - 1;
	callbacks.get(1)!();
	expect(scheduled).toEqual([2_147_483_647, 1]);
	now = Number.MAX_SAFE_INTEGER;
	callbacks.get(2)!();
	await expect(pending).rejects.toEqual(
		new OperationFailure("DEADLINE_EXCEEDED"),
	);
	expect(scheduled.every((delay) => delay <= 2_147_483_647)).toBe(true);
	await runtime.close();
});

test("Action clock failures sanitize and release owned timer state", async () => {
	let projectionCalls = 0;
	let handlerCalls = 0;
	let timerCallback: (() => void) | undefined;
	let clockThrows = false;
	const binding = {
		identity: "action:delivery.clockFailure",
		admission: "authenticated",
		limits: {
			inputBytes: 32,
			resultBytes: 32,
			durationMilliseconds: 10,
		},
		input: { kind: "text" },
		output: { kind: "text" },
		declaredErrors: [],
		execute: () => {
			handlerCalls += 1;
			return new Promise<never>(() => undefined);
		},
	} satisfies RuntimeActionBinding<Readonly<{ signal: AbortSignal }>>;
	const context = defineContext({
		name: "action.clock-failure-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const createRuntime = (
		actions: ReturnType<typeof createRuntimeActionExecutor>,
	) =>
		createApplicationRuntime({
			services: [],
			context,
			bootstrap: () => ({ get: async () => null }),
			project: (scope) => ({
				invoke: () =>
					actions.invoke("action:delivery.clockFailure", {
						scope,
						input: "hello",
						effectKey: "clock-failure",
					}),
			}),
		});
	const scheduleFailureActions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [binding],
		clock: {
			cancel: () => {
				throw new Error("cancel must not replace failure");
			},
			monotonicNow: () => 0,
			rootRemainingMilliseconds: () => null,
			schedule: () => {
				throw new Error("host timer unavailable");
			},
		},
		project: (scope) => {
			projectionCalls += 1;
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const scheduleFailureRuntime = createRuntime(scheduleFailureActions);
	await expect(
		scheduleFailureRuntime.execution(
			{ principal: principal.user({ id: callerId }), context: { companyId } },
			(scope) => scope.invoke(),
		),
	).rejects.toEqual(new OperationFailure("INTERNAL"));
	await scheduleFailureRuntime.close();
	expect({ handlerCalls, projectionCalls }).toEqual({
		handlerCalls: 0,
		projectionCalls: 0,
	});

	const callbackFailureActions = createRuntimeActionExecutor({
		application: "application:collaboration",
		bindings: [binding],
		clock: {
			cancel: () => undefined,
			monotonicNow: () => {
				if (clockThrows) throw new Error("monotonic clock failed");
				return 0;
			},
			rootRemainingMilliseconds: () => null,
			schedule: (callback) => {
				timerCallback = callback;
				return Object.freeze({ timer: true });
			},
		},
		project: (scope) => {
			projectionCalls += 1;
			return Object.freeze({ signal: scope.facts.signal });
		},
	});
	const callbackFailureRuntime = createRuntime(callbackFailureActions);
	const pending = callbackFailureRuntime.execution(
		{ principal: principal.user({ id: callerId }), context: { companyId } },
		(scope) => scope.invoke(),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	clockThrows = true;
	timerCallback!();
	await expect(pending).rejects.toEqual(new OperationFailure("INTERNAL"));
	await callbackFailureRuntime.close();
	expect({ handlerCalls, projectionCalls }).toEqual({
		handlerCalls: 1,
		projectionCalls: 1,
	});
});
