import { expect, test } from "bun:test";

import { createPostgresCollectionMutationData } from "../../packages/runtime/src/mutation";

const id = "00000000-0000-4000-8000-000000000001";
const principalId = "00000000-0000-4000-8000-000000000002";

function operation(identity: string, member: "create" | "get") {
	return {
		identity,
		kind: member === "create" ? "mutation" : "query",
		mode: member === "create" ? "writeTransaction" : "readSnapshot",
		target: "collection:records",
		member,
		policy: "policy:records.default",
		keyFields: member === "get" ? [["id"]] : [],
		callerInputFields: member === "create" ? [["title"], ["body"]] : [],
		selectedFieldPaths:
			member === "create"
				? [["id"], ["title"], ["createdAt"]]
				: [["id"], ["body"]],
		dataQuery: null,
		dataQueryDigest: null,
		normalizerProgramDigest: null,
		serverValueProgramDigest: null,
		outputCardinality: member === "create" ? "one" : "optionalOne",
		limits:
			member === "create"
				? {
						inputBytes: 65_536,
						resultBytes: 1_048_576,
						rowsWritten: 100,
						durationMilliseconds: 5_000,
					}
				: {
						inputBytes: 65_536,
						resultBytes: 1_048_576,
						rowsRead: 10_000,
						durationMilliseconds: 5_000,
					},
		normalizerProgram: null,
		serverValueProgram: null,
	} as const;
}

function createPlan() {
	return {
		...operation("mutation:records.create", "create"),
		operation: operation("mutation:records.create", "create"),
		candidate: {
			steps: [],
			fields: [
				{
					path: ["title"],
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 120,
						collation: "questpie.binary",
					},
					nullable: false,
				},
				{
					path: ["body"],
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 8_192,
						collation: "questpie.binary",
					},
					nullable: false,
				},
			],
		},
		fieldAuthority: {
			suppliedPathsOnly: true,
			checks: [
				{
					path: ["title"],
					sql: "TITLE_AUTHORITY_SQL",
					parameters: [
						{
							position: 1,
							kind: "callerInput",
							path: ["title"],
							codec: {
								kind: "text",
								minLength: 1,
								maxLength: 120,
								collation: "questpie.binary",
							},
							postgresType: "text",
						},
					],
				},
				{
					path: ["body"],
					sql: "BODY_AUTHORITY_SQL",
					parameters: [],
				},
			],
		},
		write: {
			sql: "WRITE_WITH_btrim_gen_random_uuid_SQL",
			parameters: [
				{
					position: 1,
					kind: "callerInput",
					path: ["title"],
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 120,
						collation: "questpie.binary",
					},
					postgresType: "text",
				},
				{
					position: 2,
					kind: "callerInput",
					path: ["body"],
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 8_192,
						collation: "questpie.binary",
					},
					postgresType: "text",
				},
				{
					position: 3,
					kind: "executionFact",
					source: "operationTime",
					path: [],
					codec: "timestamp",
					postgresType: "timestamptz",
				},
			],
			result: [
				{
					path: ["id"],
					column: "qp_result_0",
					codec: { kind: "uuid" },
					nullable: false,
				},
				{
					path: ["title"],
					column: "qp_result_1",
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 120,
						collation: "questpie.binary",
					},
					nullable: false,
				},
				{
					path: ["createdAt"],
					column: "qp_result_2",
					codec: { kind: "timestamp", withTimezone: true },
					nullable: false,
				},
			],
		},
		limits: { rows: 100, durationMilliseconds: 5_000 },
	} as const;
}

function getPlan() {
	return {
		...operation("query:records.get", "get"),
		operation: operation("query:records.get", "get"),
		consistency: {
			standalone: "readSnapshot",
			nestedMutation: "keyedLockThenFreshPolicyRead",
		},
		lifecycle: [
			"keyedRowLock",
			"freshPolicyRead",
			"selection",
			"outputFieldAuthority",
		],
		lock: {
			sql: "LOCK_SQL",
			parameters: [
				{
					position: 1,
					kind: "key",
					path: ["id"],
					codec: { kind: "uuid" },
					postgresType: "uuid",
				},
			],
			outcome: "internalLockedOrAbsent",
		},
		read: {
			freshAfterRowLockWait: true,
			sql: "FRESH_POLICY_READ_SQL",
			parameters: [
				{
					position: 1,
					kind: "key",
					path: ["id"],
					codec: { kind: "uuid" },
					postgresType: "uuid",
				},
				{
					position: 2,
					kind: "executionFact",
					source: "principal",
					path: ["id"],
					codec: "uuid",
					postgresType: "uuid",
				},
				{
					position: 3,
					kind: "literal",
					value: "classified",
					codec: "text",
					postgresType: "text",
				},
			],
			result: [
				{
					path: ["id"],
					column: "qp_result_0",
					codec: { kind: "uuid" },
					nullable: false,
				},
				{
					path: ["body"],
					column: "qp_result_1",
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 8_192,
						collation: "questpie.binary",
					},
					nullable: false,
					guardColumn: "qp_result_1_allowed",
				},
			],
		},
		outputAuthority: {
			freshAfterRowLockWait: true,
			selectedPaths: [
				{ path: ["id"], conditional: false, mutableEvidenceCollections: [] },
				{
					path: ["body"],
					conditional: true,
					guardColumn: "qp_result_1_allowed",
					mutableEvidenceCollections: ["collection:permits"],
				},
			],
		},
		limits: { rows: 1, durationMilliseconds: 5_000 },
	} as const;
}

