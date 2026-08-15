import { expect, test } from "bun:test";

import {
	lowerPostgresQueryPlan,
	lowerPostgresQueryPlans,
} from "../../packages/compiler/src/relational/postgres";
import type {
	DataQueryTemplateV1,
	PolicyExpressionV1,
	PolicyProgramV1,
} from "../../packages/compiler/src/relational/types";

const field = (collection: string, name: string) =>
	`collection:${collection}/field:${name}`;
const collection = (name: string) => ({
	identity: `collection:${name}`,
	postgresName: name,
	fields: [] as Array<Record<string, unknown>>,
	relations: [] as Array<Record<string, unknown>>,
});

function schema() {
	const messages = collection("messages");
	messages.fields.push(
		{
			identity: field("messages", "id"),
			postgresName: "id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("messages", "channelId"),
			postgresName: "channel_id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("messages", "authorMembershipId"),
			postgresName: "author_membership_id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("messages", "body"),
			postgresName: "body",
			nullable: false,
			type: {
				kind: "text",
				minLength: 1,
				maxLength: 8_192,
				collation: "questpie.binary",
			},
		},
		{
			identity: field("messages", "createdAt"),
			postgresName: "created_at",
			nullable: false,
			type: { kind: "timestamp", withTimezone: true },
		},
	);
	messages.relations.push({
		identity: "collection:messages/relation:author",
		kind: "toOne",
		target: "collection:memberships",
		fields: [field("messages", "authorMembershipId")],
		references: [field("memberships", "id")],
	});
	const channels = collection("channels");
	channels.fields.push(
		{
			identity: field("channels", "id"),
			postgresName: "id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("channels", "spaceId"),
			postgresName: "space_id",
			nullable: false,
			type: { kind: "uuid" },
		},
	);
	const spaces = collection("spaces");
	spaces.fields.push(
		{
			identity: field("spaces", "id"),
			postgresName: "id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("spaces", "companyId"),
			postgresName: "company_id",
			nullable: false,
			type: { kind: "uuid" },
		},
	);
	const companies = collection("companies");
	companies.fields.push({
		identity: field("companies", "id"),
		postgresName: "id",
		nullable: false,
		type: { kind: "uuid" },
	});
	const memberships = collection("memberships");
	memberships.fields.push(
		{
			identity: field("memberships", "id"),
			postgresName: "id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("memberships", "companyId"),
			postgresName: "company_id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("memberships", "principalId"),
			postgresName: "principal_id",
			nullable: false,
			type: { kind: "uuid" },
		},
		{
			identity: field("memberships", "scopeKey"),
			postgresName: "scope_key",
			nullable: false,
			type: {
				kind: "text",
				minLength: 1,
				maxLength: 63,
				collation: "questpie.binary",
			},
		},
		{
			identity: field("memberships", "status"),
			postgresName: "status",
			nullable: false,
			type: {
				kind: "text",
				minLength: 1,
				maxLength: 16,
				collation: "questpie.binary",
			},
		},
		{
			identity: field("memberships", "role"),
			postgresName: "role",
			nullable: false,
			type: {
				kind: "text",
				minLength: 1,
				maxLength: 32,
				collation: "questpie.binary",
			},
		},
	);
	return {
		format: "questpie.schema-projection",
		version: 1,
		application: { name: "collaboration", postgresSchema: "collaboration" },
		collections: [channels, companies, memberships, messages, spaces],
	};
}

const policyField = (
	scope: string,
	collectionName: string,
	name: string,
	codec = "uuid",
) => ({
	kind: "field" as const,
	scope,
	collection: `collection:${collectionName}` as const,
	path: [name],
	codec,
});
const literal = (value: string, codec = "text") => ({
	kind: "literal" as const,
	codec,
	value,
});
const execution = (
	source: "authority" | "principal" | "tenant",
	path: string[],
	codec: string,
) => ({
	kind: "executionFact" as const,
	source,
	path,
	codec,
});
const equal = (
	left: ReturnType<typeof policyField> | ReturnType<typeof execution>,
	right:
		| ReturnType<typeof policyField>
		| ReturnType<typeof execution>
		| ReturnType<typeof literal>,
): PolicyExpressionV1 => ({ kind: "equal", left, right });
const and = (...items: PolicyExpressionV1[]): PolicyExpressionV1 => ({
	kind: "and",
	items,
});
const exists = (
	scope: string,
	collectionName: string,
	predicate: PolicyExpressionV1,
): PolicyExpressionV1 => ({
	kind: "exists",
	collection: `collection:${collectionName}`,
	scope,
	semantics: "policyEvidenceBooleanOnly",
	targetDisclosurePolicy: "notApplied",
	predicate,
});

