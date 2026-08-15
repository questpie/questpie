import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { collaborationContext } from "../../fixtures/collaboration/src/execution";
import {
	createApplicationRuntime,
	executePostgresQuery,
	type DataQueryBindingV1,
	type PostgresQueryAdapter,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61b0";
const firstId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1";
const secondId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c2";

test("foreign member cannot infer a hidden Message through key lookup, page boundary, or first+1 sentinel, and no count capability exists", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const envelope = JSON.parse(
		compilation.generatedFiles["postgres-query-plans.json"] ?? "null",
	) as Readonly<{ plans: readonly PostgresQueryPlanV1[] }>;
	const nondisclosure = JSON.parse(
		compilation.generatedFiles["relational-nondisclosure.json"] ?? "null",
	) as Readonly<{
		queries: readonly Readonly<{
			queryDigest: string;
			policyProgramDigest: string;
			keyedLookup: Readonly<{
				proofPlanDigest: string;
				keyField: string;
				outcomeColumn: string;
				disclosure: string;
				outcomes: Readonly<{ authorized: string; unavailable: string }>;
			}>;
			countOracle: string;
		}>[];
	}>;
	const plan = envelope.plans[0];
	if (!plan) throw new Error("expected the compiled Message page plan");
	const transcript = nondisclosure.queries[0];
	if (!transcript) throw new Error("expected the nondisclosure transcript");
	expect(transcript).toMatchObject({
		queryDigest: plan.queryDigest,
		policyProgramDigest: plan.policyProgramDigest,
		keyedLookup: {
			proofPlanDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			keyField: "collection:messages/field:id",
			outcomeColumn: "qp_key_outcome",
			disclosure: "outcomeOnly",
			outcomes: { authorized: "found", unavailable: "notFound" },
		},
		countOracle: "absent",
	});

	expect(plan.sql.indexOf('"qp_authorized" AS MATERIALIZED')).toBeLessThan(
		plan.sql.indexOf('"qp_page" AS MATERIALIZED'),
	);
	expect(plan.sql).not.toContain("COUNT(");
	expect(compilation.generatedFiles["app.ts"]).not.toMatch(/\bcount\s*\(/);

	const calls: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
	const pages = [
		[
			{
				qp_author_present: null,
				qp_author_id: null,
				qp_author_role: null,
				qp_body: null,
				qp_body_allowed: false,
				qp_createdAt: "2026-08-15T10:00:00.000Z",
				qp_id: firstId,
			},
			{
				qp_author_present: null,
				qp_author_id: null,
				qp_author_role: null,
				qp_body: "next authorized row",
				qp_body_allowed: true,
				qp_createdAt: "2026-08-15T09:00:00.000Z",
				qp_id: secondId,
			},
		],
		[
			{
				qp_author_present: null,
				qp_author_id: null,
				qp_author_role: null,
				qp_body: "next authorized row",
				qp_body_allowed: true,
				qp_createdAt: "2026-08-15T09:00:00.000Z",
				qp_id: secondId,
			},
		],
	] as const;
	const adapter: PostgresQueryAdapter = {
		transaction: async (options, use) => {
			expect(options).toMatchObject({
				isolationLevel: "repeatable read",
				readOnly: true,
			});
			return use({
				query: async (sql, parameters) => {
					calls.push({ sql, parameters });
					return pages[calls.length - 1] ?? [];
				},
			});
		},
	};
	const runtime = createApplicationRuntime({
		services: [],
		context: collaborationContext,
		bootstrap: {
			get: async () =>
				({
					companyId,
					principalId,
					role: "member",
					scopeKey: "company",
					status: "active",
				}) as never,
		},
		project: ({ facts }) => ({
			run: (binding: DataQueryBindingV1) => {
				if (facts.principal.kind === "anonymous")
					throw new Error("resolved execution cannot be anonymous");
				return executePostgresQuery({
					plan,
					binding,
					executionFacts: {
						authority: facts.authority,
						principal: { id: facts.principal.id },
						tenant: { id: facts.tenant.id },
					},
					adapter,
					signal: facts.signal,
				});
			},
		}),
	});
	const root = {
		principal: principal.user({ id: principalId }),
		context: { companyId },
	};
	const binding = (after: string | null): DataQueryBindingV1 => ({
		templateDigest: plan.templateDigest,
		values: [
			{ parameter: "after", value: after },
			{ parameter: "channelId", value: channelId },
			{ parameter: "first", value: 1 },
		],
	});

	const firstPage = await runtime.execution(root, ({ run }) =>
		run(binding(null)),
	);
	expect(firstPage).toEqual({
		nodes: [
			{
				author: null,
				createdAt: "2026-08-15T10:00:00.000Z",
				id: firstId,
			},
		],
		pageInfo: { endCursor: expect.any(String), hasNextPage: true },
	});

	const secondPage = await runtime.operationWire(
		{
			principal: root.principal,
			frame: {
				format: "questpie.operation-wire-root",
				version: 1,
				context: root.context,
			},
		},
		({ run }) => run(binding(firstPage.pageInfo.endCursor)),
	);
	expect(secondPage).toEqual({
		nodes: [
			{
				author: null,
				body: "next authorized row",
				createdAt: "2026-08-15T09:00:00.000Z",
				id: secondId,
			},
		],
		pageInfo: { endCursor: expect.any(String), hasNextPage: false },
	});
	expect(calls).toHaveLength(2);
	expect(calls.every(({ sql }) => sql === plan.sql)).toBe(true);
	expect(calls[1]?.parameters.slice(5, 8)).toEqual([
		true,
		"2026-08-15T10:00:00.000Z",
		firstId,
	]);

	await runtime.close();
});
