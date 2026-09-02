import { expect, test } from "bun:test";

import { runtimeArtifactDigest } from "../../packages/runtime/src/application/artifact-protocol";
import {
	createLiveQueryObservation,
	type LinkedQueryWatchabilityV1,
} from "../../packages/runtime/src/live-query";
import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres";
import { linkPostgresQueryPlan } from "../../packages/runtime/src/relational/postgres-database";
import {
	executePostgresDatabaseQuery,
	type PostgresQueryObserver,
	type PostgresQueryPlanV2,
} from "../../packages/runtime/src/relational/query";

const templateDigest = "a".repeat(64);
const root1 = "00000000-0000-0000-0000-000000000001";
const root2 = "00000000-0000-0000-0000-000000000002";
const sentinel = "00000000-0000-0000-0000-000000000003";
const child1 = "10000000-0000-0000-0000-000000000001";
const child2 = "10000000-0000-0000-0000-000000000002";

function plan(): PostgresQueryPlanV2 {
	const linked = {
		format: "questpie.postgres-query-plan" as const,
		version: 2 as const,
		templateVersion: 2 as const,
		queryDigest: templateDigest,
		templateDigest,
		policy: "policy:tickets",
		policyProgramDigest: "b".repeat(64),
		inversePolicyProgramDigest: "c".repeat(64),
		usedExecutionFacts: [],
		admission: "public" as const,
		binding: {
			parameters: [
				{ name: "after", kind: "cursor" as const, nullable: true as const },
				{
					name: "first",
					kind: "scalar" as const,
					codec: { kind: "integer" as const, minimum: 1, maximum: 100 },
					nullable: false,
				},
			],
		},
		page: {
			kind: "forwardCursor" as const,
			first: { parameter: "first", minimum: 1, maximum: 100 },
			after: { parameter: "after" },
			scopeParameters: [],
			order: [
				{
					field: "collection:tickets/field:id",
					codec: "uuid",
					nullable: false,
				},
			],
		},
		sql: `SELECT
	1::bigint AS "qp_root_ordinal",
	NULL::uuid AS "qp_ticket_id",
	NULL::text AS "qp_summary",
	NULL::uuid AS "qp_inverse_2_value_0",
	NULL::text AS "qp_inverse_2_value_1",
	TRUE AS "qp_inverse_2_allowed_1",
	NULL::timestamptz AS "qp_inverse_2_value_2",
	TRUE AS "qp_relation_2_0_present",
	NULL::uuid AS "qp_relation_2_0_value_0",
	1::bigint AS "qp_inverse_2_ordinal"
	FROM "qp_page" AS "qp_row"
	WHERE NOT $1::boolean
		AND $2::uuid IS NULL
		AND $3::integer > 0
		AND $4::integer = 2;\n`,
		parameters: [
			{
				position: 1,
				kind: "cursorPresent" as const,
				parameter: "after",
				postgresType: "boolean",
			},
			{
				position: 2,
				kind: "cursorValue" as const,
				parameter: "after",
				field: "collection:tickets/field:id",
				postgresType: "uuid",
			},
			{
				position: 3,
				kind: "queryParameter" as const,
				parameter: "first",
				postgresType: "integer",
			},
			{
				position: 4,
				kind: "literal" as const,
				value: 2,
				codec: "integer",
				postgresType: "integer",
			},
		],
		result: [
			{
				kind: "field" as const,
				key: "id",
				field: "collection:tickets/field:id",
				column: "qp_ticket_id",
				codec: { kind: "uuid" as const },
				nullable: false,
			},
			{
				kind: "field" as const,
				key: "summary",
				field: "collection:tickets/field:summary",
				column: "qp_summary",
				codec: {
					kind: "text" as const,
					minLength: 1,
					maxLength: 100,
					collation: "questpie.binary" as const,
				},
				nullable: false,
			},
			{
				kind: "inverseList" as const,
				key: "comments",
				relation: "collection:comments/relation:ticket",
				source: "collection:comments",
				correlation: [
					{
						field: "collection:comments/field:ticketId",
						reference: "collection:tickets/field:id",
					},
				],
				first: 2,
				ordinalColumn: "qp_inverse_2_ordinal",
				fields: [
					{
						key: "id",
						field: "collection:comments/field:id",
						column: "qp_inverse_2_value_0",
						codec: { kind: "uuid" as const },
						nullable: false,
					},
					{
						key: "body",
						field: "collection:comments/field:body",
						column: "qp_inverse_2_value_1",
						guardColumn: "qp_inverse_2_allowed_1",
						codec: {
							kind: "text" as const,
							minLength: 1,
							maxLength: 1_000,
							collation: "questpie.binary" as const,
						},
						nullable: false,
					},
					{
						key: "createdAt",
						field: "collection:comments/field:createdAt",
						column: "qp_inverse_2_value_2",
						codec: { kind: "timestamp" as const, withTimezone: true },
						nullable: false,
					},
				],
				relations: [
					{
						kind: "toOne" as const,
						key: "author",
						relation: "collection:comments/relation:author",
						collection: "collection:memberships",
						presenceColumn: "qp_relation_2_0_present",
						fields: [
							{
								key: "id",
								field: "collection:memberships/field:id",
								column: "qp_relation_2_0_value_0",
								codec: { kind: "uuid" as const },
								nullable: false,
							},
						],
					},
				],
			},
		],
		ordinalColumns: ["qp_root_ordinal", "qp_inverse_2_ordinal"] as const,
	};
	return {
		...linked,
		statementDigest: runtimeArtifactDigest(
			"questpie-postgres-query-statement-v2",
			linked,
		),
	};
}