function messagePolicy(): PolicyProgramV1 {
	const rows = exists(
		"evidence0",
		"channels",
		and(
			equal(
				policyField("evidence0", "channels", "id"),
				policyField("row", "messages", "channelId"),
			),
			exists(
				"evidence1",
				"spaces",
				and(
					equal(
						policyField("evidence1", "spaces", "id"),
						policyField("evidence0", "channels", "spaceId"),
					),
					exists(
						"evidence2",
						"companies",
						and(
							equal(
								policyField("evidence2", "companies", "id"),
								policyField("evidence1", "spaces", "companyId"),
							),
							equal(
								policyField("evidence2", "companies", "id"),
								execution("tenant", ["id"], "uuid"),
							),
							exists(
								"evidence3",
								"memberships",
								and(
									equal(
										policyField("evidence3", "memberships", "companyId"),
										policyField("evidence2", "companies", "id"),
									),
									equal(
										policyField("evidence3", "memberships", "principalId"),
										execution("principal", ["id"], "uuid"),
									),
									equal(
										policyField("evidence3", "memberships", "scopeKey", "text"),
										literal("company"),
									),
									equal(
										policyField("evidence3", "memberships", "status", "text"),
										literal("active"),
									),
								),
							),
						),
					),
				),
			),
		),
	);
	const bodyGuard = exists(
		"evidence4",
		"memberships",
		and(
			equal(
				policyField("evidence4", "memberships", "companyId"),
				execution("tenant", ["id"], "uuid"),
			),
			equal(
				policyField("evidence4", "memberships", "principalId"),
				execution("principal", ["id"], "uuid"),
			),
			equal(
				policyField("evidence4", "memberships", "scopeKey", "text"),
				literal("company"),
			),
			equal(
				policyField("evidence4", "memberships", "status", "text"),
				literal("active"),
			),
			{
				kind: "in",
				operand: policyField("evidence4", "memberships", "role", "text"),
				values: [literal("admin"), literal("owner")],
			},
			{
				kind: "notEqual",
				left: policyField("row", "messages", "channelId"),
				right: literal("00000000-0000-0000-0000-000000000000", "uuid"),
			},
		),
	);
	return {
		format: "questpie.policy-program",
		version: 1,
		identity: "policy:messages.default",
		target: "collection:messages",
		attachment: { kind: "default", requiredForNormalDataAccess: true },
		operations: { read: { admission: { kind: "authenticated" }, rows } },
		fields: {
			callerInput: { suppliedPathsOnly: true },
			selectedOutput: [
				{ path: ["body"], when: bodyGuard, deniedEncoding: "omitProperty" },
			],
		},
	};
}

const membershipPolicy: PolicyProgramV1 = {
	format: "questpie.policy-program",
	version: 1,
	identity: "policy:memberships.default",
	target: "collection:memberships",
	attachment: { kind: "default", requiredForNormalDataAccess: true },
	operations: {
		read: {
			admission: { kind: "authenticated" },
			rows: equal(
				execution("authority", ["kind"], "authority"),
				literal("system", "authority"),
			),
		},
	},
};

