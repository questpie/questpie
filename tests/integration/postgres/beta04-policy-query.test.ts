import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

import {
	executePostgresQuery,
	type DataQueryBindingV1,
	type PostgresQueryPlanV1,
} from "../../../packages/runtime/src";
import { executePostgresKeyedOutcome } from "../../../packages/runtime/src/relational/postgres";

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
const microsecondChannelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61d0";
const microsecondMessageIds = [
	"018f5f6e-5f2c-7b41-a854-3d9a6b6b61d1",
	"018f5f6e-5f2c-7b41-a854-3d9a6b6b61d2",
] as const;
const planChannelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61e0";
const planDistractorChannelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61e1";

type KeyedLookupProof = Readonly<{
	sql: string;
	parameters: readonly Readonly<{
		kind: "executionFact" | "literal" | "key";
		position: number;
		source?: string;
		path?: readonly string[];
		value?: unknown;
	}>[];
	outcomeColumn: "qp_key_outcome";
}>;

let plan: PostgresQueryPlanV1;

function binding(
	after: string | null,
	first = 1,
	boundChannelId = channelId,
): DataQueryBindingV1 {
	return {
		templateDigest: plan.templateDigest,
		values: [
			{ parameter: "after", value: after },
			{ parameter: "channelId", value: boundChannelId },
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

async function probeKey(
	proof: KeyedLookupProof,
	key: string,
	principal = principalId,
	tenant = companyId,
): Promise<Readonly<Record<string, unknown>>> {
	const facts = executionFacts(principal, tenant);
	const values = proof.parameters.map((parameter) => {
		if (parameter.kind === "key") return key;
		if (parameter.kind === "literal") return parameter.value;
		const path = parameter.path?.join(".");
		if (parameter.source === "principal" && path === "id")
			return facts.principal.id;
		if (parameter.source === "tenant" && path === "id") return facts.tenant.id;
		if (parameter.source === "authority" && path === "kind")
			return facts.authority.kind;
		throw new Error("unsupported keyed proof execution fact");
	});
	const outcome = await executePostgresKeyedOutcome(database!, {
		statement: proof.sql,
		parameters: values,
	});
	return { [proof.outcomeColumn]: outcome };
}

async function execute(
	sql: SQL,
	options: Readonly<{
		after?: string | null;
		first?: number;
		channelId?: string;
		principal?: string;
		signal?: AbortSignal;
		tenant?: string;
	}> = {},
) {
	return executePostgresQuery({
		plan,
		binding: binding(options.after ?? null, options.first, options.channelId),
		executionFacts: executionFacts(options.principal, options.tenant),
		sql,
		signal: options.signal,
	});
}

type ExplainNode = Readonly<{
	"Node Type": string;
	"Actual Loops"?: number;
	"Actual Rows"?: number;
	"Index Name"?: string;
	"Relation Name"?: string;
	"Rows Removed by Filter"?: number;
	"Shared Hit Blocks"?: number;
	"Shared Read Blocks"?: number;
	Plans?: readonly ExplainNode[];
}>;

function explainParameters(): readonly unknown[] {
	const values = new Map(
		binding(null, 1, planChannelId).values.map(({ parameter, value }) => [
			parameter,
			value,
		]),
	);
	const facts = executionFacts();
	return plan.parameters.map((parameter, index) => {
		expect(parameter.position).toBe(index + 1);
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "queryParameter")
			return values.get(parameter.parameter);
		if (parameter.kind === "cursorPresent") return false;
		if (parameter.kind === "cursorValue") return null;
		const path = parameter.path.join(".");
		if (parameter.source === "authority" && path === "kind")
			return facts.authority.kind;
		if (parameter.source === "principal" && path === "id")
			return facts.principal.id;
		if (parameter.source === "tenant" && path === "id") return facts.tenant.id;
		throw new Error("unsupported EXPLAIN execution fact");
	});
}

function explainNodes(root: ExplainNode): readonly ExplainNode[] {
	return [root, ...(root.Plans ?? []).flatMap(explainNodes)];
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
	const applied = await applyCommittedMigrations({ migrations });
	if (applied.status !== "applied")
		throw new Error(
			`failed to apply BETA-04 migrations: ${JSON.stringify(applied)}`,
		);

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
	await database`
		insert into collaboration.channels (id, space_id, name, visibility)
		values
			(${planChannelId}, ${spaceId}, 'Plan proof', 'company'),
			(${planDistractorChannelId}, ${spaceId}, 'Plan distractors', 'company')
	`;
	await database.unsafe(
		`
		insert into collaboration.messages
			(id, channel_id, author_membership_id, body, created_at)
		select
			pg_catalog.gen_random_uuid(),
			$1::pg_catalog.uuid,
			$2::pg_catalog.uuid,
			'plan-proof-' || ordinal,
			'2026-08-15T12:00:00Z'::pg_catalog.timestamptz + ordinal * interval '1 millisecond'
		from pg_catalog.generate_series(1, 32) as ordinal
	`,
		[planChannelId, membershipId],
	);
	await database.unsafe(
		`
		insert into collaboration.messages
			(id, channel_id, author_membership_id, body, created_at)
		select
			pg_catalog.gen_random_uuid(),
			$1::pg_catalog.uuid,
			$2::pg_catalog.uuid,
			'plan-distractor-' || ordinal,
			'2026-08-15T12:00:00Z'::pg_catalog.timestamptz + ordinal * interval '1 millisecond'
		from pg_catalog.generate_series(1, 8192) as ordinal
	`,
		[planDistractorChannelId, membershipId],
	);
	await database.unsafe("ANALYZE collaboration.messages");
});

afterAll(async () => {
	void database?.close({ timeout: 0 }).catch(() => {});
	await lockDatabase?.close({ timeout: 0 });
});

describe.skipIf(!database)(
	"BETA-04 Bun PostgreSQL Policy Query adapter",
	() => {
		test("uses the stable Message page index for an exact first-plus-one scan", async () => {
			const rows = await database!.unsafe(
				`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.sql}`,
				explainParameters(),
			);
			const rawPlan = rows[0]?.["QUERY PLAN"];
			const document =
				typeof rawPlan === "string" ? JSON.parse(rawPlan) : rawPlan;
			const root = document?.[0]?.Plan as ExplainNode | undefined;
			expect(root).toBeDefined();
			const nodes = explainNodes(root!);
			const messageScan = nodes.find(
				(node) =>
					node["Relation Name"] === "messages" &&
					node["Index Name"] === "qp_ix_messages_page",
			);

			expect(messageScan).toMatchObject({
				"Actual Loops": 1,
				"Actual Rows": 2,
				"Index Name": "qp_ix_messages_page",
			});
			expect(messageScan?.["Rows Removed by Filter"] ?? 0).toBe(0);
			expect(
				(messageScan?.["Shared Hit Blocks"] ?? 0) +
					(messageScan?.["Shared Read Blocks"] ?? 0),
			).toBeGreaterThan(0);
			expect(
				nodes.some(
					(node) =>
						node["Node Type"] === "Seq Scan" &&
						node["Relation Name"] === "messages",
				),
			).toBe(false);
		});

		test("normalizes missing and Policy-invisible Message keys without disclosure", async () => {
			const proof = (
				plan as unknown as Readonly<{
					nondisclosure: Readonly<{ keyedLookup: KeyedLookupProof }>;
				}>
			).nondisclosure.keyedLookup;
			const missing = await probeKey(
				proof,
				"018f5f6e-5f2c-7b41-a854-3d9a6b6b62ff",
			);
			const invisible = await probeKey(
				proof,
				messageIds[0],
				foreignPrincipalId,
			);

			expect(missing).toEqual({ qp_key_outcome: "notFound" });
			expect(invisible).toEqual(missing);
			expect(Object.keys(invisible)).toEqual([proof.outcomeColumn]);
			expect(
				await probeKey(proof, messageIds[0], principalId, foreignTenantId),
			).toEqual(missing);
		});

		test("keeps selected timestamps canonical while the stable ID cursor seeks", async () => {
			await database!`
					insert into collaboration.channels (id, space_id, name, visibility)
					values (${microsecondChannelId}, ${spaceId}, 'Precision', 'company')
				`;
			await database!`
					insert into collaboration.messages
						(id, channel_id, author_membership_id, body, created_at)
					values
						(${microsecondMessageIds[0]}, ${microsecondChannelId}, ${membershipId}, 'lower-id', '2026-08-15T11:00:00.000900Z'),
						(${microsecondMessageIds[1]}, ${microsecondChannelId}, ${membershipId}, 'higher-id', '2026-08-15T11:00:00.000100Z')
				`;

			const firstPage = await execute(database!, {
				channelId: microsecondChannelId,
				first: 1,
			});
			expect(
				firstPage.nodes.map(({ id, createdAt }) => ({ id, createdAt })),
			).toEqual([
				{
					id: microsecondMessageIds[1],
					createdAt: "2026-08-15T11:00:00.000Z",
				},
			]);
			expect(firstPage.pageInfo.hasNextPage).toBe(true);

			const secondPage = await execute(database!, {
				after: firstPage.pageInfo.endCursor,
				channelId: microsecondChannelId,
				first: 1,
			});
			expect(
				secondPage.nodes.map(({ id, createdAt }) => ({ id, createdAt })),
			).toEqual([
				{
					id: microsecondMessageIds[0],
					createdAt: "2026-08-15T11:00:00.000Z",
				},
			]);
			expect(secondPage.pageInfo.hasNextPage).toBe(false);
		});

		test("uses fresh Policy evidence for pages, revocation, output guards, and relation disclosure", async () => {
			const firstPage = await execute(database!);
			expect(firstPage).toEqual({
				nodes: [
					{
						author: null,
						body: "oldest",
						createdAt: "2026-08-15T08:00:00.000Z",
						id: messageIds[2],
					},
				],
				pageInfo: { endCursor: expect.any(String), hasNextPage: true },
			});

			const foreignPage = await execute(database!, {
				principal: foreignPrincipalId,
			});
			expect(foreignPage).toEqual({
				nodes: [],
				pageInfo: { endCursor: null, hasNextPage: false },
			});
			const forgedTenantPage = await execute(database!, {
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
			const staleRolePage = await execute(database!, {
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
			expect(await execute(database!)).toEqual({
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
			const firstPage = await execute(database!);
			await expect(
				execute(database!, {
					after: `${firstPage.pageInfo.endCursor}=`,
				}),
			).rejects.toMatchObject({ code: "QP-DATA-010", phase: "bind" });
		});

		test("cancels blocked SQL, rolls back, and reuses the single-connection pool", async () => {
			const holder = await lockDatabase!.reserve();
			const controller = new AbortController();
			try {
				await holder.unsafe("BEGIN");
				await holder.unsafe(
					"LOCK TABLE collaboration.messages IN ACCESS EXCLUSIVE MODE",
				);
				const blocked = execute(database!, { signal: controller.signal });

				let observedBlockedQuery = false;
				for (let attempt = 0; attempt < 100; attempt += 1) {
					const [activity] = await holder<{ blocked: boolean }[]>`
					select exists (
						select 1
						from pg_catalog.pg_stat_activity
						where pid <> pg_catalog.pg_backend_pid()
						  and query like '%qp_page%'
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

			const reusablePage = await execute(database!);
			expect(reusablePage.nodes).toHaveLength(1);
			expect(reusablePage.nodes[0]?.id).toBe(messageIds[2]);
		});
	},
);
