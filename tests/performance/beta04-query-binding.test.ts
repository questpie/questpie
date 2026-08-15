import { expect, test } from "bun:test";
import { resolve } from "node:path";

import type { SQL } from "bun";

import { compileApplication } from "@questpie/compiler";

import {
	executePostgresQuery,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";
import baseline from "../../quality/baselines/beta04-query-binding.json";
import scenario from "../../quality/performance/beta04-query-binding.json";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b0";
const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c0";

test("BETA-04 deterministic query binding stays inside its slice-owned budgets", async () => {
	const derivation = baseline.budgetDerivation.bindDecode100Ms;
	const derivedBindingBudgetMs =
		Math.ceil(
			(derivation.referenceObservedMs * derivation.multiplier) /
				derivation.roundUpQuantumMs,
		) * derivation.roundUpQuantumMs;
	expect(scenario.metrics.bindDecode100Ms.budget).toBe(derivedBindingBudgetMs);
	expect(baseline.budgets.bindDecode100Ms).toBe(derivedBindingBudgetMs);
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

	const sql = {
		async reserve() {
			return {
				close: async () => {},
				release: () => {},
				unsafe(statement: string) {
					const result =
						statement === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
						statement === "COMMIT" ||
						statement === "ROLLBACK"
							? []
							: (() => {
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
									return rows;
								})();
					const pending = Promise.resolve(result);
					const query = {
						cancel: () => query,
						execute: () => query,
						// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
						then: pending.then.bind(pending),
					};
					return query;
				},
			};
		},
	} as unknown as SQL;
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
			sql,
		});
		expect(page.nodes).toHaveLength(1);
	}
	const bindDecode100Ms = performance.now() - executeStarted;

	expect(compileAndLowerMs).toBeLessThanOrEqual(
		scenario.metrics.compileAndLowerMs.budget,
	);
	expect(bindDecode100Ms).toBeLessThanOrEqual(
		scenario.metrics.bindDecode100Ms.budget,
	);
	expect(compilation.measurements.publicDeclarationBytes).toBeLessThanOrEqual(
		scenario.metrics.publicDeclarationBytes.budget,
	);
	expect(compilation.measurements.typescriptInstantiations).toBeLessThanOrEqual(
		scenario.metrics.typescriptInstantiations.budget,
	);
	console.log(
		JSON.stringify({
			scenario: "beta04-query-binding",
			budgetOwner: "BETA-04",
			evidenceClass: baseline.reference.runnerClass,
			measurements: {
				compileAndLowerMs,
				bindDecode100Ms,
				publicDeclarationBytes: compilation.measurements.publicDeclarationBytes,
				typescriptInstantiations:
					compilation.measurements.typescriptInstantiations,
			},
			status: "PASS",
		}),
	);
});