const template: DataQueryTemplateV1 = {
	format: "questpie.data-query-template",
	version: 1,
	from: "collection:messages",
	schemaProjectionDigest: "a".repeat(64),
	dataContractProjectionDigest: "b".repeat(64),
	parameters: [
		{ name: "after", kind: "cursor", nullable: true },
		{
			name: "channelId",
			kind: "scalar",
			codec: { kind: "uuid" },
			nullable: false,
		},
		{
			name: "first",
			kind: "scalar",
			codec: { kind: "integer", minimum: 1, maximum: 100 },
			nullable: false,
		},
	],
	select: [
		{
			kind: "toOne",
			key: "author",
			relation: "collection:messages/relation:author",
			select: [
				{ kind: "field", key: "id", field: "collection:memberships/field:id" },
				{
					kind: "field",
					key: "role",
					field: "collection:memberships/field:role",
				},
			],
		},
		{ kind: "field", key: "body", field: "collection:messages/field:body" },
		{
			kind: "field",
			key: "createdAt",
			field: "collection:messages/field:createdAt",
		},
		{ kind: "field", key: "id", field: "collection:messages/field:id" },
	],
	filter: {
		kind: "equal",
		field: "collection:messages/field:channelId",
		operand: { kind: "parameter", parameter: "channelId" },
	},
	order: [
		{
			field: "collection:messages/field:createdAt",
			direction: "desc",
			nulls: "last",
		},
		{ field: "collection:messages/field:id", direction: "desc", nulls: "last" },
	],
	page: {
		kind: "forwardCursor",
		first: { kind: "parameter", parameter: "first" },
		after: { kind: "parameter", parameter: "after" },
		uniqueConstraint: "collection:messages/constraint:primary",
	},
};

test("lowers one Policy-authorized Message page to one static PostgreSQL statement", () => {
	const policies = [
		{
			program: messagePolicy(),
			scopeBindings: [
				{
					scope: "evidence0",
					collection: "collection:channels",
					parentScope: "row",
				},
				{
					scope: "evidence1",
					collection: "collection:spaces",
					parentScope: "evidence0",
				},
				{
					scope: "evidence2",
					collection: "collection:companies",
					parentScope: "evidence1",
				},
				{
					scope: "evidence3",
					collection: "collection:memberships",
					parentScope: "evidence2",
				},
				{
					scope: "evidence4",
					collection: "collection:memberships",
					parentScope: "row",
				},
				{
					scope: "row",
					collection: "collection:messages",
					parentScope: null,
				},
			],
		},
		{
			program: membershipPolicy,
			scopeBindings: [
				{
					scope: "row",
					collection: "collection:memberships",
					parentScope: null,
				},
			],
		},
	] as const;
	const query = {
		digest: "c".repeat(64),
		policy: "policy:messages.default",
		template,
	};
	const plan = lowerPostgresQueryPlan({
		schema: schema(),
		query,
		policies,
	});

	expect(JSON.stringify(plan, null, 2)).toMatchSnapshot();
	expect(
		plan.sql
			.split(";")
			.map((statement) => statement.trim())
			.filter(Boolean),
	).toHaveLength(1);
	expect(plan.sql.indexOf('"qp_authorized" AS MATERIALIZED')).toBeLessThan(
		plan.sql.indexOf('"qp_page" AS MATERIALIZED'),
	);
	expect(plan.sql).toContain("EXISTS (SELECT 1");
	expect(plan.sql).not.toContain("COUNT(");
	expect(plan.sql).toContain("LIMIT ($");
	expect(plan.sql).toContain(" + 1)");
	expect(plan.page).toEqual({
		kind: "forwardCursor",
		first: { parameter: "first", minimum: 1, maximum: 100 },
		after: { parameter: "after" },
		scopeParameters: ["channelId"],
		order: [
			{
				field: "collection:messages/field:createdAt",
				codec: "timestamp",
				nullable: false,
				withTimezone: true,
			},
			{
				field: "collection:messages/field:id",
				codec: "uuid",
				nullable: false,
			},
		],
	});
	expect(plan.binding.parameters).toEqual(template.parameters);
	expect(plan.usedExecutionFacts).toEqual([
		"authorityKind",
		"principalId",
		"tenantId",
	]);
	expect(plan.policyProgramDigest).toMatch(/^[0-9a-f]{64}$/);
	expect(plan.result).toContainEqual(
		expect.objectContaining({ key: "body", guardColumn: expect.any(String) }),
	);
	expect(plan.result).toContainEqual(
		expect.objectContaining({
			key: "author",
			presenceColumn: expect.any(String),
		}),
	);
	const envelope = lowerPostgresQueryPlans({
		schema: schema(),
		policyProjection: {
			format: "questpie.policy-projection",
			version: 1,
			policies,
		},
		queryProjection: {
			format: "questpie.query-projection",
			version: 1,
			queries: [{ ...query, digest: "d".repeat(64) }, query],
		},
	});
	expect(envelope.format).toBe("questpie.postgres-query-plans");
	expect(envelope.plans.map(({ queryDigest }) => queryDigest)).toEqual([
		"c".repeat(64),
		"d".repeat(64),
	]);
});
