import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

import {
	createBunPostgresQueryAdapter,
	executePostgresQuery,
	type DataQueryBindingV1,
	type PostgresQueryAdapter,
	type PostgresQueryPlanV1,
} from "../../../packages/runtime/src";

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const lockDatabase = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const foreignPrincipalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5";
const foreignTenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a6";
const messageIds = [
	"018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1",
	"018f5f6e-5f2c-7b41-a854-3d9a6b6b61c2",
	"018f5f6e-5f2c-7b41-a854-3d9a6b6b61c3",
] as const;

let plan: PostgresQueryPlanV1;

function binding(after: string | null, first = 1): DataQueryBindingV1 {
	return {
		templateDigest: plan.templateDigest,
		values: [
			{ parameter: "after", value: after },
			{ parameter: "channelId", value: channelId },
			{ parameter: "first", value: first },
		],
	};
}

function executionFacts(principal = principalId, tenant = companyId) {
	return {
		authority: { kind: "ordinary" as const },
		principal: { id: principal },
		tenant: { id: tenant },
	};
}

async function execute(
	adapter: PostgresQueryAdapter,
	options: Readonly<{
		after?: string | null;
		first?: number;
		principal?: string;
		signal?: AbortSignal;
		tenant?: string;
	}> = {},
) {
	return executePostgresQuery({
		plan,
		binding: binding(options.after ?? null, options.first),
		executionFacts: executionFacts(options.principal, options.tenant),
		adapter,
		signal: options.signal,
	});
}

beforeAll(async () => {
	if (!database) return;
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
	await applyCommittedMigrations({ migrations });

	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const envelope = JSON.parse(
		compilation.generatedFiles["postgres-query-plans.json"] ?? "null",
	) as Readonly<{ plans: readonly PostgresQueryPlanV1[] }>;
	const compiledPlan = envelope.plans[0];
	if (!compiledPlan) throw new Error("expected the compiled Message page plan");
	plan = compiledPlan;

	await database`
		insert into collaboration.companies (id, name)
		values (${companyId}, 'Acme')
	`;
	await database`
		insert into collaboration.spaces (id, company_id, name)
		values (${spaceId}, ${companyId}, 'Product')
	`;
	await database`
		insert into collaboration.channels (id, space_id, name)
		values (${channelId}, ${spaceId}, 'General')
	`;
	await database`
		insert into collaboration.memberships
			(id, company_id, principal_id, role, scope_key, status)
		values
			(${membershipId}, ${companyId}, ${principalId}, 'admin', 'company', 'active')
	`;
	await database`
		insert into collaboration.messages
			(id, channel_id, author_membership_id, body, created_at)
		values
			(${messageIds[0]}, ${channelId}, ${membershipId}, 'newest', '2026-08-15T10:00:00.000Z'),
			(${messageIds[1]}, ${channelId}, ${membershipId}, 'middle', '2026-08-15T09:00:00.000Z'),
			(${messageIds[2]}, ${channelId}, ${membershipId}, 'oldest', '2026-08-15T08:00:00.000Z')
	`;
});

afterAll(async () => {
	await Promise.all([database?.close(), lockDatabase?.close()]);
});

describe.skipIf(!database)(
	"BETA-04 Bun PostgreSQL Policy Query adapter",
	() => {
		test("uses fresh Policy evidence for pages, revocation, output guards, and relation disclosure", async () => {
			const adapter = createBunPostgresQueryAdapter(database!);
			const firstPage = await execute(adapter);
			expect(firstPage).toEqual({
				nodes: [
					{
						author: null,
						body: "newest",
						createdAt: "2026-08-15T10:00:00.000Z",
						id: messageIds[0],
					},
				],
				pageInfo: { endCursor: expect.any(String), hasNextPage: true },
			});

			const foreignPage = await execute(adapter, {
				principal: foreignPrincipalId,
			});
			expect(foreignPage).toEqual({
				nodes: [],
				pageInfo: { endCursor: null, hasNextPage: false },
			});
			const forgedTenantPage = await execute(adapter, {
				tenant: foreignTenantId,
			});
			expect(forgedTenantPage).toEqual({
				nodes: [],
				pageInfo: { endCursor: null, hasNextPage: false },
			});

			await database!`
			update collaboration.memberships
			set role = 'member'
			where id = ${membershipId}
		`;
			const staleRolePage = await execute(adapter, {
				after: firstPage.pageInfo.endCursor,
			});
			expect(staleRolePage.nodes).toEqual([
				{
					author: null,
					createdAt: "2026-08-15T09:00:00.000Z",
					id: messageIds[1],
				},
			]);

			await database!`
			update collaboration.memberships
			set status = 'revoked'
			where id = ${membershipId}
		`;
			expect(await execute(adapter)).toEqual({
				nodes: [],
				pageInfo: { endCursor: null, hasNextPage: false },
			});

			await database!`
			update collaboration.memberships
			set role = 'admin', status = 'active'
			where id = ${membershipId}
		`;
		});

		test("rejects a tampered cursor before opening PostgreSQL", async () => {
			const realAdapter = createBunPostgresQueryAdapter(database!);
			const firstPage = await execute(realAdapter);
			let transactions = 0;
			const observedAdapter: PostgresQueryAdapter = {
				transaction: (options, use) => {
					transactions += 1;
					return realAdapter.transaction(options, use);
				},
			};
			await expect(
				execute(observedAdapter, {
					after: `${firstPage.pageInfo.endCursor}=`,
				}),
			).rejects.toMatchObject({ code: "QP-DATA-010", phase: "bind" });
			expect(transactions).toBe(0);
		});

		test("cancels blocked SQL, rolls back, and reuses the single-connection pool", async () => {
			const holder = await lockDatabase!.reserve();
			const controller = new AbortController();
			const adapter = createBunPostgresQueryAdapter(database!);
			try {
				await holder.unsafe("BEGIN");
				await holder.unsafe(
					"LOCK TABLE collaboration.messages IN ACCESS EXCLUSIVE MODE",
				);
				const blocked = execute(adapter, { signal: controller.signal });

				let observedBlockedQuery = false;
				for (let attempt = 0; attempt < 100; attempt += 1) {
					const [activity] = await holder<{ blocked: boolean }[]>`
					select exists (
						select 1
						from pg_catalog.pg_stat_activity
						where pid <> pg_catalog.pg_backend_pid()
						  and query like '%qp_authorized%'
						  and wait_event_type = 'Lock'
					) as blocked
				`;
					if (activity?.blocked) {
						observedBlockedQuery = true;
						break;
					}
					await Bun.sleep(10);
				}
				expect(observedBlockedQuery).toBe(true);
				controller.abort(new Error("stop tracer"));
				await expect(blocked).rejects.toThrow();
			} finally {
				await holder.unsafe("ROLLBACK");
				holder.release();
			}

			const reusablePage = await execute(adapter);
			expect(reusablePage.nodes).toHaveLength(1);
			expect(reusablePage.nodes[0]?.id).toBe(messageIds[0]);
		});
	},
);
