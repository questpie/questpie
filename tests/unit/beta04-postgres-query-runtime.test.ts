import { expect, test } from "bun:test";

import {
	DataQueryExecutionError,
	executePostgresQuery,
	type PostgresQueryAdapter,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";

const templateDigest = "a".repeat(64);
const policyProgramDigest = "b".repeat(64);
const createdAt1 = "2026-08-15T08:00:00.000Z";
const createdAt2 = "2026-08-15T09:00:00.000Z";
const createdAt3 = "2026-08-15T10:00:00.000Z";
const id1 = "00000000-0000-0000-0000-000000000001";
const id2 = "00000000-0000-0000-0000-000000000002";
const id3 = "00000000-0000-0000-0000-000000000003";

const plan = {
	format: "questpie.postgres-query-plan",
	version: 1,
	queryDigest: templateDigest,
	templateDigest,
	policy: "policy:messageAccess",
	policyProgramDigest,
	usedExecutionFacts: ["tenantId"],
	admission: "authenticated",
	binding: {
		parameters: [
			{ name: "after", kind: "cursor", nullable: true },
			{
				name: "first",
				kind: "scalar",
				codec: { kind: "integer", minimum: 1, maximum: 100 },
				nullable: false,
			},
			{
				name: "statuses",
				kind: "list",
				codec: {
					kind: "text",
					minLength: 1,
					maxLength: 20,
					collation: "questpie.binary",
				},
				maximumItems: 3,
				nullable: false,
				semantics: "set",
			},
			{
				name: "tenantSlug",
				kind: "scalar",
				codec: {
					kind: "text",
					minLength: 1,
					maxLength: 63,
					collation: "questpie.binary",
				},
				nullable: false,
			},
		],
	},
	page: {
		kind: "forwardCursor",
		first: { parameter: "first", minimum: 1, maximum: 100 },
		after: { parameter: "after" },
		scopeParameters: ["statuses", "tenantSlug"],
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
	},
	sql: "SELECT one authorized page\n",
	parameters: [
		{
			position: 1,
			kind: "executionFact",
			source: "tenant",
			path: ["id"],
			codec: "uuid",
			postgresType: "uuid",
		},
		{
			position: 2,
			kind: "queryParameter",
			parameter: "tenantSlug",
			postgresType: "text",
		},
		{
			position: 3,
			kind: "queryParameter",
			parameter: "statuses",
			postgresType: "text[]",
		},
		{
			position: 4,
			kind: "cursorPresent",
			parameter: "after",
			postgresType: "boolean",
		},
		{
			position: 5,
			kind: "cursorValue",
			parameter: "after",
			field: "collection:messages/field:createdAt",
			postgresType: "timestamptz",
		},
		{
			position: 6,
			kind: "cursorValue",
			parameter: "after",
			field: "collection:messages/field:id",
			postgresType: "uuid",
		},
		{
			position: 7,
			kind: "queryParameter",
			parameter: "first",
			postgresType: "integer",
		},
	],
	result: [
		{
			kind: "field",
			key: "id",
			field: "collection:messages/field:id",
			column: "qp_f0",
			codec: { kind: "uuid" },
			nullable: false,
		},
		{
			kind: "field",
			key: "body",
			field: "collection:messages/field:body",
			column: "qp_f1",
			guardColumn: "qp_g1",
			codec: {
				kind: "text",
				minLength: 1,
				maxLength: 1_000,
				collation: "questpie.binary",
			},
			nullable: false,
		},
		{
			kind: "field",
			key: "createdAt",
			field: "collection:messages/field:createdAt",
			column: "qp_f2",
			codec: { kind: "timestamp", withTimezone: true },
			nullable: false,
		},
		{
			kind: "toOne",
			key: "author",
			relation: "collection:messages/relation:author",
			presenceColumn: "qp_r3_present",
			fields: [
				{
					key: "name",
					field: "collection:users/field:name",
					column: "qp_r3_f0",
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 100,
						collation: "questpie.binary",
					},
					nullable: false,
				},
			],
		},
	],
} as const satisfies PostgresQueryPlanV1;

const binding = {
	templateDigest,
	values: [
		{ parameter: "after", value: null },
		{ parameter: "first", value: 2 },
		{ parameter: "statuses", value: ["published", "draft", "published"] },
		{ parameter: "tenantSlug", value: "north" },
	],
} as const;

const executionFacts = {
	authority: { kind: "ordinary" as const },
	principal: { id: "00000000-0000-0000-0000-000000000010" },
	tenant: { id: "00000000-0000-0000-0000-000000000020" },
};

function rows() {
	return [
		{
			qp_f0: id1,
			qp_f1: "visible",
			qp_g1: true,
			qp_f2: createdAt1,
			qp_r3_present: true,
			qp_r3_f0: "Ada",
		},
		{
			qp_f0: id2,
			qp_f1: null,
			qp_g1: false,
			qp_f2: createdAt2,
			qp_r3_present: null,
			qp_r3_f0: null,
		},
		{
			qp_f0: id3,
			qp_f1: "more",
			qp_g1: true,
			qp_f2: createdAt3,
			qp_r3_present: true,
			qp_r3_f0: "Lin",
		},
	];
}

