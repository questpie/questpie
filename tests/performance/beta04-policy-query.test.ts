import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

import {
	executePostgresQuery,
	type PostgresQueryParameterV1,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";
import baseline from "../../quality/baselines/beta04-policy-query.json";
import scenario from "../../quality/performance/beta04-policy-query.json";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b0";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b1";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";

type ExplainNode = Readonly<{
	"Node Type": string;
	"Actual Rows"?: number;
	"Actual Loops"?: number;
	"Rows Removed by Filter"?: number;
	Plans?: readonly ExplainNode[];
}>;

type ExplainDocument = Readonly<{
	Plan: ExplainNode;
	"Planning Time": number;
	"Execution Time": number;
}>;

function queryParameters(
	plan: PostgresQueryPlanV1,
): readonly (null | boolean | number | string)[] {
	const queryValues = new Map<string, null | number | string>([
		["after", null],
		["channelId", channelId],
		["first", 100],
	]);
	return plan.parameters.map((parameter: PostgresQueryParameterV1) => {
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "queryParameter")
			return queryValues.get(parameter.parameter) ?? null;
		if (parameter.kind === "cursorPresent") return false;
		if (parameter.kind === "cursorValue") return null;
		const path = parameter.path.join(".");
		if (parameter.source === "tenant" && path === "id") return companyId;
		if (parameter.source === "principal" && path === "id") return principalId;
		if (parameter.source === "authority" && path === "kind") return "ordinary";
		throw new Error("unsupported BETA-04 performance execution fact");
	});
}

function scanRows(node: ExplainNode): number {
	const own = node["Node Type"].includes("Scan")
		? ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
			(node["Actual Loops"] ?? 1)
		: 0;
	return (
		own +
		(node.Plans ?? []).reduce((total, child) => total + scanRows(child), 0)
	);
}

function derivedBudget(
	input: Readonly<{
		referenceObservedMs: number;
		multiplier: number;
		roundUpQuantumMs: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedMs * input.multiplier) / input.roundUpQuantumMs,
		) * input.roundUpQuantumMs
	);
}

test("BETA-04 measures the authorized Query through real PostgreSQL", async () => {
	if (!process.env.PGHOST)
		throw new Error("BETA-04 PostgreSQL performance evidence requires PGHOST");
	const database = new SQL({ max: 1 });
	try {
		const [server] = await database<
			readonly Readonly<{ server_version_num: string }>[]
		>`show server_version_num`;
		expect(Math.trunc(Number(server?.server_version_num) / 10_000)).toBe(17);
		await database.unsafe(
			'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
		);
		const migrations = await Promise.all([
			loadCommittedMigration(
				resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
			),
			loadCommittedMigration(
				resolve(
					fixtureRoot,
					"questpie/migrations/000002_authorize-message-pages",
				),
			),
		]);
		const applied = await applyCommittedMigrations({ migrations });
		expect(applied.status).toBe("applied");

		await database`insert into collaboration.companies (id, name) values (${companyId}, 'Measured')`;
		await database`insert into collaboration.spaces (id, company_id, name) values (${spaceId}, ${companyId}, 'Measured')`;
		await database`insert into collaboration.channels (id, space_id, name) values (${channelId}, ${spaceId}, 'Measured')`;
		await database`insert into collaboration.memberships (id, company_id, principal_id, role, scope_key, status) values (${membershipId}, ${companyId}, ${principalId}, 'admin', 'company', 'active')`;
		await database.unsafe(`
			insert into collaboration.messages
				(id, channel_id, author_membership_id, body, created_at)
			select
				('018f5f6e-5f2c-7b41-a854-' || lpad(to_hex(448 + series), 12, '0'))::uuid,
				'${channelId}'::uuid,
				'${membershipId}'::uuid,
				'measured-' || series,
				'2026-08-15T10:00:00.000Z'::timestamptz + series * interval '1 millisecond'
			from generate_series(1, 101) as series;
		`);

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
		const execute = () =>
			executePostgresQuery({ plan, binding, executionFacts, sql: database });
		const warm = await execute();
		expect(warm.nodes).toHaveLength(100);
		expect(warm.pageInfo.hasNextPage).toBe(true);

		const executeStarted = performance.now();
		for (let index = 0; index < 20; index += 1) await execute();
		const postgresExecute20Ms = performance.now() - executeStarted;

		const explainRows = await database.unsafe<
			readonly Readonly<{ "QUERY PLAN": unknown }>[]
		>(
			`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.sql.trim()}`,
			queryParameters(plan),
		);
		const rawExplain = explainRows[0]?.["QUERY PLAN"];
		const explainValue =
			typeof rawExplain === "string" ? JSON.parse(rawExplain) : rawExplain;
		const explain = (
			explainValue as readonly ExplainDocument[] | undefined
		)?.[0];
		if (!explain) throw new Error("PostgreSQL returned no JSON execution plan");
		const postgresPlanningMs = explain["Planning Time"];
		const postgresExecutionMs = explain["Execution Time"];
		const postgresReturnedRows = explain.Plan["Actual Rows"] ?? 0;
		const postgresScanRows = scanRows(explain.Plan);

		const measurements = {
			compileAndLowerMs,
			postgresExecute20Ms,
			postgresPlanningMs,
			postgresExecutionMs,
			postgresReturnedRows,
			postgresScanRows,
			publicDeclarationBytes: compilation.measurements.publicDeclarationBytes,
			typescriptInstantiations:
				compilation.measurements.typescriptInstantiations,
		};
		for (const [name, metric] of Object.entries(scenario.metrics)) {
			expect(
				measurements[name as keyof typeof measurements],
			).toBeLessThanOrEqual(metric.budget);
			expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
				metric.budget,
			);
		}
		for (const [name, derivation] of Object.entries(
			baseline.budgetDerivation,
		)) {
			expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
				derivedBudget(derivation),
			);
		}
		expect(postgresReturnedRows).toBe(101);
		console.log(
			JSON.stringify({
				scenario: "beta04-policy-query",
				budgetOwner: "BETA-04",
				evidenceClass:
					process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
					baseline.reference.runnerClass,
				postgresMajor: 17,
				measurements,
				status: "PASS",
			}),
		);
	} finally {
		await database.close({ timeout: 0 });
	}
});
