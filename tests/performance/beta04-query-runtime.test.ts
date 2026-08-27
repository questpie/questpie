import { expect, test } from "bun:test";
import { resolve } from "node:path";

import baseline from "../../quality/baselines/beta04-query-runtime.json";
import scenario from "../../quality/performance/beta04-query-runtime.json";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b0";
const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c0";

function compileFixture(): Readonly<{
	compileAndLowerMs: number;
	plan: unknown;
	publicDeclarationBytes: number;
	typescriptInstantiations: number;
}> {
	const source = `
		import { compileApplication } from "@questpie/compiler";
		const started = performance.now();
		const compilation = await compileApplication({ applicationRoot: ${JSON.stringify(fixtureRoot)} });
		const envelope = JSON.parse(compilation.generatedFiles["postgres-query-plans.json"] ?? "null");
		console.log(JSON.stringify({
			compileAndLowerMs: performance.now() - started,
			plan: envelope.plans[0],
			publicDeclarationBytes: compilation.measurements.publicDeclarationBytes,
			typescriptInstantiations: compilation.measurements.typescriptInstantiations,
		}));
	`;
	const compiled = Bun.spawnSync(["bun", "--eval", source], {
		cwd: resolve(import.meta.dir, "../.."),
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(compiled.exitCode, compiled.stderr.toString()).toBe(0);
	return JSON.parse(compiled.stdout.toString());
}

function measureDatabaseRuntime(plan: unknown): Readonly<{
	bindDecode100Ms: number;
	nodeCount: number;
}> {
	const source = `
		import { linkPostgresQueryPlan } from ${JSON.stringify(resolve(import.meta.dir, "../../packages/runtime/src/relational/postgres-database.ts"))};
		import { executePostgresDatabaseQuery } from ${JSON.stringify(resolve(import.meta.dir, "../../packages/runtime/src/relational/query.ts"))};
		const plan = ${JSON.stringify(plan)};
		const values = {
			qp_author_present: null,
			qp_author_id: null,
			qp_author_role: null,
			qp_body: "measured",
			qp_body_allowed: true,
			qp_createdAt: "2026-08-15T10:00:00.000Z",
			qp_id: ${JSON.stringify(messageId)},
		};
		const resultColumns = (result) => result.flatMap((item) => item.kind === "field"
			? (item.guardColumn === undefined ? [item.column] : [item.column, item.guardColumn])
			: [
					item.presenceColumn,
					...item.fields.map(({ column }) => column),
					...resultColumns(item.relations ?? []),
				]);
		const columns = resultColumns(plan.result);
		const row = columns.map((column) => values[column]);
		const database = {
			async transaction(input) {
				return input.use({
					async execute(statement, parameters) {
						statement.parameters(parameters);
						return statement.decode({ command: "SELECT", rowCount: 1, rows: [row] });
					},
				});
			},
		};
		const linkedPlan = linkPostgresQueryPlan(plan);
		const binding = {
			templateDigest: plan.templateDigest,
			values: [
				{ parameter: "after", value: null },
				{ parameter: "channelId", value: ${JSON.stringify(channelId)} },
				{ parameter: "first", value: 100 },
			],
		};
		const executionFacts = {
			authority: { kind: "ordinary" },
			principal: { id: ${JSON.stringify(principalId)}, kind: "user" },
			tenant: { id: ${JSON.stringify(companyId)} },
		};
		let nodeCount = 0;
		const started = performance.now();
		for (let index = 0; index < 100; index += 1) {
			const page = await executePostgresDatabaseQuery({ linkedPlan, binding, executionFacts, database });
			nodeCount += page.nodes.length;
		}
		console.log(JSON.stringify({ bindDecode100Ms: performance.now() - started, nodeCount }));
	`;
	const measured = Bun.spawnSync(["bun", "--eval", source], {
		cwd: resolve(import.meta.dir, "../.."),
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(measured.exitCode, measured.stderr.toString()).toBe(0);
	return JSON.parse(measured.stdout.toString());
}

test("BETA-04 database-mode query binding stays inside its slice-owned budgets", async () => {
	const derivation = baseline.budgetDerivation.bindDecode100Ms;
	const derivedBindingBudgetMs =
		Math.ceil(
			(derivation.referenceObservedMs * derivation.multiplier) /
				derivation.roundUpQuantumMs,
		) * derivation.roundUpQuantumMs;
	expect(scenario.metrics.bindDecode100Ms.budget).toBe(derivedBindingBudgetMs);
	expect(baseline.budgets.bindDecode100Ms).toBe(derivedBindingBudgetMs);
	const compilation = compileFixture();
	const { compileAndLowerMs, plan } = compilation;
	if (!plan) throw new Error("expected the compiled Message page plan");
	const { bindDecode100Ms, nodeCount } = measureDatabaseRuntime(plan);
	expect(nodeCount).toBe(100);

	expect(compileAndLowerMs).toBeLessThanOrEqual(
		scenario.metrics.compileAndLowerMs.budget,
	);
	expect(bindDecode100Ms).toBeLessThanOrEqual(
		scenario.metrics.bindDecode100Ms.budget,
	);
	expect(compilation.publicDeclarationBytes).toBeLessThanOrEqual(
		scenario.metrics.publicDeclarationBytes.budget,
	);
	expect(compilation.typescriptInstantiations).toBeLessThanOrEqual(
		scenario.metrics.typescriptInstantiations.budget,
	);
	console.log(
		JSON.stringify({
			scenario: "beta04-query-runtime",
			budgetOwner: "BETA-04",
			evidenceClass: baseline.reference.runnerClass,
			measurements: {
				compileAndLowerMs,
				bindDecode100Ms,
				publicDeclarationBytes: compilation.publicDeclarationBytes,
				typescriptInstantiations: compilation.typescriptInstantiations,
			},
			status: "PASS",
		}),
	);
});
