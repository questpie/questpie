import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { codec, defineContext, defineService, principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import {
	auditConnection,
	collaborationContext,
	executionAudit,
	executionFixtureState,
	resetExecutionFixture,
} from "../../fixtures/collaboration/src/execution";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const lifecycleGolden = resolve(
	import.meta.dir,
	"../goldens/beta03/execution-lifecycle.json",
);
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

test("coalesces execution Service creation and cancels in reverse cleanup order", async () => {
	resetExecutionFixture();
	const callbackLifecycle: string[] = [];
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	expect(compilation.generatedFiles["service-projection.json"]).toBeDefined();
	expect(compilation.generatedFiles["context-projection.json"]).toBeDefined();

	const runtime = createApplicationRuntime({
		services: [auditConnection, executionAudit],
		context: collaborationContext,
		bootstrap: () => ({
			get: async () =>
				({
					id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
					companyId,
					principalId,
					role: "member",
					scopeKey: "company",
					status: "active",
				}) as never,
		}),
		project: async ({ facts, service }) => {
			const [first, second] = await Promise.all([
				service(executionAudit),
				service(executionAudit),
			]);
			return Object.freeze({ facts, first, second });
		},
	});
	const controller = new AbortController();
	let callbackStarted!: () => void;
	const started = new Promise<void>((resolveStarted) => {
		callbackStarted = resolveStarted;
	});

	const execution = runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
			signal: controller.signal,
		},
		async ({ facts, first, second }) => {
			callbackLifecycle.push("callback:start");
			expect(first).toBe(second);
			expect(first.connectionId).toBe(1);
			expect(Object.isFrozen(facts)).toBe(true);
			expect(facts.values).toEqual({
				selectedMembershipId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
				selectedMembershipPrincipalId: principalId,
				selectedMembershipScope: "company",
				selectedRole: "member",
			});
			callbackStarted();
			await new Promise<never>((_resolve, reject) => {
				facts.signal.addEventListener(
					"abort",
					() => {
						callbackLifecycle.push("callback:abort");
						reject(facts.signal.reason);
					},
					{ once: true },
				);
			});
		},
	);

	await started;
	controller.abort(new Error("cancel execution"));
	await expect(execution).rejects.toThrow("cancel execution");
	expect(executionFixtureState()).toEqual({
		applicationCreates: 1,
		executionCreates: 1,
		lifecycle: [
			"create:application:1",
			"create:execution:1",
			"dispose:execution:1",
		],
	});
	expect(callbackLifecycle).toEqual(["callback:start", "callback:abort"]);

	await runtime.close();
	expect(executionFixtureState()).toEqual({
		applicationCreates: 1,
		executionCreates: 1,
		lifecycle: [
			"create:application:1",
			"create:execution:1",
			"dispose:execution:1",
			"dispose:application:1",
		],
	});
	expect({
		format: "questpie.execution-lifecycle-trace",
		version: 1,
		scenario: "cancelled-root",
		events: executionFixtureState().lifecycle,
	}).toEqual(JSON.parse(await readFile(lifecycleGolden, "utf8")));
});

test("retains execution Services until a response body reaches EOF", async () => {
	const events: string[] = [];
	const streamService = defineService({
		name: "stream.execution",
		lifetime: "execution",
		effect: "read",
		create: () => {
			events.push("create");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose");
		},
	});
	const streamContext = defineContext({
		name: "stream.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: { id: input.companyId },
			values: {},
		}),
	});
	const runtime = createApplicationRuntime({
		services: [streamService],
		context: streamContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({ stream: await service(streamService) }),
	});
	let body!: ReadableStreamDefaultController<Uint8Array>;
	const response = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ stream }) => {
			expect(stream.ready).toBe(true);
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						body = controller;
					},
				}),
			);
		},
	);

	expect(events).toEqual(["create"]);
	body.enqueue(new TextEncoder().encode("complete"));
	body.close();
	expect(await response.text()).toBe("complete");
	expect(events).toEqual(["create", "dispose"]);
	await runtime.close();
});

