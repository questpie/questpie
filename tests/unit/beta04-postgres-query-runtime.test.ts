import { expect, test } from "bun:test";

import type { SQL } from "bun";

import {
	DataQueryExecutionError,
	executePostgresQuery,
	type PostgresQueryPlanV1,
} from "../../packages/runtime/src";
import {
	createLiveQueryObservation,
	type LinkedQueryWatchabilityV1,
	type LinkedStructuralQueryObservationSlotV1,
} from "../../packages/runtime/src/live-query";
import type { PostgresTransactionRunner } from "../../packages/runtime/src/postgres";
import { linkPostgresQueryPlan } from "../../packages/runtime/src/relational";

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
	principal: {
		id: "00000000-0000-0000-0000-000000000010",
		kind: "user" as const,
	},
	tenant: { id: "00000000-0000-0000-0000-000000000020" },
};

const databasePlan = {
	...plan,
	sql: `SELECT
	NULL::uuid AS "qp_f0",
	NULL::text AS "qp_f1",
	TRUE AS "qp_g1",
	NULL::timestamptz AS "qp_f2",
	TRUE AS "qp_r3_present",
	NULL::text AS "qp_r3_f0"
WHERE $1::uuid IS NOT NULL
	AND $2::text IS NOT NULL
	AND cardinality($3::text[]) >= 0
	AND NOT $4::boolean
	AND $5::timestamptz IS NULL
	AND $6::uuid IS NULL
	AND $7::integer > 0;\n`,
} as const satisfies PostgresQueryPlanV1;

function watchability(
	options?: Readonly<{
		policyEvidence?: boolean;
		unreachedBranch?: boolean;
	}>,
): LinkedQueryWatchabilityV1 {
	const policyEvidence = options?.policyEvidence === true;
	const main: LinkedStructuralQueryObservationSlotV1 = {
		kind: "structuralQuery",
		templateDigest,
		policy: plan.policy,
		policyProgramDigest,
		collections: [
			...(policyEvidence ? ["collection:memberships"] : []),
			"collection:messages",
			"collection:users",
		],
		relations: ["collection:messages/relation:author"],
		tokens: [
			"collectionRange",
			"orderingBoundary",
			"pageSentinel",
			...(policyEvidence ? (["policyEvidencePoint"] as const) : []),
			"relationEndpoint",
			"relationMiss",
			"tenantPartition",
		],
	};
	const structuralQueries = new Map([[templateDigest, main]]);
	if (options?.unreachedBranch)
		structuralQueries.set("c".repeat(64), {
			kind: "structuralQuery",
			templateDigest: "c".repeat(64),
			policy: "policy:audit",
			policyProgramDigest: "f".repeat(64),
			collections: ["collection:auditEvents"],
			relations: [],
			tokens: ["collectionRange"],
		});
	return {
		identity: "query:messages.page",
		watchable: true,
		inputCodec: {},
		outputCodec: {},
		contractDigest: "d".repeat(64),
		context: {
			kind: "context",
			identity: "context:request",
			projectionDigest: "e".repeat(64),
			tokens: ["contextBootstrapPoint", "tenantPartition"],
		},
		structuralQueries,
		maximumTokensPerPlan: 256,
		unsupportedReason: null,
	};
}

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

function fakeSql(
	query: (
		statement: string,
		parameters: readonly unknown[],
	) =>
		| readonly Readonly<Record<string, unknown>>[]
		| Promise<readonly Readonly<Record<string, unknown>>[]>,
	onReserve?: () => void,
): SQL {
	const pending = (
		promise: Promise<readonly Readonly<Record<string, unknown>>[]>,
	) => {
		const value = {
			cancel: () => value,
			execute: () => value,
			// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
			then: promise.then.bind(promise),
		};
		return value;
	};
	return {
		async reserve() {
			onReserve?.();
			return {
				close: async () => {},
				release: () => {},
				unsafe(statement: string, parameters: readonly unknown[] = []) {
					if (
						statement === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
						statement === "COMMIT" ||
						statement === "ROLLBACK"
					)
						return pending(Promise.resolve([]));
					return pending(Promise.resolve(query(statement, parameters)));
				},
			};
		},
	} as unknown as SQL;
}

function fakeDatabase(
	input: Readonly<{
		rows: readonly (readonly unknown[])[];
		onTransaction?(): void;
		onMode?(mode: unknown): void;
		onStatement?(
			statement: Readonly<{
				name: string;
				text: string;
				parameterCount: number;
				parameters: readonly unknown[];
			}>,
		): void;
	}>,
): PostgresTransactionRunner {
	return {
		async transaction<Output>(transactionInput: {
			mode: unknown;
			use(transaction: unknown): Promise<Output>;
		}): Promise<Output> {
			input.onTransaction?.();
			input.onMode?.(transactionInput.mode);
			return transactionInput.use({
				execute: async (
					statement: {
						name: string;
						text: string;
						parameterCount: number;
						parameters(value: unknown): readonly unknown[];
						decode(result: unknown): unknown;
					},
					parameters: unknown,
				) => {
					const encoded = statement.parameters(parameters);
					input.onStatement?.({
						name: statement.name,
						text: statement.text,
						parameterCount: statement.parameterCount,
						parameters: encoded,
					});
					return statement.decode({
						command: "SELECT",
						rowCount: input.rows.length,
						rows: input.rows,
					});
				},
			});
		},
	} as PostgresTransactionRunner;
}

