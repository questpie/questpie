import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";

import { createApplicationRuntime } from "../../packages/runtime/src";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";

test("BETA-03 execution lifecycle stays inside stable-runner budgets", async () => {
	let applicationCreates = 0;
	let executionCreates = 0;
	let executionDisposes = 0;
	const application = defineService({
		name: "performance.application",
		lifetime: "application",
		effect: "read",
		create: () => ({ id: ++applicationCreates }),
	});
	const execution = defineService({
		name: "performance.execution",
		lifetime: "execution",
		effect: "read",
		dependencies: { application },
		create: ({ services }) => ({
			applicationId: services.application.id,
			id: ++executionCreates,
		}),
		dispose: () => {
			executionDisposes += 1;
		},
	});
	const context = defineContext({
		name: "performance.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [application, execution],
		context,
		bootstrap: { get: async () => null },
		project: async ({ service }) => {
			const [first, second] = await Promise.all([
				service(execution),
				service(execution),
			]);
			return { first, second };
		},
	});
	const started = performance.now();
	for (let index = 0; index < 100; index += 1)
		await runtime.execution(
			{
				principal: principal.service({ name: "performance" }),
				context: { companyId },
			},
			({ first, second }) => {
				expect(first).toBe(second);
				expect(first.applicationId).toBe(1);
			},
		);
	const roots100Ms = performance.now() - started;
	await runtime.close();

	expect(roots100Ms).toBeLessThanOrEqual(1_000);
	expect(applicationCreates).toBe(1);
	expect(executionCreates).toBe(100);
	expect(executionDisposes).toBe(100);
	console.log(
		JSON.stringify({
			scenario: "beta03-execution",
			budgetOwner: "BETA-03",
			measurements: {
				roots100Ms,
				applicationCreates,
				executionCreates,
				executionDisposes,
			},
			status: "PASS",
		}),
	);
});
