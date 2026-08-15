import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import {
	executePostgresQuery,
	type PostgresQueryAdapter,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";
import baseline from "../../quality/baselines/beta04-policy-query.json";
import scenario from "../../quality/performance/beta04-policy-query.json";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b0";
const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c0";

test("BETA-04 authorized PostgreSQL pages stay inside their slice-owned budgets", async () => {
	const derivation = baseline.budgetDerivation.bindExecute100Ms;
	const derivedBindingBudgetMs =
		Math.ceil(
			(derivation.referenceObservedMs * derivation.multiplier) /
				derivation.roundUpQuantumMs,
		) * derivation.roundUpQuantumMs;
	expect(scenario.metrics.bindExecute100Ms.budget).toBe(derivedBindingBudgetMs);
	expect(baseline.budgets.bindExecute100Ms).toBe(derivedBindingBudgetMs);
	const compileStarted = performance.now();
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const compileAndLowerMs = performance.now() - compileStarted;
	const envelope = JSON.parse(
		compilation.generatedFiles["postgres-query-plans.json"] ?? "null",
	) as Readonly<{ plans: readonly PostgresQueryPlanV1[] }>;
	const plan = envelope.plans[0];
	if (!plan) throw new Error("expected the compiled Message page plan");

	let maximumRowsRead = 0;
	const adapter: PostgresQueryAdapter = {
		transaction: async (_options, use) =>
			use({
				query: async () => {
					const rows = [
						{
							qp_author_present: null,
							qp_author_id: null,
							qp_author_role: null,
							qp_body: "measured",
							qp_body_allowed: true,
							qp_createdAt: "2026-08-15T10:00:00.000Z",
							qp_id: messageId,
						},
					];
					maximumRowsRead = Math.max(maximumRowsRead, rows.length);
					return rows;
				},
			}),
	};
	const binding = {
		templateDigest: plan.templateDigest,
		values: [
			{ parameter: "after", value: null },
			{ parameter: "channelId", value: channelId },
			{ parameter: "first", value: 100 },
		],
	} as const;
	const executionFacts = {
		authority: { kind: "ordinary" as const },
		principal: { id: principalId },
		tenant: { id: companyId },
	};

	const executeStarted = performance.now();
	for (let index = 0; index < 100; index += 1) {
		const page = await executePostgresQuery({
			plan,
			binding,
			executionFacts,
			adapter,
		});
		expect(page.nodes).toHaveLength(1);
	}
	const bindExecute100Ms = performance.now() - executeStarted;

	expect(compileAndLowerMs).toBeLessThanOrEqual(
		scenario.metrics.compileAndLowerMs.budget,
	);
	expect(bindExecute100Ms).toBeLessThanOrEqual(
		scenario.metrics.bindExecute100Ms.budget,
	);
	expect(maximumRowsRead).toBeLessThanOrEqual(
		scenario.metrics.maximumRowsRead.budget,
	);
	expect(compilation.measurements.publicDeclarationBytes).toBeLessThanOrEqual(
		scenario.metrics.publicDeclarationBytes.budget,
	);
	expect(compilation.measurements.typescriptInstantiations).toBeLessThanOrEqual(
		scenario.metrics.typescriptInstantiations.budget,
	);
	console.log(
		JSON.stringify({
			scenario: "beta04-policy-query",
			budgetOwner: "BETA-04",
			evidenceClass: baseline.reference.runnerClass,
			measurements: {
				compileAndLowerMs,
				bindExecute100Ms,
				maximumRowsRead,
				publicDeclarationBytes: compilation.measurements.publicDeclarationBytes,
				typescriptInstantiations:
					compilation.measurements.typescriptInstantiations,
			},
			status: "PASS",
		}),
	);
});
