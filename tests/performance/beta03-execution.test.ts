import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";

import { createApplicationRuntime } from "../../packages/runtime/src";
import baseline from "../../quality/baselines/beta03-execution.json";
import scenario from "../../quality/performance/beta03-execution.json";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";

test("BETA-03 execution lifecycle stays inside its derived reference budget", async () => {
	const derivation = baseline.budgetDerivation.roots100Ms;
	const derivedBudgetMs =
		Math.ceil(
			(derivation.referenceObservedMs * derivation.multiplier) /
				derivation.roundUpQuantumMs,
		) * derivation.roundUpQuantumMs;
	expect(scenario.metrics.roots100Ms.budget).toBe(derivedBudgetMs);
	expect(baseline.budgets.roots100Ms).toBe(derivedBudgetMs);
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
		bootstrap: () => ({ get: async () => null }),
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

	expect(roots100Ms).toBeLessThanOrEqual(scenario.metrics.roots100Ms.budget);
	expect(applicationCreates).toBe(1);
	expect(executionCreates).toBe(100);
	expect(executionDisposes).toBe(100);
	console.log(
		JSON.stringify({
			scenario: "beta03-execution",
			budgetOwner: "BETA-03",
			evidenceClass: baseline.reference.runnerClass,
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