test("aborts retained responses before closing application Services", async () => {
	const events: string[] = [];
	let rootSignal!: AbortSignal;
	const applicationService = defineService({
		name: "close.application",
		lifetime: "application",
		effect: "read",
		create: () => ({ ready: true }),
		dispose: () => {
			events.push("dispose:application");
		},
	});
	const executionService = defineService({
		name: "close.execution",
		lifetime: "execution",
		effect: "read",
		dependencies: { application: applicationService },
		create: ({ services }) => ({ ready: services.application.ready }),
		dispose: () => {
			events.push("dispose:execution");
		},
	});
	const closeContext = defineContext({
		name: "close.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [applicationService, executionService],
		context: closeContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ facts, service }) => {
			rootSignal = facts.signal;
			return { execution: await service(executionService) };
		},
	});
	const response = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ execution }) => {
			expect(execution.ready).toBe(true);
			return new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						events.push("cancel:response");
					},
				}),
			);
		},
	);
	const reader = response.body!.getReader();
	const closing = runtime.close();
	try {
		await Promise.resolve();
		expect(rootSignal.aborted).toBe(true);
		await closing;
		expect(events).toEqual([
			"cancel:response",
			"dispose:execution",
			"dispose:application",
		]);
	} finally {
		if (!rootSignal.aborted) await reader.cancel("test cleanup");
		await closing;
	}
});

test("shares one application Service between pre-Context ingress and execution", async () => {
	const events: string[] = [];
	let contextResolutions = 0;
	const credentialService = defineService({
		name: "credentials.application",
		lifetime: "application",
		effect: "external",
		create: () => {
			events.push("create");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose");
		},
	});
	const ingressContext = defineContext({
		name: "ingress.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			contextResolutions += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [credentialService],
		context: ingressContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({
			credentials: await service(credentialService),
		}),
	});

	const [firstIngress, secondIngress] = await Promise.all([
		runtime.applicationService(credentialService),
		runtime.applicationService(credentialService),
	]);
	expect(firstIngress).toBe(secondIngress);
	expect(contextResolutions).toBe(0);
	expect(events).toEqual(["create"]);

	const fromExecution = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ credentials }) => credentials,
	);
	expect(fromExecution).toBe(firstIngress);
	expect(contextResolutions).toBe(1);
	expect(events).toEqual(["create"]);

	await runtime.close();
	expect(events).toEqual(["create", "dispose"]);
});

test("refuses an unregistered application Service before Context Resolution", async () => {
	let serviceCreates = 0;
	let contextResolutions = 0;
	const unregisteredService = defineService({
		name: "credentials.unregistered",
		lifetime: "application",
		effect: "external",
		create: () => {
			serviceCreates += 1;
			return Object.freeze({ ready: true });
		},
	});
	const ingressContext = defineContext({
		name: "unregistered.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			contextResolutions += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context: ingressContext,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});

	await expect(runtime.applicationService(unregisteredService)).rejects.toThrow(
		"is not registered by this Runtime",
	);
	expect({ serviceCreates, contextResolutions }).toEqual({
		serviceCreates: 0,
		contextResolutions: 0,
	});
	await runtime.close();
});

test("isolates application Services between Runtime instances", async () => {
	let nextInstance = 0;
	const disposals: number[] = [];
	const isolatedService = defineService({
		name: "isolated.application",
		lifetime: "application",
		effect: "read",
		create: () => Object.freeze({ instance: ++nextInstance }),
		dispose: ({ instance }) => {
			disposals.push(instance);
		},
	});
	const isolatedContext = defineContext({
		name: "isolated.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const program = {
		services: [isolatedService],
		context: isolatedContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({
			service,
		}: Parameters<
			Parameters<typeof createApplicationRuntime>[0]["project"]
		>[0]) => ({ isolated: await service(isolatedService) }),
	};
	const firstRuntime = createApplicationRuntime(program);
	const secondRuntime = createApplicationRuntime(program);
	const execute = (runtime: typeof firstRuntime) =>
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context: { companyId },
			},
			({ isolated }) => isolated,
		);

	const [firstA, firstB, second] = await Promise.all([
		execute(firstRuntime),
		execute(firstRuntime),
		execute(secondRuntime),
	]);
	expect(firstA).toBe(firstB);
	expect(firstA.instance).toBe(1);
	expect(second.instance).toBe(2);

	await firstRuntime.close();
	expect(disposals).toEqual([1]);
	expect((await execute(secondRuntime)).instance).toBe(2);
	await secondRuntime.close();
	expect(disposals).toEqual([1, 2]);
});

test("unwinds created dependencies after Service resolution failure", async () => {
	const events: string[] = [];
	const dependency = defineService({
		name: "failure.dependency",
		lifetime: "execution",
		effect: "read",
		create: () => {
			events.push("create:dependency");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose:dependency");
		},
	});
	const failing = defineService({
		name: "failure.service",
		lifetime: "execution",
		effect: "read",
		dependencies: { dependency },
		create: ({ services }) => {
			expect(services.dependency.ready).toBe(true);
			events.push("create:failing");
			throw new Error("service unavailable");
		},
	});
	const failureContext = defineContext({
		name: "failure.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [dependency, failing],
		context: failureContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({ failing: await service(failing) }),
	});
	let callbackCalls = 0;
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context: { companyId },
			},
			() => {
				callbackCalls += 1;
			},
		),
	).rejects.toThrow("service unavailable");
	expect({ callbackCalls, events }).toEqual({
		callbackCalls: 0,
		events: ["create:dependency", "create:failing", "dispose:dependency"],
	});
	await runtime.close();
});