const rows = [
	[
		"1",
		root1,
		"First",
		child1,
		"visible",
		true,
		"2026-09-01T10:00:00.000Z",
		true,
		root1,
		"1",
	],
	[
		"1",
		root1,
		"First",
		child2,
		null,
		false,
		"2026-09-01T09:00:00.000Z",
		null,
		null,
		"2",
	],
	["2", root2, "Second", null, null, null, null, null, null, null],
	[
		"3",
		sentinel,
		"Sentinel",
		child1,
		"hidden root",
		true,
		"2026-09-01T08:00:00.000Z",
		true,
		root1,
		"1",
	],
] as const;

function withStatementDigest(
	value: Omit<PostgresQueryPlanV2, "statementDigest">,
): PostgresQueryPlanV2 {
	return {
		...value,
		statementDigest: runtimeArtifactDigest(
			"questpie-postgres-query-statement-v2",
			value,
		),
	};
}

async function executeRows(
	returnedRows: readonly (readonly unknown[])[],
	options: Readonly<{
		observer?: PostgresQueryObserver;
		plan?: PostgresQueryPlanV2;
		signal?: AbortSignal;
	}> = {},
) {
	const facts: { statements: number; transactions: number; mode?: unknown } = {
		statements: 0,
		transactions: 0,
	};
	const database = {
		async transaction<Output>(input: {
			mode: unknown;
			use(transaction: unknown): Promise<Output>;
		}): Promise<Output> {
			facts.transactions += 1;
			facts.mode = input.mode;
			return input.use({
				execute: async (statement: { decode(value: unknown): unknown }) => {
					facts.statements += 1;
					return statement.decode({
						command: "SELECT",
						rowCount: returnedRows.length,
						rows: returnedRows,
					});
				},
			});
		},
	} as PostgresTransactionRunner;
	const result = executePostgresDatabaseQuery({
		linkedPlan: linkPostgresQueryPlan(options.plan ?? plan()),
		binding: {
			templateDigest,
			values: [
				{ parameter: "after", value: null },
				{ parameter: "first", value: 2 },
			],
		},
		executionFacts: {
			authority: { kind: "ordinary" },
			principal: { id: "anonymous", kind: "anonymous" },
			tenant: { id: "public" },
		},
		database,
		observer: options.observer,
		signal: options.signal,
	});
	return { facts, result };
}

test("executes one flattened inverse plan and publishes complete readonly child arrays", async () => {
	const execution = await executeRows(rows);
	const page = await execution.result;

	expect(execution.facts).toMatchObject({
		statements: 1,
		transactions: 1,
		mode: { isolation: "repeatableRead", access: "readOnly" },
	});
	expect(page).toEqual({
		nodes: [
			{
				id: root1,
				summary: "First",
				comments: [
					{
						id: child1,
						body: "visible",
						createdAt: new Date("2026-09-01T10:00:00.000Z"),
						author: { id: root1 },
					},
					{
						id: child2,
						createdAt: new Date("2026-09-01T09:00:00.000Z"),
						author: null,
					},
				],
			},
			{ id: root2, summary: "Second", comments: [] },
		],
		pageInfo: { endCursor: expect.any(String), hasNextPage: true },
	});
	expect(Object.isFrozen(page.nodes)).toBe(true);
	expect(Object.isFrozen(page.nodes[0]!.comments)).toBe(true);
});

test("rejects malformed flattened ordinals and root drift without partial output", async () => {
	for (const hostile of [
		rows.map((row, index) => (index === 1 ? [...row.slice(0, -1), "3"] : row)),
		rows.map((row, index) =>
			index === 1 ? [row[0], row[1], "changed", ...row.slice(3)] : row,
		),
		rows.map((row, index) =>
			index === 2 ? [...row.slice(0, 3), child1, ...row.slice(4)] : row,
		),
		[rows[0]!, rows[1]!, rows[3]!],
	] as const) {
		const execution = await executeRows(hostile);
		await expect(execution.result).rejects.toMatchObject({
			code: "QP-DATA-001",
			phase: "execute",
		});
		expect(execution.facts).toMatchObject({ statements: 1, transactions: 1 });
	}
});