test("links one static Query statement and executes it through the PostgreSQL transaction seam", async () => {
	const linkedPlan = linkPostgresQueryPlan(databasePlan);
	const modes: unknown[] = [];
	const statements: unknown[] = [];
	let transactions = 0;
	const database = fakeDatabase({
		rows: rows().map((row) => [
			row.qp_f0,
			row.qp_f1,
			row.qp_g1,
			row.qp_f2,
			row.qp_r3_present,
			row.qp_r3_f0,
		]),
		onTransaction: () => {
			transactions += 1;
		},
		onMode: (mode) => modes.push(mode),
		onStatement: (statement) => statements.push(statement),
	});

	const page = await executePostgresQuery({
		linkedPlan,
		binding,
		executionFacts,
		database,
	});

	expect(transactions).toBe(1);
	expect(modes).toEqual([{ isolation: "repeatableRead", access: "readOnly" }]);
	expect(statements).toEqual([
		{
			name: "query." + templateDigest,
			text: databasePlan.sql,
			parameterCount: 7,
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
});

test("rejects a Query statement cast mismatch before opening PostgreSQL", async () => {
	let transactions = 0;
	const database = fakeDatabase({
		rows: [],
		onTransaction: () => {
			transactions += 1;
		},
	});
	const tampered = {
		...databasePlan,
		sql: databasePlan.sql.replace("$3::text[]", "$3::text"),
	};

	await expect(
		(async () => {
			const linkedPlan = linkPostgresQueryPlan(tampered);
			return executePostgresQuery({
				linkedPlan,
				binding,
				executionFacts,
				database,
			});
		})(),
	).rejects.toThrow("Query SQL placeholders do not match its parameters");
	expect(transactions).toBe(0);
});

test("rejects Query result aliases projected in a different physical order", () => {
	const tampered = {
		...databasePlan,
		sql: databasePlan.sql
			.replace('AS "qp_f0"', 'AS "qp_swap"')
			.replace('AS "qp_f1"', 'AS "qp_f0"')
			.replace('AS "qp_swap"', 'AS "qp_f1"'),
	};

	expect(() => linkPostgresQueryPlan(tampered)).toThrow(
		"Query SQL result projection does not match its result columns",
	);
});

test("rejects malformed PostgreSQL array-row results at the static statement", () => {
	const { statement } = linkPostgresQueryPlan(databasePlan);
	const valid = {
		command: "SELECT",
		rowCount: 1,
		rows: [[id1, "visible", true, createdAt1, true, "Ada"]],
	} as const;

	expect(statement.decode(valid)).toEqual([
		{
			qp_f0: id1,
			qp_f1: "visible",
			qp_g1: true,
			qp_f2: createdAt1,
			qp_r3_present: true,
			qp_r3_f0: "Ada",
		},
	]);
	expect(() => statement.decode({ ...valid, command: "UPDATE" })).toThrow(
		"Query statement result cardinality is invalid",
	);
	expect(() => statement.decode({ ...valid, rowCount: 2 })).toThrow(
		"Query statement result cardinality is invalid",
	);
	expect(() =>
		statement.decode({ ...valid, rows: [[id1, "visible"]] }),
	).toThrow("Query statement result width is invalid");
});

test("binds one exact authorized page and decodes structural disclosure", async () => {
	const calls: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
	const sql = fakeSql((statement, parameters) => {
		calls.push({ sql: statement, parameters });
		return rows();
	});

	const page = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		sql,
		maximumPageSize: 50,
	});

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

test("observes only the successful relational page branch and its decoded Relation miss", async () => {
	const observation = createLiveQueryObservation(
		watchability({ policyEvidence: true, unreachedBranch: true }),
	);
	observation.recordContext("context:request", [
		{
			kind: "contextBootstrapPoint",
			collection: "collection:memberships",
			detail: { principalId: executionFacts.principal.id },
		},
	]);

	const page = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		sql: fakeSql(() => rows()),
		observer: observation,
	});
	const observed = observation.finish();

	expect(page.nodes[1]?.author).toBeNull();
	expect(
		observed.tokens.map(({ kind, collection }) => [kind, collection]),
	).toEqual([
		["policyEvidencePoint", "collection:memberships"],
		["contextBootstrapPoint", "collection:memberships"],
		["orderingBoundary", "collection:messages"],
		["pageSentinel", "collection:messages"],
		["tenantPartition", "collection:messages"],
		["collectionRange", "collection:messages"],
		["relationEndpoint", "collection:users"],
		["relationMiss", "collection:users"],
	]);
	expect(observed.tokens).not.toContainEqual(
		expect.objectContaining({ collection: "collection:auditEvents" }),
	);
	const detail = (kind: (typeof observed.tokens)[number]["kind"]) =>
		observed.tokens.find((token) => token.kind === kind)?.detail;
	expect(detail("collectionRange")).toEqual({
		scope: [
			{ parameter: "statuses", value: ["draft", "published"] },
			{ parameter: "tenantSlug", value: "north" },
		],
	});
	expect(detail("orderingBoundary")).toEqual({
		after: null,
		order: [
			"collection:messages/field:createdAt",
			"collection:messages/field:id",
		],
	});
	expect(detail("pageSentinel")).toEqual({
		first: 2,
		hasNextPage: true,
		observed: 2,
	});
	expect(detail("tenantPartition")).toEqual({ id: executionFacts.tenant.id });
	expect(detail("policyEvidencePoint")).toEqual({
		conservative: true,
		policy: plan.policy,
	});
	expect(detail("relationEndpoint")).toEqual({
		conservative: true,
		observed: 1,
		relation: "collection:messages/relation:author",
	});
	expect(detail("relationMiss")).toEqual({
		conservative: true,
		observed: 1,
		relation: "collection:messages/relation:author",
	});
});

test("does not observe failed SQL or invalid relational output", async () => {
	const query = watchability();
	const failedSql = createLiveQueryObservation(query);
	failedSql.recordContext("context:request", []);
	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			sql: fakeSql(() => Promise.reject(new Error("database unavailable"))),
			observer: failedSql,
		}),
	).rejects.toThrow("database unavailable");
	expect(() => failedSql.finish()).toThrow(
		"missing an executed observation slot",
	);

	const failedOutput = createLiveQueryObservation(query);
	failedOutput.recordContext("context:request", []);
	const invalidRows = rows();
	invalidRows[0] = { ...invalidRows[0], qp_f0: "not-a-uuid" };
	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			sql: fakeSql(() => invalidRows),
			observer: failedOutput,
		}),
	).rejects.toMatchObject({ code: "QP-DATA-001", phase: "execute" });
	expect(() => failedOutput.finish()).toThrow(
		"missing an executed observation slot",
	);
});

