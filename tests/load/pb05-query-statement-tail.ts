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
	type DataQueryPage,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";
import { createPostgresDatabase } from "../../packages/runtime/src/postgres";
import { linkPostgresQueryPlans } from "../../packages/runtime/src/relational/postgres-database";
import scenario from "../../quality/performance/pb05-query-statement-tail.json";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("PB-05 Query tail measurement requires PostgreSQL");

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const seededMessages = 10_001;
const warmupExecutions = 100;
const measuredExecutions = 1_000;

type PageKind = "first" | "cursor";
type RawSample = Readonly<{ page: PageKind; durationMs: number }>;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST!;
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER!;
	url.pathname = `/${process.env.PGDATABASE!}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function binding(
	plan: PostgresQueryPlanV1,
	after: string | null,
): DataQueryBindingV1 {
	return Object.freeze({
		templateDigest: plan.templateDigest,
		values: Object.freeze([
			Object.freeze({ parameter: "after", value: after }),
			Object.freeze({ parameter: "channelId", value: channelId }),
			Object.freeze({ parameter: "first", value: 100 }),
		]),
	});
}

function assertFullPage(page: DataQueryPage, kind: PageKind): void {
	if (page.nodes.length !== 100 || page.pageInfo.hasNextPage !== true)
		throw new Error(
			`${kind} page was not a full continuing page: ${JSON.stringify({
				nodes: page.nodes.length,
				hasNextPage: page.pageInfo.hasNextPage,
			})}`,
		);
}

function nearestRank(values: readonly number[], percentile: number): number {
	if (values.length === 0) throw new Error("cannot summarize zero samples");
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

function distribution(values: readonly number[]) {
	return Object.freeze({
		count: values.length,
		p50Ms: nearestRank(values, 0.5),
		p95Ms: nearestRank(values, 0.95),
		p99Ms: nearestRank(values, 0.99),
		maxMs: Math.max(...values),
	});
}

const admin = new SQL({ max: 1 });
let database: ReturnType<typeof createPostgresDatabase> | undefined;

try {
	await admin.unsafe(
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
		throw new Error(`failed to apply PB-05 migrations: ${applied.status}`);

	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const artifact =
		compilation.generatedFiles["postgres-query-plans.json"] ?? "";
	const decoded = JSON.parse(artifact) as Readonly<{
		plans: readonly PostgresQueryPlanV1[];
	}>;
	const expectedDigests = decoded.plans
		.map(({ queryDigest }) => queryDigest)
		.toSorted();
	const linkedPlans = linkPostgresQueryPlans(artifact, expectedDigests);
	if (linkedPlans.plans.length !== 1)
		throw new Error(
			`expected one collaboration Query plan, got ${linkedPlans.plans.length}`,
		);
	const linkedPlan = linkedPlans.plans[0]!;

	await admin`
		insert into collaboration.companies (id, name)
		values (${companyId}, 'PB-05 company')
	`;
	await admin`
		insert into collaboration.spaces (id, company_id, name)
		values (${spaceId}, ${companyId}, 'PB-05 space')
	`;
	await admin`
		insert into collaboration.channels (id, space_id, name, visibility)
		values (${channelId}, ${spaceId}, 'PB-05 channel', 'company')
	`;
	await admin`
		insert into collaboration.memberships
			(id, company_id, principal_id, role, scope_key, status)
		values
			(${membershipId}, ${companyId}, ${principalId}, 'admin', 'company', 'active')
	`;
	await admin.unsafe(
		`insert into collaboration.messages
			(id, channel_id, author_membership_id, body, created_at)
		select
			pg_catalog.gen_random_uuid(),
			$1::pg_catalog.uuid,
			$2::pg_catalog.uuid,
			'pb05-tail-' || ordinal,
			'2026-08-15T12:00:00Z'::pg_catalog.timestamptz
				+ ordinal * interval '1 millisecond'
		from pg_catalog.generate_series(1, $3::pg_catalog.int4) as ordinal`,
		[channelId, membershipId, seededMessages],
	);
	await admin.unsafe("ANALYZE collaboration.messages");
	const [seedProof] = await admin<ReadonlyArray<Readonly<{ count: number }>>>`
		select count(*)::integer as count
		from collaboration.messages
		where channel_id = ${channelId}
	`;
	if (seedProof?.count !== seededMessages)
		throw new Error(
			`expected ${seededMessages} seeded Messages, got ${seedProof?.count}`,
		);

	const url = postgresUrl();
	database = createPostgresDatabase({
		connectionUrl: url,
		directConnectionUrl: url,
		pool: {
			max: 1,
			connectTimeoutMs: 10_000,
			checkoutTimeoutMs: 10_000,
			idleTimeoutMs: 10_000,
			maxLifetimeSeconds: 300,
		},
		// These are harness safety bounds, not proposed production defaults.
		timeouts: {
			statementMs: 60_000,
			lockMs: 60_000,
			idleInTransactionMs: 60_000,
		},
	});
	const executionFacts = Object.freeze({
		authority: Object.freeze({ kind: "ordinary" as const }),
		principal: Object.freeze({ id: principalId, kind: "user" as const }),
		tenant: Object.freeze({ id: companyId }),
	});
	const execute = (after: string | null) =>
		executePostgresQuery({
			linkedPlan,
			database: database!,
			binding: binding(linkedPlan.plan, after),
			executionFacts,
		});

	// Cursor derivation intentionally happens only after the complete seed exists.
	const cursorSource = await execute(null);
	assertFullPage(cursorSource, "first");
	const cursor = cursorSource.pageInfo.endCursor;
	if (cursor === null) throw new Error("first page did not produce a cursor");
	const cursorProof = await execute(cursor);
	assertFullPage(cursorProof, "cursor");

	for (let index = 0; index < warmupExecutions; index += 1) {
		const kind: PageKind = index % 2 === 0 ? "first" : "cursor";
		assertFullPage(await execute(kind === "first" ? null : cursor), kind);
	}

	const rawSamples: RawSample[] = [];
	for (let index = 0; index < measuredExecutions; index += 1) {
		const page: PageKind = index % 2 === 0 ? "first" : "cursor";
		const started = performance.now();
		const result = await execute(page === "first" ? null : cursor);
		const durationMs = performance.now() - started;
		assertFullPage(result, page);
		rawSamples.push(Object.freeze({ page, durationMs }));
	}

	const firstSamples = rawSamples
		.filter(({ page }) => page === "first")
		.map(({ durationMs }) => durationMs);
	const cursorSamples = rawSamples
		.filter(({ page }) => page === "cursor")
		.map(({ durationMs }) => durationMs);
	const measurements = Object.freeze({
		seededMessages,
		warmupExecutions,
		measuredExecutions: rawSamples.length,
		firstPageSamples: firstSamples.length,
		cursorPageSamples: cursorSamples.length,
	});
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		const measured = measurements[name as keyof typeof measurements];
		if (metric.direction === "min" && measured < metric.budget)
			throw new Error(`${name} ${measured} is below ${metric.budget}`);
		if (metric.direction === "max" && measured > metric.budget)
			throw new Error(`${name} ${measured} exceeds ${metric.budget}`);
	}

	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ?? "reference-local",
			workProof: {
				seedCompletedBeforeCursorDerivation: true,
				alternatingMeasuredPages: true,
			},
			measurements,
			distributions: {
				all: distribution(rawSamples.map(({ durationMs }) => durationMs)),
				first: distribution(firstSamples),
				cursor: distribution(cursorSamples),
			},
			rawSamples,
			status: "PASS",
		}),
	);
} finally {
	await database?.close({ deadlineAt: Date.now() + 10_000 });
	await admin.close({ timeout: 0 });
}
