import { expect, test } from "bun:test";
import { resolve } from "node:path";

import type { SQL } from "bun";
import { codec, context, defineContext, principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { collaborationContext } from "../../fixtures/collaboration/src/execution";
import {
	createApplicationRuntime,
	executePostgresQuery,
	type DataQueryBindingV1,
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

	expect(plan.sql).not.toContain('"qp_authorized" AS MATERIALIZED');
	expect(plan.sql).toContain('WITH "qp_page" AS MATERIALIZED');
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
	const sql = {
		async reserve() {
			return {
				close: async () => {},
				release: () => {},
				unsafe(statement: string, parameters: readonly unknown[] = []) {
					const result =
						statement === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
						statement === "COMMIT" ||
						statement === "ROLLBACK"
							? []
							: (calls.push({ sql: statement, parameters }),
								pages[calls.length - 1] ?? []);
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
						principal: {
							id: facts.principal.id,
							kind: facts.principal.kind,
						},
						tenant: { id: facts.tenant.id },
					},
					sql,
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
	expect(calls[1]?.parameters.slice(5, 8)).toEqual([true, firstId, 1]);

	await runtime.close();
});

test("Query admission refuses anonymous authenticated access before PostgreSQL and permits public access", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const envelope = JSON.parse(
		compilation.generatedFiles["postgres-query-plans.json"] ?? "null",
	) as Readonly<{ plans: readonly PostgresQueryPlanV1[] }>;
	const plan = envelope.plans[0];
	if (!plan) throw new Error("expected the compiled Message page plan");
	expect(plan.admission).toBe("authenticated");
	let activePlan = plan;

	let reservations = 0;
	let postgresMayOpen = false;
	const sql = {
		reserve() {
			if (!postgresMayOpen) throw new Error("PostgreSQL must remain unopened");
			reservations += 1;
			return {
				close: async () => {},
				release: () => {},
				unsafe() {
					const pending = Promise.resolve([]);
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
	const anonymousContext = defineContext({
		name: "test.anonymous-query-admission",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({
			tenant: context.tenant({ id: input.companyId }),
			values: {},
		}),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context: anonymousContext,
		bootstrap: { get: async () => null as never },
		project: ({ facts }) => ({
			run: (binding: DataQueryBindingV1) =>
				executePostgresQuery({
					plan: activePlan,
					binding,
					executionFacts: {
						authority: facts.authority,
						principal: {
							id: facts.principal.id,
							kind: facts.principal.kind,
						},
						tenant: { id: facts.tenant.id },
					},
					sql,
					signal: facts.signal,
				}),
		}),
	});
	const binding: DataQueryBindingV1 = {
		templateDigest: plan.templateDigest,
		values: [
			{ parameter: "after", value: null },
			{ parameter: "channelId", value: channelId },
			{ parameter: "first", value: 1 },
		],
	};

	await expect(
		runtime.execution(
			{
				principal: principal.anonymous(),
				context: { companyId },
			},
			({ run }) => run(binding),
		),
	).rejects.toMatchObject({ code: "unauthenticated" });
	expect(reservations).toBe(0);

	activePlan = { ...plan, admission: "public" };
	postgresMayOpen = true;
	const page = await runtime.execution(
		{
			principal: principal.anonymous(),
			context: { companyId },
		},
		({ run }) => run(binding),
	);
	expect(page).toEqual({
		nodes: [],
		pageInfo: { endCursor: null, hasNextPage: false },
	});
	expect(reservations).toBe(1);

	await runtime.close();
});
