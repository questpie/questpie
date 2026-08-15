import { beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	codec,
	defineContext,
	defineService,
	principal,
} from "../../packages/questpie/src";
import { createApplicationRuntime } from "../../packages/runtime/src";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const lifecycleGolden = resolve(
	import.meta.dir,
	"../goldens/beta03/execution-lifecycle.json",
);
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

let lifecycle: string[];
let applicationCreates: number;
let executionCreates: number;

beforeEach(() => {
	lifecycle = [];
	applicationCreates = 0;
	executionCreates = 0;
});

test("coalesces execution Service creation and cancels in reverse cleanup order", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	expect(compilation.generatedFiles["service-projection.json"]).toBeDefined();
	expect(compilation.generatedFiles["context-projection.json"]).toBeDefined();

	const auditConnection = defineService({
		name: "audit.connection",
		lifetime: "application",
		effect: "read",
		create: () => {
			applicationCreates += 1;
			lifecycle.push(`create:application:${applicationCreates}`);
			return Object.freeze({ id: applicationCreates });
		},
		dispose: (instance) => {
			lifecycle.push(`dispose:application:${instance.id}`);
		},
	});
	const executionAudit = defineService({
		name: "audit.execution",
		lifetime: "execution",
		effect: "read",
		dependencies: { connection: auditConnection },
		create: ({ services }) => {
			executionCreates += 1;
			lifecycle.push(`create:execution:${executionCreates}`);
			return Object.freeze({
				connectionId: services.connection.id,
				id: executionCreates,
			});
		},
		dispose: (instance) => {
			lifecycle.push(`dispose:execution:${instance.id}`);
		},
	});
	const collaborationContext = defineContext({
		name: "app.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input, principal: executionPrincipal }) => {
			lifecycle.push("context:resolve");
			return {
				tenant: { id: input.companyId },
				values: { principalId: executionPrincipal.id },
			};
		},
	});
	const runtime = createApplicationRuntime({
		services: [auditConnection, executionAudit],
		context: collaborationContext,
		bootstrap: { get: async () => null },
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
			lifecycle.push("callback:start");
			expect(first).toBe(second);
			expect(first.connectionId).toBe(1);
			expect(Object.isFrozen(facts)).toBe(true);
			expect(facts.values.principalId).toBe(principalId);
			callbackStarted();
			await new Promise<never>((_resolve, reject) => {
				facts.signal.addEventListener(
					"abort",
					() => {
						lifecycle.push("callback:abort");
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
	expect({ applicationCreates, executionCreates, lifecycle }).toEqual({
		applicationCreates: 1,
		executionCreates: 1,
		lifecycle: [
			"context:resolve",
			"create:application:1",
			"create:execution:1",
			"callback:start",
			"callback:abort",
			"dispose:execution:1",
		],
	});

	await runtime.close();
	expect(lifecycle).toEqual([
		"context:resolve",
		"create:application:1",
		"create:execution:1",
		"callback:start",
		"callback:abort",
		"dispose:execution:1",
		"dispose:application:1",
	]);
	expect({
		format: "questpie.execution-lifecycle-trace",
		version: 1,
		scenario: "cancelled-root",
		events: lifecycle,
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
		bootstrap: { get: async () => null },
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
		bootstrap: { get: async () => null },
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
		bootstrap: { get: async () => null },
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
		bootstrap: { get: async () => null },
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