test("binds one exact authorized page and decodes structural disclosure", async () => {
	const calls: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
	const transactionOptions: unknown[] = [];
	const adapter: PostgresQueryAdapter = {
		transaction: async (options, use) => {
			transactionOptions.push(options);
			return use({
				query: async (sql, parameters) => {
					calls.push({ sql, parameters });
					return rows();
				},
			});
		},
	};

	const page = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		adapter,
		maximumPageSize: 50,
	});

	expect(transactionOptions).toEqual([
		{ isolationLevel: "repeatable read", readOnly: true, signal: undefined },
	]);
	expect(calls).toEqual([
		{
			sql: plan.sql,
			parameters: [
				executionFacts.tenant.id,
				"north",
				["draft", "published"],
				false,
				null,
				null,
				2,
			],
		},
	]);
	expect(page.nodes).toEqual([
		{
			id: id1,
			body: "visible",
			createdAt: createdAt1,
			author: { name: "Ada" },
		},
		{ id: id2, createdAt: createdAt2, author: null },
	]);
	expect(page.pageInfo.hasNextPage).toBe(true);
	const endCursor = page.pageInfo.endCursor;
	expect(endCursor).not.toBeNull();
	const cursor = JSON.parse(Buffer.from(endCursor!, "base64url").toString());
	expect(cursor).toMatchObject({
		format: "questpie.data-cursor",
		version: 2,
		templateDigest,
		scopeDigest:
			"351298fdcbcf6f9f254925e8bcdec8dd9e883c6647f1151db28299c5d5650935",
		order: [
			{ field: plan.page.order[0].field, value: createdAt2 },
			{ field: plan.page.order[1].field, value: id2 },
		],
	});
});

test("rejects exact binding failures before opening a transaction", async () => {
	let transactions = 0;
	const adapter: PostgresQueryAdapter = {
		transaction: async () => {
			transactions += 1;
			return undefined as never;
		},
	};
	const invalidBindings = [
		{
			binding: { ...binding, values: binding.values.slice(0, -1) },
			code: "QP-DATA-014",
		},
		{
			binding: {
				...binding,
				values: [...binding.values, { parameter: "extra", value: true }],
			},
			code: "QP-DATA-014",
		},
		{
			binding: {
				...binding,
				values: [...binding.values, binding.values[0]],
			},
			code: "QP-DATA-014",
		},
		{
			binding: {
				...binding,
				values: binding.values.map((item) =>
					item.parameter === "tenantSlug" ? { ...item, value: "" } : item,
				),
			},
			code: "QP-DATA-001",
		},
		{
			binding: {
				...binding,
				values: binding.values.map((item) =>
					item.parameter === "statuses"
						? { ...item, value: ["a", "b", "c", "d"] }
						: item,
				),
			},
			code: "QP-DATA-006",
		},
	] as const;

	for (const hostile of invalidBindings) {
		try {
			await executePostgresQuery({
				plan,
				binding: hostile.binding,
				executionFacts,
				adapter,
				maximumPageSize: 50,
			});
			expect.unreachable("binding should fail");
		} catch (error) {
			expect(error).toBeInstanceOf(DataQueryExecutionError);
			expect(error).toMatchObject({
				blocking: "none",
				code: hostile.code,
				phase: "bind",
			});
		}
	}

	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			adapter,
			maximumPageSize: 1,
		}),
	).rejects.toMatchObject({ code: "QP-DATA-012", phase: "bind" });
	expect(transactions).toBe(0);
});

test("rejects a cursor scope mismatch before SQL", async () => {
	const firstPage = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		adapter: {
			transaction: async (_options, use) =>
				use({ query: async () => rows().slice(0, 1) }),
		},
	});
	let transactions = 0;
	const changedScope = {
		...binding,
		values: binding.values.map((item) =>
			item.parameter === "tenantSlug" ? { ...item, value: "south" } : item,
		),
	};
	await expect(
		executePostgresQuery({
			plan,
			binding: {
				...changedScope,
				values: changedScope.values.map((item) =>
					item.parameter === "after"
						? { ...item, value: firstPage.pageInfo.endCursor }
						: item,
				),
			},
			executionFacts,
			adapter: {
				transaction: async () => {
					transactions += 1;
					return undefined as never;
				},
			},
		}),
	).rejects.toMatchObject({ code: "QP-DATA-013", phase: "bind" });
	expect(transactions).toBe(0);
});

test("propagates cancellation through the transaction and query seam", async () => {
	const controller = new AbortController();
	let cleanupObserved = false;
	const adapter: PostgresQueryAdapter = {
		transaction: async (options, use) => {
			try {
				return await use({
					query: async (_sql, _parameters, queryOptions) => {
						expect(queryOptions.signal).toBe(controller.signal);
						expect(options.signal).toBe(controller.signal);
						controller.abort(new Error("stop"));
						return rows();
					},
				});
			} finally {
				cleanupObserved = true;
			}
		},
	};

	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			adapter,
			signal: controller.signal,
		}),
	).rejects.toThrow("stop");
	expect(cleanupObserved).toBe(true);
});

test("rejects an invalid returned scalar at the execute boundary", async () => {
	const invalidRows = rows();
	invalidRows[0] = { ...invalidRows[0], qp_f0: "not-a-uuid" };
	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			adapter: {
				transaction: async (_options, use) =>
					use({ query: async () => invalidRows }),
			},
		}),
	).rejects.toMatchObject({
		blocking: "none",
		code: "QP-DATA-001",
		phase: "execute",
	});
});