function dataFor(
	plans: readonly Readonly<Record<string, unknown>>[],
	query: (
		statement: string,
		parameters?: readonly unknown[],
	) => Promise<readonly Readonly<Record<string, unknown>>[]>,
	consumeRows: (count: number) => void = () => {},
) {
	return createPostgresCollectionMutationData({
		plans: {
			plans,
			byIdentity: new Map(
				plans.map((plan) => [String(plan.identity), plan] as const),
			),
		} as never,
		query,
		facts: {
			principal: { kind: "user", id: principalId },
			authority: { kind: "ordinary" },
			tenant: { id: "tenant-1" },
		},
		operationTime: new Date("2026-08-16T20:00:00.000Z"),
		consumeRows,
	});
}

test("nested get locks first, rechecks fresh Policy, and omits a guarded Field", async () => {
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const data = dataFor([getPlan()], async (statement, parameters = []) => {
		calls.push([statement, parameters]);
		if (statement === "LOCK_SQL") return [{ qp_locked: true }];
		return [
			{
				qp_result_0: id,
				qp_result_1: null,
				qp_result_1_allowed: false,
			},
		];
	});

	const result = await data.records.get({
		key: { id },
	});

	expect(result).toEqual({ id });
	expect(Object.hasOwn(result!, "body")).toBe(false);
	expect(calls).toEqual([
		["LOCK_SQL", [id]],
		["FRESH_POLICY_READ_SQL", [id, principalId, "classified"]],
	]);
});

test("create checks sparse Field authority and leaves normalization/defaults to compiler SQL", async () => {
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const createdAt = new Date("2026-08-16T20:00:00.000Z");
	const data = dataFor([createPlan()], async (statement, parameters = []) => {
		calls.push([statement, parameters]);
		if (statement.endsWith("AUTHORITY_SQL")) return [{ allowed: true }];
		return [
			{
				qp_result_0: id,
				qp_result_1: "A title",
				qp_result_2: createdAt,
			},
		];
	});

	const result = await data.records.create({
		input: { title: "  A title  ", body: "Body" },
	});

	expect(result).toEqual({ id, title: "A title", createdAt });
	expect(calls).toEqual([
		["TITLE_AUTHORITY_SQL", ["  A title  "]],
		["BODY_AUTHORITY_SQL", []],
		[
			"WRITE_WITH_btrim_gen_random_uuid_SQL",
			["  A title  ", "Body", new Date("2026-08-16T20:00:00.000Z")],
		],
	]);
});

test("missing and Policy-invisible keyed rows have the same nested get result", async () => {
	const outcomes = await Promise.all(
		[false, true].map(async (locked) => {
			const calls: string[] = [];
			const data = dataFor([getPlan()], async (statement) => {
				calls.push(statement);
				return statement === "LOCK_SQL" && locked ? [{ qp_locked: true }] : [];
			});
			return {
				result: await data.records.get({
					key: { id },
				}),
				calls,
			};
		}),
	);

	expect(outcomes).toEqual([
		{ result: null, calls: ["LOCK_SQL", "FRESH_POLICY_READ_SQL"] },
		{ result: null, calls: ["LOCK_SQL", "FRESH_POLICY_READ_SQL"] },
	]);
});

test("rejects an invalid PostgreSQL scalar before returning Collection data", async () => {
	const data = dataFor([getPlan()], async (statement) =>
		statement === "LOCK_SQL"
			? [{ qp_locked: true }]
			: [
					{
						qp_result_0: "not-a-uuid",
						qp_result_1: "visible",
						qp_result_1_allowed: true,
					},
				],
	);

	await expect(
		data.records.get({
			key: { id },
		}),
	).rejects.toThrow("invalid relational scalar");
});

test("charges decoded rows to the transaction budget before returning", async () => {
	let used = 0;
	const data = dataFor(
		[getPlan()],
		async (statement) =>
			statement === "LOCK_SQL"
				? [{ qp_locked: true }]
				: [
						{
							qp_result_0: id,
							qp_result_1: "visible",
							qp_result_1_allowed: true,
						},
					],
		(count) => {
			used += count;
			throw new TypeError("transaction row budget exceeded");
		},
	);

	await expect(
		data.records.get({
			key: { id },
		}),
	).rejects.toThrow("transaction row budget exceeded");
	expect(used).toBe(1);
});

test("rejects widened requests, unknown caller Fields, and invalid caller scalars before SQL", async () => {
	let calls = 0;
	const data = dataFor([createPlan()], async () => {
		calls += 1;
		return [];
	});

	await expect(
		data.records.create({
			input: { title: "Title", body: "Body" },
			select: { id: true },
		}),
	).rejects.toThrow("exactly the compiled keys");
	await expect(
		data.records.create({
			input: { title: "Title", body: "Body", ownerId: principalId },
		}),
	).rejects.toThrow("exactly the compiled Fields");
	await expect(
		data.records.create({
			input: { title: "Title", body: "Body", smuggled: {} },
		}),
	).rejects.toThrow("exactly the compiled Fields");
	await expect(
		data.records.create({
			input: { title: "Title", body: "Body", smuggled: new Map() },
		}),
	).rejects.toThrow("exactly the compiled Fields");
	await expect(
		data.records.create({ input: { title: "", body: "Body" } }),
	).rejects.toThrow("invalid relational scalar");
	expect(calls).toBe(0);
});