test("enforces the complete semantic result-byte boundary", async () => {
	const original = plan();
	const inverse = original.result.find(
		(
			item,
		): item is Extract<
			(typeof original.result)[number],
			{ kind: "inverseList" }
		> => item.kind === "inverseList",
	)!;
	const body = inverse.fields.find(({ key }) => key === "body")!;
	const { statementDigest: _statementDigest, ...unsigned } = original;
	const largePlan = withStatementDigest({
		...unsigned,
		result: unsigned.result.map((item) =>
			item === inverse
				? {
						...inverse,
						fields: inverse.fields.map((field) =>
							field === body
								? {
										...body,
										codec: { ...body.codec, maxLength: 2_000_000 },
									}
								: field,
						),
					}
				: item,
		),
	});
	const largeRows = rows.map((row, index) =>
		index === 0
			? [...row.slice(0, 4), "x".repeat(1_048_576), ...row.slice(5)]
			: row,
	);
	const execution = await executeRows(largeRows, { plan: largePlan });
	await expect(execution.result).rejects.toMatchObject({
		code: "QP-DATA-012",
		phase: "execute",
	});
});

test("performs zero PostgreSQL work when already cancelled", async () => {
	const controller = new AbortController();
	controller.abort(new DOMException("cancelled", "AbortError"));
	const execution = await executeRows(rows, { signal: controller.signal });
	await expect(execution.result).rejects.toMatchObject({ name: "AbortError" });
	expect(execution.facts).toEqual({ statements: 0, transactions: 0 });
});

test("observes the inverse boundary, empty miss, nested Relation, and Policy closure", async () => {
	const structuralQueries = new Map([
		[
			templateDigest,
			{
				kind: "structuralQuery" as const,
				templateDigest,
				policy: "policy:tickets",
				policyProgramDigest: "b".repeat(64),
				collections: [
					"collection:comments",
					"collection:memberships",
					"collection:tickets",
				],
				relations: [
					"collection:comments/relation:author",
					"collection:comments/relation:ticket",
				],
				tokens: [
					"collectionRange",
					"orderingBoundary",
					"pageSentinel",
					"policyEvidencePoint",
					"relationEndpoint",
					"relationMiss",
				],
			},
		],
	]);
	const observation = createLiveQueryObservation({
		identity: "query:tickets.detail",
		watchable: true,
		inputCodec: {},
		outputCodec: {},
		contractDigest: "d".repeat(64),
		context: {
			kind: "context",
			identity: "context:request",
			projectionDigest: "e".repeat(64),
			tokens: ["contextBootstrapPoint"],
		},
		structuralQueries,
		maximumTokensPerPlan: 256,
		unsupportedReason: null,
	} satisfies LinkedQueryWatchabilityV1);
	observation.recordContext("context:request", [
		{
			kind: "contextBootstrapPoint",
			collection: "collection:memberships",
			detail: { reached: true },
		},
	]);
	const execution = await executeRows(rows, { observer: observation });
	await execution.result;
	const tokens = observation.finish().tokens;
	const token = (kind: string, collection: string) =>
		tokens.find(
			(candidate) =>
				candidate.kind === kind && candidate.collection === collection,
		);

	expect(token("relationEndpoint", "collection:comments")?.detail).toEqual({
		conservative: true,
		correlation: [
			{
				field: "collection:comments/field:ticketId",
				reference: "collection:tickets/field:id",
			},
		],
		first: 2,
		kind: "inverseList",
		observed: 2,
		relation: "collection:comments/relation:ticket",
		statementDigest: plan().statementDigest,
	});
	expect(token("relationMiss", "collection:comments")?.detail).toMatchObject({
		observed: 1,
		relation: "collection:comments/relation:ticket",
	});
	expect(
		token("relationEndpoint", "collection:memberships")?.detail,
	).toMatchObject({
		observed: 1,
		relation: "collection:comments/relation:author",
	});
	expect(token("relationMiss", "collection:memberships")?.detail).toMatchObject(
		{
			observed: 1,
			relation: "collection:comments/relation:author",
		},
	);
	expect(token("policyEvidencePoint", "collection:comments")?.detail).toEqual({
		conservative: true,
		policyProgramDigest: "c".repeat(64),
		relation: "collection:comments/relation:ticket",
	});
	expect(
		token("policyEvidencePoint", "collection:memberships")?.detail,
	).toMatchObject({
		policyProgramDigest: "b".repeat(64),
		relation: "collection:comments/relation:author",
	});
	expect(token("pageSentinel", "collection:tickets")?.detail).toEqual({
		first: 2,
		hasNextPage: true,
		observed: 2,
	});
});
