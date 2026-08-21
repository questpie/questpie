import { expect, test } from "bun:test";

import { codec, defineContext, principal } from "questpie";

import { companies } from "../../fixtures/collaboration/src/companies";
import { createApplicationRuntime } from "../../packages/runtime/src";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

test("binds an isolated AbortSignal to each root ContextBootstrap", async () => {
	const signals: AbortSignal[] = [];
	const releases: Array<() => void> = [];
	let rootsStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		rootsStarted = resolve;
	});
	const context = defineContext({
		name: "bootstrapSignal.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: async ({ input, bootstrap }) => {
			await bootstrap.get(companies, {
				key: { id: input.companyId },
				select: { id: true },
			});
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: (signal) => {
			signals.push(signal);
			if (signals.length === 2) rootsStarted();
			return {
				get: () =>
					new Promise((resolve, reject) => {
						const abort = () => reject(signal.reason);
						signal.addEventListener("abort", abort, { once: true });
						releases.push(() => {
							signal.removeEventListener("abort", abort);
							resolve({ id: companyId } as never);
						});
					}),
			};
		},
		project: ({ facts }) => facts,
	});
	const firstController = new AbortController();
	const secondController = new AbortController();
	let useCalls = 0;
	const root = (signal: AbortSignal) =>
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context: { companyId },
				signal,
			},
			(value) => {
				useCalls += 1;
				return value;
			},
		);
	const first = root(firstController.signal);
	const second = root(secondController.signal);
	await started;
	expect(signals).toHaveLength(2);
	expect(signals[0]).not.toBe(signals[1]);
	firstController.abort(new Error("first root cancelled"));
	await expect(first).rejects.toThrow("first root cancelled");
	expect(useCalls).toBe(0);
	expect(signals[1]!.aborted).toBe(false);
	releases[1]!();
	const secondFacts = await second;
	expect(secondFacts).toMatchObject({ tenant: { id: companyId } });
	expect(signals[1]).toBe(secondFacts.signal);
	expect(useCalls).toBe(1);
	await runtime.close();
});

test("does not bind ContextBootstrap for a pre-aborted root", async () => {
	let factoryCalls = 0;
	let contextCalls = 0;
	let useCalls = 0;
	const context = defineContext({
		name: "preAbortedBootstrap.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			contextCalls += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => {
			factoryCalls += 1;
			return { get: async () => null };
		},
		project: ({ facts }) => facts,
	});
	const controller = new AbortController();
	controller.abort(new Error("already cancelled"));
	await expect(
		runtime.execution(
			{
				principal: principal.user({ id: principalId }),
				context: { companyId },
				signal: controller.signal,
			},
			() => {
				useCalls += 1;
			},
		),
	).rejects.toThrow("already cancelled");
	expect(factoryCalls).toBe(0);
	expect(contextCalls).toBe(0);
	expect(useCalls).toBe(0);
	await runtime.close();
});