test("normalizes PostgreSQL timestamp Dates before result and cursor validation", async () => {
	const dateRows = rows().map((row) => ({
		...row,
		qp_f2: new Date(String(row.qp_f2)),
	}));
	const page = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		sql: fakeSql(() => dateRows),
	});

	expect(page.nodes[0]?.createdAt).toBe(createdAt1);
	const cursor = JSON.parse(
		Buffer.from(page.pageInfo.endCursor!, "base64url").toString(),
	);
	expect(cursor.order[0].value).toBe(createdAt2);
});

test("rejects exact binding failures before opening a transaction", async () => {
	let transactions = 0;
	const sql = fakeSql(
		() => [],
		() => {
			transactions += 1;
		},
	);
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
				sql,
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
			sql,
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
		sql: fakeSql(() => rows().slice(0, 1)),
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
			sql: fakeSql(
				() => [],
				() => {
					transactions += 1;
				},
			),
		}),
	).rejects.toMatchObject({ code: "QP-DATA-013", phase: "bind" });
	expect(transactions).toBe(0);
});

test("rejects a tampered cursor before reserving PostgreSQL", async () => {
	const firstPage = await executePostgresQuery({
		plan,
		binding,
		executionFacts,
		sql: fakeSql(() => rows().slice(0, 1)),
	});
	let reservations = 0;
	await expect(
		executePostgresQuery({
			plan,
			binding: {
				...binding,
				values: binding.values.map((item) =>
					item.parameter === "after"
						? { ...item, value: `${firstPage.pageInfo.endCursor}=` }
						: item,
				),
			},
			executionFacts,
			sql: fakeSql(
				() => [],
				() => {
					reservations += 1;
				},
			),
		}),
	).rejects.toMatchObject({ code: "QP-DATA-010", phase: "bind" });
	expect(reservations).toBe(0);
});

test("propagates cancellation through the transaction and query seam", async () => {
	const controller = new AbortController();
	let cleanupObserved = false;
	const sql = fakeSql(() => {
		controller.abort(new Error("stop"));
		cleanupObserved = true;
		return rows();
	});

	await expect(
		executePostgresQuery({
			plan,
			binding,
			executionFacts,
			sql,
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
			sql: fakeSql(() => invalidRows),
		}),
	).rejects.toMatchObject({
		blocking: "none",
		code: "QP-DATA-001",
		phase: "execute",
	});
});