test("waits for concurrent Service dependencies before failure cleanup", async () => {
	const events: string[] = [];
	let releaseSlow!: () => void;
	let markFailingCreated!: () => void;
	let markSlowStarted!: () => void;
	let markSlowCreated!: () => void;
	const failingCreated = new Promise<void>((resolveCreated) => {
		markFailingCreated = resolveCreated;
	});
	const slowStarted = new Promise<void>((resolveStarted) => {
		markSlowStarted = resolveStarted;
	});
	const slowCreated = new Promise<void>((resolveCreated) => {
		markSlowCreated = resolveCreated;
	});
	const slowRelease = new Promise<void>((resolveRelease) => {
		releaseSlow = resolveRelease;
	});
	const slow = defineService({
		name: "failure.concurrent-slow",
		lifetime: "execution",
		effect: "read",
		create: async ({ signal }) => {
			events.push("start:slow");
			markSlowStarted();
			await Promise.race([
				slowRelease,
				new Promise<void>((resolveAbort) => {
					const onAbort = () => {
						events.push("abort:slow");
						resolveAbort();
					};
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}),
			]);
			events.push("create:slow");
			markSlowCreated();
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose:slow");
		},
	});
	const failing = defineService({
		name: "failure.concurrent-failing",
		lifetime: "execution",
		effect: "read",
		create: async () => {
			await slowStarted;
			events.push("create:failing");
			markFailingCreated();
			throw new Error("concurrent dependency failed");
		},
	});
	const parent = defineService({
		name: "failure.concurrent-parent",
		lifetime: "execution",
		effect: "read",
		dependencies: { slow, failing },
		create: () => Object.freeze({ ready: true }),
	});
	const failureContext = defineContext({
		name: "failure.concurrent-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [slow, failing, parent],
		context: failureContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({ parent: await service(parent) }),
	});

	const execution = runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		() => undefined,
	);
	const outcome = execution.then(
		() => undefined,
		(error: unknown) => {
			events.push("caught");
			return error;
		},
	);
	await failingCreated;
	await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));
	const abortedBeforeFallbackRelease = events.includes("abort:slow");
	releaseSlow();
	const error = await outcome;
	await slowCreated;
	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toBe("concurrent dependency failed");
	expect(abortedBeforeFallbackRelease).toBe(true);
	expect(events).toEqual([
		"start:slow",
		"create:failing",
		"abort:slow",
		"create:slow",
		"dispose:slow",
		"caught",
	]);
	await runtime.close();
});

test("decodes direct and Operation-Wire Context input through one root", async () => {
	let resolutions = 0;
	const wireContext = defineContext({
		name: "wire.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolutions += 1;
			return {
				tenant: { id: input.companyId },
				values: { resolvedCompanyId: input.companyId },
			};
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context: wireContext,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const useFacts = ({
		tenant,
		values,
	}: {
		tenant: unknown;
		values: unknown;
	}) => ({
		tenant,
		values,
	});
	const runDirect = (context: { readonly companyId: string }) =>
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context,
			},
			useFacts,
		);
	const runWire = (context: unknown) =>
		runtime.operationWire(
			{
				principal: principal.user({ id: principalId }),
				frame: JSON.parse(
					JSON.stringify({
						format: "questpie.operation-wire-root",
						version: 1,
						context,
					}),
				),
			},
			useFacts,
		);
	const direct = await runDirect({ companyId });
	const fromWire = await runWire({ companyId });
	expect(fromWire).toEqual(direct);
	expect(resolutions).toBe(2);

	await expect(
		runWire({ companyId: "not-a-uuid", authority: "system" }),
	).rejects.toThrow("Context input");
	expect(resolutions).toBe(2);
	await runtime.close();
});

test("rejects a structurally forged Principal before Context Resolution", async () => {
	let resolutions = 0;
	const trustedContext = defineContext({
		name: "trusted.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			resolutions += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context: trustedContext,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	await expect(
		runtime.execution(
			{
				principal: {
					questpiePrincipal: true,
					kind: "user",
					id: principalId,
				} as never,
				context: { companyId },
			},
			() => null,
		),
	).rejects.toThrow("trusted Principal");
	expect(resolutions).toBe(0);
	await runtime.close();
});

test("disposes execution Services after handler failure", async () => {
	const events: string[] = [];
	const handlerService = defineService({
		name: "handler.execution",
		lifetime: "execution",
		effect: "read",
		create: () => {
			events.push("create");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose");
		},
	});
	const handlerContext = defineContext({
		name: "handler.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [handlerService],
		context: handlerContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({
			handler: await service(handlerService),
		}),
	});
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context: { companyId },
			},
			({ handler }) => {
				expect(handler.ready).toBe(true);
				throw new Error("handler failed");
			},
		),
	).rejects.toThrow("handler failed");
	expect(events).toEqual(["create", "dispose"]);
	await runtime.close();
});

