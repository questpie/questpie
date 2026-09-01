import { expect, test } from "bun:test";

import { runtimeArtifactDigest } from "../../packages/runtime/src/application/artifact-protocol";
import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres";
import { linkPostgresQueryPlan } from "../../packages/runtime/src/relational/postgres-database";
import {
	executePostgresDatabaseQuery,
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

test("executes one flattened inverse plan and publishes complete readonly child arrays", async () => {
	let statements = 0;
	let mode: unknown;
	const database = {
		async transaction<Output>(input: {
			mode: unknown;
			use(transaction: unknown): Promise<Output>;
		}): Promise<Output> {
			mode = input.mode;
			return input.use({
				execute: async (statement: { decode(value: unknown): unknown }) => {
					statements += 1;
					return statement.decode({
						command: "SELECT",
						rowCount: rows.length,
						rows,
					});
				},
			});
		},
	} as PostgresTransactionRunner;

	const page = await executePostgresDatabaseQuery({
		linkedPlan: linkPostgresQueryPlan(plan()),
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
	});

	expect(statements).toBe(1);
	expect(mode).toEqual({ isolation: "repeatableRead", access: "readOnly" });
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