test("retains execution Services through SSE EOF", async () => {
	const events: string[] = [];
	const sseService = defineService({
		name: "sse.execution",
		lifetime: "execution",
		effect: "read",
		create: () => ({ ready: true }),
		dispose: () => {
			events.push("dispose");
		},
	});
	const sseContext = defineContext({
		name: "sse.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [sseService],
		context: sseContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({ sse: await service(sseService) }),
	});
	const response = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ sse }) => {
			expect(sse.ready).toBe(true);
			return new Response("event: ready\ndata: {}\n\n", {
				headers: { "content-type": "text/event-stream" },
			});
		},
	);
	expect(events).toEqual([]);
	expect(response.headers.get("content-type")).toBe("text/event-stream");
	expect(await response.text()).toBe("event: ready\ndata: {}\n\n");
	expect(events).toEqual(["dispose"]);
	await runtime.close();
});

test("does not enter the handler after cancellation during Context Resolution", async () => {
	let releaseResolution!: () => void;
	let resolutionStarted!: () => void;
	const started = new Promise<void>((resolveStarted) => {
		resolutionStarted = resolveStarted;
	});
	const release = new Promise<void>((resolveRelease) => {
		releaseResolution = resolveRelease;
	});
	const cancellationContext = defineContext({
		name: "cancellation.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: async ({ input }) => {
			resolutionStarted();
			await release;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context: cancellationContext,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const controller = new AbortController();
	let callbackCalls = 0;
	const execution = runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
			signal: controller.signal,
		},
		() => {
			callbackCalls += 1;
		},
	);
	await started;
	controller.abort(new Error("cancel resolution"));
	releaseResolution();
	await expect(execution).rejects.toThrow("cancel resolution");
	expect(callbackCalls).toBe(0);
	await runtime.close();
});

test("disposes execution Services after a response stream error", async () => {
	const events: string[] = [];
	const streamErrorService = defineService({
		name: "streamError.execution",
		lifetime: "execution",
		effect: "read",
		create: () => ({ ready: true }),
		dispose: () => {
			events.push("dispose");
		},
	});
	const streamErrorContext = defineContext({
		name: "streamError.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [streamErrorService],
		context: streamErrorContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({
			stream: await service(streamErrorService),
		}),
	});
	const response = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ stream }) => {
			expect(stream.ready).toBe(true);
			return new Response(
				new ReadableStream<Uint8Array>({
					pull() {
						throw new Error("stream failed");
					},
				}),
			);
		},
	);
	await expect(response.text()).rejects.toThrow("stream failed");
	expect(events).toEqual(["dispose"]);
	await runtime.close();
});

test("disposes retained Services once after response consumer cancellation", async () => {
	const events: string[] = [];
	const dependency = defineService({
		name: "streamCancel.dependency",
		lifetime: "execution",
		effect: "read",
		create: () => {
			events.push("create:dependency");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose:dependency");
		},
	});
	const streamCancelService = defineService({
		name: "streamCancel.execution",
		lifetime: "execution",
		effect: "read",
		dependencies: { dependency },
		create: ({ services }) => {
			expect(services.dependency.ready).toBe(true);
			events.push("create:stream");
			return Object.freeze({ ready: true });
		},
		dispose: () => {
			events.push("dispose:stream");
		},
	});
	const streamCancelContext = defineContext({
		name: "streamCancel.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [dependency, streamCancelService],
		context: streamCancelContext,
		bootstrap: () => ({ get: async () => null }),
		project: async ({ service }) => ({
			stream: await service(streamCancelService),
		}),
	});
	const response = await runtime.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
		},
		({ stream }) => {
			expect(stream.ready).toBe(true);
			return new Response(
				new ReadableStream<Uint8Array>({
					cancel() {
						events.push("cancel:source");
					},
				}),
			);
		},
	);
	const reader = response.body!.getReader();
	await reader.cancel("client disconnected");
	expect(events).toEqual([
		"create:dependency",
		"create:stream",
		"cancel:source",
		"dispose:stream",
		"dispose:dependency",
	]);

	await runtime.close();
	expect(events).toHaveLength(5);
});
