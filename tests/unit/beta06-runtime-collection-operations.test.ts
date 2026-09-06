import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
	createCollectionOperationAdapterExecutor,
	isCollectionLifecycleIssue,
	linkCollectionMutationPrograms,
	linkCollectionOperationAdapters,
} from "../../packages/runtime/src/mutation";
import { canonicalMutationBytes } from "../../packages/runtime/src/mutation/canonical";
import { createCollectionMutationData } from "../../packages/runtime/src/mutation/collection";
import {
	createCollectionExecutionBudget,
	type CollectionExecutionBudget,
} from "../../packages/runtime/src/mutation/collection-budget";
import { createCollectionLifecycleDoom } from "../../packages/runtime/src/mutation/lifecycle";
import {
	bindPostgresCollectionStatement,
	decodePostgresCollectionParameters,
} from "../../packages/runtime/src/mutation/postgres-collection-statement";

const id = "00000000-0000-4000-8000-000000000001";
const principalId = "00000000-0000-4000-8000-000000000002";

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

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
		requiredCallerInputFields: member === "create" ? [["title"]] : [],
		trustedValueFields:
			member === "create" ? [["body"], ["id"], ["title"]] : [],
		requiredTrustedValueFields: [],
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
					requiredInput: true,
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
					requiredInput: false,
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
					kind: "callerInputPresent",
					path: ["body"],
					codec: "boolean",
					postgresType: "boolean",
				},
				{
					position: 3,
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
					position: 4,
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

function trustedCreatePlan() {
	const baseline = createPlan();
	return {
		...baseline,
		operation: {
			...baseline.operation,
			callerInputFields: [["title"]],
			trustedValueFields: [["title"], ["body"]],
			requiredTrustedValueFields: [["body"]],
		},
		fieldAuthority: {
			...baseline.fieldAuthority,
			checks: [baseline.fieldAuthority.checks[0]!],
		},
		candidate: {
			...baseline.candidate,
			fields: baseline.candidate.fields.map((field) => ({
				...field,
				requiredInput: true,
			})),
		},
		write: {
			...baseline.write,
			parameters: [
				baseline.write.parameters[0]!,
				{
					position: 2,
					kind: "trustedValue",
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
					...baseline.write.parameters[3]!,
					position: 3,
				},
			],
		},
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
	issueMappings?: Readonly<Record<string, Readonly<Record<string, string>>>>,
	executionBudget?: CollectionExecutionBudget,
	lifecycleDoom?: ReturnType<typeof createCollectionLifecycleDoom>,
	executeList?: (
		identity: string,
		request: unknown,
	) => Promise<
		Readonly<{
			nodes: readonly Readonly<Record<string, unknown>>[];
			observed: number;
		}>
	>,
) {
	return createCollectionMutationData({
		plans: {
			plans,
			byIdentity: new Map(
				plans.map((plan) => [String(plan.identity), plan] as const),
			),
		} as never,
		query,
		resultValuesDecoded: false,
		executeLeaf: (leaf, parameters) => query(leaf.sql, parameters),
		facts: {
			principal: { kind: "user", id: principalId },
			authority: { kind: "ordinary" },
			tenant: { id: "tenant-1" },
		},
		operationTime: new Date("2026-08-16T20:00:00.000Z"),
		callId: "call-1",
		consumeRows,
		issueMappings,
		executionBudget,
		lifecycleDoom,
		executeList: executeList
			? async (identity, request) => ({
					...(await executeList(identity, request)),
					pageInfo: { endCursor: null, hasNextPage: false },
				})
			: undefined,
	});
}

test("Collection work shares a terminal outer statement budget", async () => {
	const calls: string[] = [];
	const doom = createCollectionLifecycleDoom();
	const budget = createCollectionExecutionBudget({
		doom,
		maxStatements: 2,
		maxDependencies: 20,
		maxRows: 100,
		maxDurationMilliseconds: 5_000,
	});
	const data = dataFor(
		[getPlan()],
		async (sql) => {
			calls.push(sql);
			return sql === "LOCK_SQL"
				? [{}]
				: [
						{
							qp_result_0: id,
							qp_result_1: "visible",
							qp_result_1_allowed: true,
						},
					];
		},
		undefined,
		undefined,
		budget,
		doom,
	);
	await expect(data.records.get({ key: { id } })).resolves.toEqual({
		id,
		body: "visible",
	});
	await expect(data.records.get({ key: { id } })).rejects.toThrow(
		"statement budget exceeded",
	);
	await expect(data.records.get({ key: { id } })).rejects.toThrow(
		"statement budget exceeded",
	);
	expect(calls).toEqual(["LOCK_SQL", "FRESH_POLICY_READ_SQL"]);
});

function oneGetCheckLifecycle(operationIdentity: string) {
	return {
		format: "questpie.lifecycle-program.v1",
		interpreter: "questpie.lifecycle-interpreter.v1",
		runtimeBuild: "b".repeat(64),
		reentryLimit: 8,
		bindings: {
			schema: "schema:test",
			collection: "collection:records",
			fields: {
				id: "collection:records/field:id",
				body: "collection:records/field:body",
			},
			issues: { invalidCurrent: "issue:records/invalidCurrent" },
			capabilities: {
				getRecord: {
					kind: "read",
					identity: "query:records.get",
					argumentKeys: ["key.id", "select.body", "select.id"],
					cardinality: "one",
					first: true,
					maxRows: 1,
				},
			},
			operations: [operationIdentity, "query:records.get"],
			jobs: [],
		},
		phases: {
			normalize: [],
			validate: [
				{
					op: "if",
					test: {
						op: "binary",
						operator: "!==",
						left: {
							op: "member",
							target: { op: "root", root: "current" },
							field: "collection:records/field:body",
							optional: false,
						},
						right: { op: "literal", value: "before" },
					},
					consequent: [
						{
							op: "throwIssue",
							issue: "issue:records/invalidCurrent",
						},
					],
					otherwise: [],
				},
			],
			check: [
				{
					op: "const",
					slot: 0,
					value: {
						op: "capability",
						capability: "read",
						identity: "query:records.get",
						arguments: [
							{
								op: "object",
								entries: [
									{
										kind: "argument",
										key: "key",
										value: {
											op: "object",
											entries: [
												{
													kind: "argument",
													key: "id",
													value: { op: "literal", value: id },
												},
											],
										},
									},
									{
										kind: "argument",
										key: "select",
										value: {
											op: "object",
											entries: [
												{
													kind: "argument",
													key: "id",
													value: { op: "literal", value: true },
												},
												{
													kind: "argument",
													key: "body",
													value: { op: "literal", value: true },
												},
											],
										},
									},
								],
							},
						],
					},
				},
			],
			afterWrite: [],
		},
		digest: "c".repeat(64),
	} as const;
}

test("Collection create enforces candidate Policy before one bound lifecycle check read", async () => {
	const baseline = createPlan();
	const lifecycleProgram = {
		format: "questpie.lifecycle-program.v1",
		interpreter: "questpie.lifecycle-interpreter.v1",
		runtimeBuild: "b".repeat(64),
		reentryLimit: 8,
		bindings: {
			schema: "schema:test",
			collection: "collection:records",
			fields: {
				title: "collection:records/field:title",
				body: "collection:records/field:body",
			},
			issues: { blocked: "issue:records/blocked" },
			capabilities: {
				getRecord: {
					kind: "read",
					identity: "query:records.get",
					argumentKeys: ["key.id", "select.body", "select.id"],
					cardinality: "one",
					first: true,
					maxRows: 1,
				},
			},
			operations: ["mutation:records.create", "query:records.get"],
			jobs: [],
		},
		phases: {
			normalize: [
				{
					op: "return",
					value: {
						op: "object",
						entries: [
							{ kind: "spreadInput" },
							{
								kind: "field",
								field: "collection:records/field:title",
								value: {
									op: "stringMethod",
									method: "trim",
									target: {
										op: "member",
										target: { op: "root", root: "input" },
										field: "collection:records/field:title",
										optional: false,
									},
									arguments: [],
									optional: false,
								},
							},
						],
					},
				},
			],
			validate: [
				{
					op: "if",
					test: {
						op: "stringMethod",
						method: "startsWith",
						target: {
							op: "member",
							target: { op: "root", root: "candidate" },
							field: "collection:records/field:title",
							optional: false,
						},
						arguments: [{ op: "literal", value: "BLOCKED" }],
						optional: false,
					},
					consequent: [{ op: "throwIssue", issue: "issue:records/blocked" }],
					otherwise: [],
				},
			],
			check: [
				{
					op: "const",
					slot: 0,
					value: {
						op: "capability",
						capability: "read",
						identity: "query:records.get",
						arguments: [
							{
								op: "object",
								entries: [
									{
										kind: "argument",
										key: "key",
										value: {
											op: "object",
											entries: [
												{
													kind: "argument",
													key: "id",
													value: { op: "literal", value: id },
												},
											],
										},
									},
									{
										kind: "argument",
										key: "select",
										value: {
											op: "object",
											entries: [
												{
													kind: "argument",
													key: "id",
													value: { op: "literal", value: true },
												},
												{
													kind: "argument",
													key: "body",
													value: { op: "literal", value: true },
												},
											],
										},
									},
								],
							},
						],
					},
				},
			],
			afterWrite: [],
		},
		digest: "c".repeat(64),
	} as const;
	const plan = {
		...baseline,
		operation: { ...baseline.operation, lifecycleProgram },
		candidateValidation: {
			freshAfterRowLockWait: true,
			sql: "MATERIALIZE_CANDIDATE_SQL",
			parameters: baseline.write.parameters.slice(0, 3),
			result: [
				{
					path: ["title"],
					column: "qp_candidate_0",
					codec: baseline.candidate.fields[0]!.codec,
					nullable: false,
				},
				{
					path: ["body"],
					column: "qp_candidate_1",
					codec: baseline.candidate.fields[1]!.codec,
					nullable: false,
				},
			],
		},
		candidatePolicyCheck: {
			freshAfterRowLockWait: true,
			sql: "CANDIDATE_POLICY_SQL",
			parameters: [
				{
					position: 1,
					kind: "candidateValue",
					path: ["title"],
					codec: baseline.candidate.fields[0]!.codec,
					postgresType: "text",
				},
			],
			outcome: "authorizedOrUnavailable",
		},
		write: {
			...baseline.write,
			parameters: [
				{
					position: 1,
					kind: "candidateValue",
					path: ["title"],
					codec: baseline.candidate.fields[0]!.codec,
					postgresType: "text",
				},
				{
					position: 2,
					kind: "candidateValue",
					path: ["body"],
					codec: baseline.candidate.fields[1]!.codec,
					postgresType: "text",
				},
			],
		},
	} as const;
	const calls: string[] = [];
	const issueMappings = {
		"collection:records": { "issue:records/blocked": "invalidRecord" },
	};
	const data = dataFor(
		[plan, getPlan()],
		async (statement, parameters = []) => {
			calls.push(statement);
			if (statement === "TITLE_AUTHORITY_SQL") {
				expect(parameters[0]).toBe("  allowed  ");
				return [{ allowed: true }];
			}
			if (statement === "MATERIALIZE_CANDIDATE_SQL")
				return [
					{
						qp_candidate_0: parameters[0],
						qp_candidate_1: "default body",
					},
				];
			if (statement === "CANDIDATE_POLICY_SQL") {
				expect(parameters).toEqual(["allowed"]);
				return [{}];
			}
			if (statement === "LOCK_SQL") return [{}];
			if (statement === "FRESH_POLICY_READ_SQL")
				return [
					{
						qp_result_0: id,
						qp_result_1: null,
						qp_result_1_allowed: false,
					},
				];
			expect(parameters).toEqual(["allowed", "default body"]);
			return [
				{
					qp_result_0: id,
					qp_result_1: parameters[0],
					qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
				},
			];
		},
		undefined,
		issueMappings,
	);
	const created = await data.records.create({
		input: { title: "  allowed  " },
	});
	expect(created).toEqual(expect.objectContaining({ title: "allowed" }));
	expect(calls).toEqual([
		"TITLE_AUTHORITY_SQL",
		"MATERIALIZE_CANDIDATE_SQL",
		"CANDIDATE_POLICY_SQL",
		"LOCK_SQL",
		"FRESH_POLICY_READ_SQL",
		"WRITE_WITH_btrim_gen_random_uuid_SQL",
	]);

	const deniedCalls: string[] = [];
	const denied = dataFor(
		[plan, getPlan()],
		async (statement) => {
			deniedCalls.push(statement);
			if (statement === "TITLE_AUTHORITY_SQL") return [{}];
			if (statement === "MATERIALIZE_CANDIDATE_SQL")
				return [{ qp_candidate_0: "allowed", qp_candidate_1: "default body" }];
			if (statement === "CANDIDATE_POLICY_SQL") return [];
			throw new Error("check read or write ran after candidate Policy denial");
		},
		undefined,
		issueMappings,
	);
	await expect(
		denied.records.create({ input: { title: "allowed" } }),
	).rejects.toThrow("Collection operation is unavailable");
	expect(deniedCalls).toEqual([
		"TITLE_AUTHORITY_SQL",
		"MATERIALIZE_CANDIDATE_SQL",
		"CANDIDATE_POLICY_SQL",
	]);

	const rejected = dataFor(
		[plan],
		async (statement) => {
			if (statement === "TITLE_AUTHORITY_SQL") return [{ allowed: true }];
			if (statement === "MATERIALIZE_CANDIDATE_SQL")
				return [
					{ qp_candidate_0: "BLOCKED ticket", qp_candidate_1: "default body" },
				];
			throw new Error("write must not execute after validate");
		},
		undefined,
		issueMappings,
	);
	let caught: unknown;
	try {
		await rejected.records.create({ input: { title: "BLOCKED ticket" } });
	} catch (error) {
		caught = error;
	}
	expect(isCollectionLifecycleIssue(caught)).toBe(true);
	const withheld = dataFor([plan], async () => {
		throw new Error("withheld lifecycle capability reached SQL");
	});
	expect(withheld.records.create).toBeUndefined();
});

test("afterWrite re-enters the same Collection kernel before the root returns", async () => {
	const baseline = createPlan();
	const lifecycleProgram = {
		format: "questpie.lifecycle-program.v1",
		interpreter: "questpie.lifecycle-interpreter.v1",
		runtimeBuild: "b".repeat(64),
		reentryLimit: 8,
		bindings: {
			schema: "schema:test",
			collection: "collection:records",
			fields: { title: "collection:records/field:title" },
			issues: {},
			capabilities: {
				createRecord: {
					kind: "write",
					identity: "mutation:records.create",
					argumentKeys: ["input.title"],
				},
			},
			operations: ["mutation:records.create"],
			jobs: [],
		},
		phases: {
			normalize: [],
			validate: [],
			check: [],
			afterWrite: [
				{
					op: "if",
					test: {
						op: "binary",
						operator: "===",
						left: {
							op: "member",
							target: { op: "root", root: "written" },
							field: "collection:records/field:title",
							optional: false,
						},
						right: { op: "literal", value: "root" },
					},
					consequent: [
						{
							op: "effect",
							value: {
								op: "capability",
								capability: "write",
								identity: "mutation:records.create",
								arguments: [
									{
										op: "object",
										entries: [
											{
												kind: "argument",
												key: "input",
												value: {
													op: "object",
													entries: [
														{
															kind: "argument",
															key: "title",
															value: {
																op: "literal",
																value: "nested",
															},
														},
													],
												},
											},
										],
									},
								],
							},
						},
					],
					otherwise: [],
				},
			],
		},
		digest: "c".repeat(64),
	} as const;
	const plan = {
		...baseline,
		operation: { ...baseline.operation, lifecycleProgram },
		candidateValidation: {
			freshAfterRowLockWait: true,
			sql: "MATERIALIZE_CANDIDATE_SQL",
			parameters: baseline.write.parameters.slice(0, 3),
			result: [
				{
					path: ["title"],
					column: "qp_candidate_0",
					codec: baseline.candidate.fields[0]!.codec,
					nullable: false,
				},
				{
					path: ["body"],
					column: "qp_candidate_1",
					codec: baseline.candidate.fields[1]!.codec,
					nullable: false,
				},
			],
		},
		candidatePolicyCheck: {
			freshAfterRowLockWait: true,
			sql: "CANDIDATE_POLICY_SQL",
			parameters: [],
			outcome: "authorizedOrUnavailable",
		},
		write: {
			...baseline.write,
			parameters: [
				{
					...baseline.write.parameters[0]!,
					kind: "candidateValue",
				},
				{
					position: 2,
					kind: "candidateValue",
					path: ["body"],
					codec: baseline.candidate.fields[1]!.codec,
					postgresType: "text",
				},
			],
		},
	} as const;
	const calls: string[] = [];
	const data = dataFor([plan], async (statement, parameters = []) => {
		calls.push(statement);
		if (statement === "TITLE_AUTHORITY_SQL") return [{}];
		if (statement === "MATERIALIZE_CANDIDATE_SQL")
			return [
				{ qp_candidate_0: parameters[0], qp_candidate_1: "default body" },
			];
		if (statement === "CANDIDATE_POLICY_SQL") return [{}];
		return [
			{
				qp_result_0: id,
				qp_result_1: parameters[0],
				qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
			},
		];
	});

	await expect(
		data.records.create({ input: { title: "root" } }),
	).resolves.toEqual(expect.objectContaining({ title: "root" }));
	expect(calls).toEqual([
		"TITLE_AUTHORITY_SQL",
		"MATERIALIZE_CANDIDATE_SQL",
		"CANDIDATE_POLICY_SQL",
		"WRITE_WITH_btrim_gen_random_uuid_SQL",
		"TITLE_AUTHORITY_SQL",
		"MATERIALIZE_CANDIDATE_SQL",
		"CANDIDATE_POLICY_SQL",
		"WRITE_WITH_btrim_gen_random_uuid_SQL",
	]);

	const listLifecycle = {
		...lifecycleProgram,
		bindings: {
			...lifecycleProgram.bindings,
			capabilities: {
				listRecords: {
					kind: "read",
					identity: "query:records.list",
					argumentKeys: ["first"],
					cardinality: "many",
					first: true,
					maxRows: 2,
				},
			},
			operations: ["mutation:records.create", "query:records.list"],
		},
		phases: {
			...lifecycleProgram.phases,
			afterWrite: [
				{
					op: "const",
					slot: 0,
					value: {
						op: "capability",
						capability: "read",
						identity: "query:records.list",
						arguments: [
							{
								op: "object",
								entries: [
									{
										kind: "argument",
										key: "first",
										value: { op: "literal", value: 2 },
									},
								],
							},
						],
					},
				},
			],
		},
	} as const;
	const listPlan = {
		...plan,
		operation: { ...plan.operation, lifecycleProgram: listLifecycle },
	};
	const listCalls: unknown[] = [];
	const observedRows: number[] = [];
	const withList = dataFor(
		[listPlan],
		async (statement, parameters = []) => {
			if (statement === "TITLE_AUTHORITY_SQL") return [{}];
			if (statement === "MATERIALIZE_CANDIDATE_SQL")
				return [
					{ qp_candidate_0: parameters[0], qp_candidate_1: "default body" },
				];
			if (statement === "CANDIDATE_POLICY_SQL") return [{}];
			return [
				{
					qp_result_0: id,
					qp_result_1: parameters[0],
					qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
				},
			];
		},
		(count) => observedRows.push(count),
		undefined,
		undefined,
		undefined,
		async (identity, request) => {
			listCalls.push(identity, request);
			return { nodes: [{ id }, { id: principalId }], observed: 2 };
		},
	);
	await expect(
		withList.records.create({ input: { title: "root" } }),
	).resolves.toEqual(expect.objectContaining({ title: "root" }));
	expect(listCalls).toEqual(["query:records.list", { first: 2 }]);
	expect(observedRows).toEqual([1, 2]);

	const recursionDoom = createCollectionLifecycleDoom();
	const recursiveLifecycle = {
		...lifecycleProgram,
		reentryLimit: 2,
		phases: {
			...lifecycleProgram.phases,
			afterWrite: [lifecycleProgram.phases.afterWrite[0]!.consequent[0]!],
		},
	};
	const recursivePlan = {
		...plan,
		operation: { ...plan.operation, lifecycleProgram: recursiveLifecycle },
	};
	const recursive = dataFor(
		[recursivePlan],
		async (statement, parameters = []) => {
			if (statement === "TITLE_AUTHORITY_SQL") return [{}];
			if (statement === "MATERIALIZE_CANDIDATE_SQL")
				return [
					{ qp_candidate_0: parameters[0], qp_candidate_1: "default body" },
				];
			if (statement === "CANDIDATE_POLICY_SQL") return [{}];
			return [
				{
					qp_result_0: id,
					qp_result_1: parameters[0],
					qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
				},
			];
		},
		undefined,
		undefined,
		undefined,
		recursionDoom,
	);
	await expect(
		recursive.records.create({ input: { title: "root" } }),
	).rejects.toMatchObject({
		code: "QP-DATA-024",
		diagnosticClass: "lifecycleRecursionExceeded",
	});
	expect(() => recursionDoom.throwIfDoomed()).toThrow(
		"lifecycle recursion exceeded",
	);
});

test("Collection update preserves current and enforces candidate Policy before check", async () => {
	const textCodec = {
		kind: "text",
		minLength: 1,
		maxLength: 8_192,
		collation: "questpie.binary",
	} as const;
	const operation = {
		identity: "mutation:records.update",
		kind: "mutation",
		mode: "writeTransaction",
		target: "collection:records",
		member: "update",
		policy: "policy:records.default",
		keyFields: [["id"]],
		callerInputFields: [["body"]],
		requiredCallerInputFields: [],
		trustedValueFields: [],
		requiredTrustedValueFields: [],
		selectedFieldPaths: [["id"], ["body"]],
		dataQuery: null,
		dataQueryDigest: null,
		normalizerProgramDigest: null,
		serverValueProgramDigest: null,
		outputCardinality: "optionalOne",
		limits: {
			inputBytes: 65_536,
			resultBytes: 1_048_576,
			rowsWritten: 100,
			durationMilliseconds: 5_000,
		},
		lifecycleProgram: oneGetCheckLifecycle("mutation:records.update"),
	} as const;
	const plan = {
		...operation,
		operation,
		candidate: {
			fields: [
				{ path: ["id"], codec: { kind: "uuid" }, nullable: false },
				{ path: ["body"], codec: textCodec, nullable: false },
			],
		},
		lock: {
			sql: "UPDATE_LOCK_SQL",
			parameters: [
				{
					position: 1,
					kind: "key",
					path: ["id"],
					codec: { kind: "uuid" },
					postgresType: "uuid",
				},
			],
		},
		fieldAuthority: { checks: [] },
		candidateValidation: {
			freshAfterRowLockWait: true,
			sql: "UPDATE_CANDIDATE_SQL",
			parameters: [
				{
					position: 1,
					kind: "patchValue",
					path: ["body"],
					codec: textCodec,
					postgresType: "text",
				},
			],
			result: [
				{
					path: ["id"],
					column: "qp_candidate_0",
					codec: { kind: "uuid" },
					nullable: false,
				},
				{
					path: ["body"],
					column: "qp_candidate_1",
					codec: textCodec,
					nullable: false,
				},
			],
			currentResult: [
				{
					path: ["id"],
					column: "qp_current_0",
					codec: { kind: "uuid" },
					nullable: false,
				},
				{
					path: ["body"],
					column: "qp_current_1",
					codec: textCodec,
					nullable: false,
				},
			],
		},
		candidatePolicyCheck: {
			freshAfterRowLockWait: true,
			sql: "UPDATE_CANDIDATE_POLICY_SQL",
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
					kind: "candidateValue",
					path: ["body"],
					codec: textCodec,
					postgresType: "text",
				},
			],
			outcome: "authorizedOrUnavailable",
		},
		write: {
			sql: "UPDATE_WRITE_SQL",
			parameters: [
				{
					position: 1,
					kind: "patchValue",
					path: ["body"],
					codec: textCodec,
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
					codec: textCodec,
					nullable: false,
				},
			],
		},
		limits: { rows: 100, durationMilliseconds: 5_000 },
	} as const;
	const calls: string[] = [];
	const data = dataFor(
		[plan, getPlan()],
		async (statement, parameters = []) => {
			calls.push(statement);
			if (statement === "UPDATE_LOCK_SQL") return [{}];
			if (statement === "UPDATE_CANDIDATE_SQL")
				return [
					{
						qp_candidate_0: id,
						qp_candidate_1: parameters[0],
						qp_current_0: id,
						qp_current_1: "before",
					},
				];
			if (statement === "UPDATE_CANDIDATE_POLICY_SQL") {
				expect(parameters).toEqual([id, "after"]);
				return [{}];
			}
			if (statement === "LOCK_SQL") return [{}];
			if (statement === "FRESH_POLICY_READ_SQL")
				return [
					{
						qp_result_0: id,
						qp_result_1: "visible",
						qp_result_1_allowed: true,
					},
				];
			return [{ qp_result_0: id, qp_result_1: "after" }];
		},
		undefined,
		{
			"collection:records": {
				"issue:records/invalidCurrent": "invalidRecord",
			},
		},
	);

	await expect(
		data.records.update({ key: { id }, patch: { body: "after" } }),
	).resolves.toEqual({ id, body: "after" });
	expect(calls).toEqual([
		"UPDATE_LOCK_SQL",
		"UPDATE_CANDIDATE_SQL",
		"UPDATE_CANDIDATE_POLICY_SQL",
		"LOCK_SQL",
		"FRESH_POLICY_READ_SQL",
		"UPDATE_WRITE_SQL",
	]);
});

test("Operation create normalization follows sparse caller Field authority", async () => {
	const baseline = createPlan();
	const kernelIdentity = "mutation:__collectionKernel.records.create";
	const plan = {
		...baseline,
		identity: kernelIdentity,
		operation: { ...baseline.operation, identity: kernelIdentity },
	};
	const normalizer = {
		artifact: "questpie.field-normalizer-program",
		version: 1,
		target: "collection:records",
		operation: "create",
		steps: [
			{
				target: ["title"],
				expression: { kind: "trim", source: ["title"] },
			},
		],
		capabilities: [],
	} as const;
	const normalizerDigest = digest(
		"questpie-field-normalizer-program-v1",
		normalizer,
	);
	const {
		normalizerProgram: _normalizerProgram,
		serverValueProgram: _serverValueProgram,
		...kernelOperation
	} = plan.operation;
	const kernel = {
		...kernelOperation,
		normalizerProgramDigest: normalizerDigest,
	};
	const kernels = linkCollectionMutationPrograms({
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [kernel],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		policies: [
			{ identity: "policy:records.default", target: "collection:records" },
		],
	});
	const adapters = linkCollectionOperationAdapters({
		artifact: {
			format: "questpie.collection-operation-adapters",
			version: 1,
			adapters: [
				{
					identity: "mutation:records.normalized.create",
					target: "collection:records",
					member: "create",
					kernelIdentity: kernel.identity,
					keyFields: [],
					callerInputFields: [["title"]],
					requiredCallerInputFields: [["title"]],
					selectedFieldPaths: [["id"], ["title"]],
					normalizerProgramDigest: normalizerDigest,
					serverValueProgramDigest: null,
					outputCardinality: "one",
					limits: kernel.limits,
				},
			],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		kernels,
	});
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const data = dataFor([plan], async (statement, parameters = []) => {
		calls.push([statement, parameters]);
		if (statement === "TITLE_AUTHORITY_SQL")
			return parameters[0] === "  allowed  " ? [{ allowed: true }] : [];
		return [
			{
				qp_result_0: id,
				qp_result_1: "allowed",
				qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
			},
		];
	});
	const execute = createCollectionOperationAdapterExecutor({
		adapters,
		facts: {
			operationTime: new Date("2026-08-16T20:00:00.000Z"),
			principal: { id: principalId, kind: "user" },
			tenant: { id: "tenant-1" },
		},
		invokeKernel: async (identity, request) => {
			expect(identity).toBe(plan.identity);
			return data.records.create(request);
		},
	});

	await expect(
		execute("mutation:records.normalized.create", {
			input: { title: "  allowed  " },
		}),
	).resolves.toEqual({ id, title: "allowed" });
	expect(calls).toEqual([
		["TITLE_AUTHORITY_SQL", ["  allowed  "]],
		[
			"WRITE_WITH_btrim_gen_random_uuid_SQL",
			["allowed", false, null, new Date("2026-08-16T20:00:00.000Z")],
		],
	]);
});

test("Operation update normalization follows sparse caller Field authority", async () => {
	const textCodec = {
		kind: "text",
		minLength: 1,
		maxLength: 120,
		collation: "questpie.binary",
	} as const;
	const kernelIdentity = "mutation:__collectionKernel.records.update";
	const normalizer = {
		artifact: "questpie.field-normalizer-program",
		version: 1,
		target: "collection:records",
		operation: "update",
		steps: [
			{
				target: ["title"],
				expression: { kind: "trim", source: ["title"] },
			},
		],
		capabilities: [],
	} as const;
	const normalizerDigest = digest(
		"questpie-field-normalizer-program-v1",
		normalizer,
	);
	const kernel = {
		identity: kernelIdentity,
		kind: "mutation",
		mode: "writeTransaction",
		target: "collection:records",
		member: "update",
		policy: "policy:records.default",
		keyFields: [["id"]],
		callerInputFields: [["title"]],
		requiredCallerInputFields: [],
		trustedValueFields: [],
		requiredTrustedValueFields: [],
		selectedFieldPaths: [["id"], ["title"]],
		dataQuery: null,
		dataQueryDigest: null,
		normalizerProgramDigest: normalizerDigest,
		serverValueProgramDigest: null,
		outputCardinality: "optionalOne",
		limits: {
			inputBytes: 65_536,
			resultBytes: 1_048_576,
			rowsWritten: 100,
			durationMilliseconds: 5_000,
		},
	} as const;
	const plan = {
		...kernel,
		operation: kernel,
		candidate: {
			fields: [{ path: ["title"], codec: textCodec, nullable: false }],
		},
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
		},
		fieldAuthority: {
			checks: [
				{
					path: ["title"],
					sql: "TITLE_AUTHORITY_SQL",
					parameters: [
						{
							position: 1,
							kind: "patchValue",
							path: ["title"],
							codec: textCodec,
							postgresType: "text",
						},
					],
				},
			],
		},
		candidateValidation: {
			sql: "CANDIDATE_VALIDATION_SQL",
			parameters: [
				{
					position: 1,
					kind: "patchValue",
					path: ["title"],
					codec: textCodec,
					postgresType: "text",
				},
			],
			result: [
				{
					path: ["title"],
					column: "qp_candidate_0",
					codec: textCodec,
					nullable: false,
				},
			],
		},
		write: {
			sql: "WRITE_SQL",
			parameters: [
				{
					position: 1,
					kind: "patchValue",
					path: ["title"],
					codec: textCodec,
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
					path: ["title"],
					column: "qp_result_1",
					codec: textCodec,
					nullable: false,
				},
			],
		},
		limits: { rows: 100, durationMilliseconds: 5_000 },
	} as const;
	const kernels = linkCollectionMutationPrograms({
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [kernel],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		policies: [
			{ identity: "policy:records.default", target: "collection:records" },
		],
	});
	const adapters = linkCollectionOperationAdapters({
		artifact: {
			format: "questpie.collection-operation-adapters",
			version: 1,
			adapters: [
				{
					identity: "mutation:records.normalized.update",
					target: "collection:records",
					member: "update",
					kernelIdentity,
					keyFields: [["id"]],
					callerInputFields: [["title"]],
					requiredCallerInputFields: [],
					selectedFieldPaths: [["id"], ["title"]],
					normalizerProgramDigest: normalizerDigest,
					serverValueProgramDigest: null,
					outputCardinality: "optionalOne",
					limits: kernel.limits,
				},
			],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		kernels,
	});
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const data = dataFor([plan], async (statement, parameters = []) => {
		calls.push([statement, parameters]);
		if (statement === "LOCK_SQL") return [{}];
		if (statement === "TITLE_AUTHORITY_SQL")
			return parameters[0] === "  allowed  " ? [{}] : [];
		if (statement === "CANDIDATE_VALIDATION_SQL")
			return [{ qp_candidate_0: "allowed" }];
		return [{ qp_result_0: id, qp_result_1: "allowed" }];
	});
	const execute = createCollectionOperationAdapterExecutor({
		adapters,
		facts: {
			operationTime: new Date("2026-08-16T20:00:00.000Z"),
			principal: { id: principalId, kind: "user" },
			tenant: { id: "tenant-1" },
		},
		invokeKernel: async (identity, request) => {
			expect(identity).toBe(kernelIdentity);
			return data.records.update(request);
		},
	});

	await expect(
		execute("mutation:records.normalized.update", {
			key: { id },
			patch: { title: "  allowed  " },
		}),
	).resolves.toEqual({ id, title: "allowed" });
	expect(calls).toEqual([
		["LOCK_SQL", [id]],
		["TITLE_AUTHORITY_SQL", ["  allowed  "]],
		["CANDIDATE_VALIDATION_SQL", ["allowed"]],
		["WRITE_SQL", ["allowed"]],
	]);
});

test("rejects an empty update patch before PostgreSQL", async () => {
	let calls = 0;
	const data = dataFor(
		[
			{
				identity: "mutation:records.update",
				member: "update",
				target: "collection:records",
				operation: {
					keyFields: [["id"]],
					callerInputFields: [["title"]],
				},
			},
		],
		async () => {
			calls += 1;
			return [];
		},
	);

	await expect(data.records.update({ key: { id }, patch: {} })).rejects.toThrow(
		"Collection update patch and values must not both be empty",
	);
	await expect(data.records.update({ key: { id } })).rejects.toThrow(
		"Collection update patch and values must not both be empty",
	);
	expect(calls).toBe(0);
});

test("rejects unknown and overlapping trusted values before PostgreSQL", async () => {
	let calls = 0;
	const plan = {
		identity: "mutation:records.update",
		member: "update",
		target: "collection:records",
		operation: {
			keyFields: [["id"]],
			callerInputFields: [["title"]],
			trustedValueFields: [["title"], ["body"]],
			requiredTrustedValueFields: [],
		},
	};
	const data = dataFor([plan], async () => {
		calls += 1;
		return [];
	});

	await expect(
		data.records.update({
			key: { id },
			patch: { title: "caller" },
			values: { body: "trusted", unknown: true },
		}),
	).rejects.toThrow("Collection update values contains undeclared Fields");
	await expect(
		data.records.update({
			key: { id },
			patch: { title: "caller" },
			values: { title: "trusted" },
		}),
	).rejects.toThrow("Collection update patch and values must not overlap");
	expect(calls).toBe(0);
});

test("allows a values-only update and binds trusted value presence separately", async () => {
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const data = dataFor(
		[
			{
				identity: "mutation:records.update",
				member: "update",
				target: "collection:records",
				limits: { rows: 100, durationMilliseconds: 5_000 },
				operation: {
					keyFields: [["id"]],
					callerInputFields: [["title"]],
					trustedValueFields: [["body"]],
					requiredTrustedValueFields: [],
				},
				candidate: {
					fields: [
						{
							path: ["body"],
							codec: {
								kind: "text",
								minLength: 1,
								maxLength: 8_192,
								collation: "questpie.binary",
							},
							nullable: false,
							requiredInput: false,
						},
					],
				},
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
				},
				candidateValidation: {
					freshAfterRowLockWait: true,
					sql: "CANDIDATE_VALIDATION_SQL",
					parameters: [
						{
							position: 1,
							kind: "trustedValuePresent",
							path: ["body"],
							codec: "boolean",
							postgresType: "boolean",
						},
						{
							position: 2,
							kind: "trustedValue",
							path: ["body"],
							codec: {
								kind: "text",
								minLength: 1,
								maxLength: 8_192,
								collation: "questpie.binary",
							},
							postgresType: "text",
						},
					],
					result: [
						{
							path: ["body"],
							column: "qp_candidate_0",
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
				fieldAuthority: { checks: [] },
				write: {
					sql: "WRITE_SQL",
					parameters: [
						{
							position: 1,
							kind: "trustedValuePresent",
							path: ["body"],
							codec: "boolean",
							postgresType: "boolean",
						},
						{
							position: 2,
							kind: "trustedValue",
							path: ["body"],
							codec: {
								kind: "text",
								minLength: 1,
								maxLength: 8_192,
								collation: "questpie.binary",
							},
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
					],
				},
			},
		],
		async (statement, parameters = []) => {
			calls.push([statement, parameters]);
			if (statement === "LOCK_SQL") return [{}];
			if (statement === "CANDIDATE_VALIDATION_SQL")
				return [{ qp_candidate_0: "trusted" }];
			return [{ qp_result_0: id }];
		},
	);

	await expect(
		data.records.update({
			key: { id },
			values: { body: "trusted" },
		}),
	).resolves.toEqual({ id });
	expect(calls).toEqual([
		["LOCK_SQL", [id]],
		["CANDIDATE_VALIDATION_SQL", [true, "trusted"]],
		["WRITE_SQL", [true, "trusted"]],
	]);
});

test("validates and binds sparse compare-and-set expectations before the write", async () => {
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const textCodec = {
		kind: "text",
		minLength: 1,
		maxLength: 120,
		collation: "questpie.binary",
	} as const;
	const data = dataFor(
		[
			{
				identity: "mutation:records.update",
				member: "update",
				target: "collection:records",
				limits: { rows: 100, durationMilliseconds: 5_000 },
				operation: {
					keyFields: [["id"]],
					callerInputFields: [["title"]],
					trustedValueFields: [],
					requiredTrustedValueFields: [],
				},
				candidate: {
					fields: [{ path: ["title"], codec: textCodec, nullable: false }],
				},
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
				},
				candidateValidation: {
					freshAfterRowLockWait: true,
					sql: "CANDIDATE_VALIDATION_SQL",
					parameters: [
						{
							position: 1,
							kind: "expectedPresent",
							path: ["title"],
							codec: "boolean",
							postgresType: "boolean",
						},
						{
							position: 2,
							kind: "expectedValue",
							path: ["title"],
							codec: textCodec,
							postgresType: "text",
						},
					],
					result: [
						{
							path: ["title"],
							column: "qp_candidate_0",
							codec: textCodec,
							nullable: false,
						},
					],
				},
				fieldAuthority: { checks: [] },
				write: {
					sql: "WRITE_SQL",
					parameters: [
						{
							position: 1,
							kind: "expectedPresent",
							path: ["title"],
							codec: "boolean",
							postgresType: "boolean",
						},
						{
							position: 2,
							kind: "expectedValue",
							path: ["title"],
							codec: textCodec,
							postgresType: "text",
						},
					],
					result: [],
				},
			},
		],
		async (statement, parameters = []) => {
			calls.push([statement, parameters]);
			if (statement === "LOCK_SQL") return [{}];
			if (statement === "CANDIDATE_VALIDATION_SQL")
				return [{ qp_candidate_0: "after" }];
			return [];
		},
	);

	await expect(
		data.records.update({
			key: { id },
			expected: { title: "before" },
			patch: { title: "after" },
		}),
	).resolves.toBeNull();
	expect(calls).toEqual([
		["LOCK_SQL", [id]],
		["CANDIDATE_VALIDATION_SQL", [true, "before"]],
		["WRITE_SQL", [true, "before"]],
	]);

	await expect(
		data.records.update({
			key: { id },
			expected: { unknown: "before" },
			patch: { title: "after" },
		}),
	).rejects.toThrow("Collection update expected contains undeclared Fields");
	await expect(
		data.records.update({
			key: { id },
			expected: { title: "" },
			patch: { title: "after" },
		}),
	).rejects.toThrow("invalid relational scalar");
	expect(calls).toHaveLength(3);
});

test("validates every untouched update candidate Field before Policy and write", async () => {
	const calls: string[] = [];
	const textCodec = {
		kind: "text",
		minLength: 1,
		maxLength: 120,
		collation: "questpie.binary",
	} as const;
	const profileCodec = {
		kind: "object",
		properties: {
			displayName: { kind: "text", minLength: 1, maxLength: 120 },
		},
	} as const;
	const data = dataFor(
		[
			{
				identity: "mutation:records.update",
				member: "update",
				target: "collection:records",
				limits: { rows: 100, durationMilliseconds: 5_000 },
				operation: {
					keyFields: [["id"]],
					callerInputFields: [["title"]],
					trustedValueFields: [],
					requiredTrustedValueFields: [],
				},
				candidate: {
					fields: [
						{ path: ["title"], codec: textCodec, nullable: false },
						{ path: ["profile"], codec: profileCodec, nullable: false },
					],
				},
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
				},
				candidateValidation: {
					sql: "CANDIDATE_VALIDATION_SQL",
					parameters: [],
					result: [
						{
							path: ["title"],
							column: "qp_candidate_0",
							codec: textCodec,
							nullable: false,
						},
						{
							path: ["profile"],
							column: "qp_candidate_1",
							codec: profileCodec,
							nullable: false,
						},
					],
				},
				fieldAuthority: {
					checks: [
						{
							path: ["title"],
							sql: "TITLE_AUTHORITY_SQL",
							parameters: [],
						},
					],
				},
				write: {
					sql: "WRITE_SQL",
					parameters: [],
					result: [],
				},
			},
		],
		async (statement) => {
			calls.push(statement);
			if (statement === "LOCK_SQL") return [{}];
			if (statement === "TITLE_AUTHORITY_SQL") return [{}];
			if (statement === "CANDIDATE_VALIDATION_SQL")
				return [
					{
						qp_candidate_0: "after",
						qp_candidate_1: { displayName: "" },
					},
				];
			return [];
		},
	);

	await expect(
		data.records.update({ key: { id }, patch: { title: "after" } }),
	).rejects.toThrow("$field.displayName");
	expect(calls).toEqual([
		"LOCK_SQL",
		"TITLE_AUTHORITY_SQL",
		"CANDIDATE_VALIDATION_SQL",
	]);
});

test("create decodes trusted values exactly and binds them separately", async () => {
	const calls: Array<readonly [string, readonly unknown[]]> = [];
	const createdAt = new Date("2026-08-16T20:00:00.000Z");
	const data = dataFor(
		[trustedCreatePlan()],
		async (statement, parameters = []) => {
			calls.push([statement, parameters]);
			return statement === "TITLE_AUTHORITY_SQL"
				? [{}]
				: [
						{
							qp_result_0: id,
							qp_result_1: "A title",
							qp_result_2: createdAt,
						},
					];
		},
	);

	await expect(
		data.records.create({
			input: { title: "A title" },
			values: { body: "trusted" },
		}),
	).resolves.toEqual({ id, title: "A title", createdAt });
	expect(calls).toEqual([
		["TITLE_AUTHORITY_SQL", ["A title"]],
		["WRITE_WITH_btrim_gen_random_uuid_SQL", ["A title", "trusted", createdAt]],
	]);
});

test("create rejects unknown, overlapping, and invalid trusted values before PostgreSQL", async () => {
	let calls = 0;
	const data = dataFor([trustedCreatePlan()], async () => {
		calls += 1;
		return [];
	});

	await expect(
		data.records.create({
			input: { title: "A title" },
			values: { unknown: "trusted" },
		}),
	).rejects.toThrow("Collection create values contains undeclared Fields");
	await expect(
		data.records.create({
			input: { title: "A title" },
			values: { title: "trusted" },
		}),
	).rejects.toThrow("Collection create input and values must not overlap");
	await expect(
		data.records.create({
			input: { title: "A title" },
			values: { body: "" },
		}),
	).rejects.toThrow("invalid relational scalar");
	expect(calls).toBe(0);
});

test("create rejects missing required trusted values before PostgreSQL", async () => {
	let calls = 0;
	const data = dataFor([trustedCreatePlan()], async () => {
		calls += 1;
		return [];
	});

	await expect(
		data.records.create({ input: { title: "A title" } }),
	).rejects.toThrow("Collection create candidate is missing required Fields");
	expect(calls).toBe(0);
});

test("create accepts a required Field from either lane and checks the merged candidate", async () => {
	const baseline = trustedCreatePlan();
	const plan = {
		...baseline,
		operation: {
			...baseline.operation,
			callerInputFields: [["title"], ["body"]],
			requiredCallerInputFields: [],
			trustedValueFields: [["title"], ["body"]],
			requiredTrustedValueFields: [],
		},
		write: {
			...baseline.write,
			parameters: [],
		},
	} as const;
	let calls = 0;
	const data = dataFor([plan], async () => {
		calls += 1;
		return [
			{
				qp_result_0: id,
				qp_result_1: "title",
				qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
			},
		];
	});

	await expect(
		data.records.create({ input: {}, values: { title: "T", body: "B" } }),
	).resolves.toBeDefined();
	await expect(
		data.records.create({ input: { title: "T", body: "B" } }),
	).resolves.toBeDefined();
	await expect(
		data.records.create({
			input: { title: "caller", body: "B" },
			values: { title: "trusted" },
		}),
	).rejects.toThrow("must not overlap");
	await expect(data.records.create({ input: { body: "B" } })).rejects.toThrow(
		"missing required Fields",
	);
	expect(calls).toBe(3);
});

test("decodes distinct trusted-value PostgreSQL parameter kinds", () => {
	expect(
		decodePostgresCollectionParameters(
			[
				{
					position: 1,
					kind: "trustedValuePresent",
					path: ["body"],
					codec: "boolean",
					postgresType: "boolean",
				},
				{
					position: 2,
					kind: "trustedValue",
					path: ["body"],
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 8_192,
						collation: "questpie.binary",
					},
					postgresType: "text",
				},
			],
			"SELECT $1::boolean, $2::text",
			"trusted values",
		),
	).toMatchObject([
		{ kind: "trustedValuePresent", path: ["body"] },
		{ kind: "trustedValue", path: ["body"] },
	]);
});

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
			["  A title  ", true, "Body", new Date("2026-08-16T20:00:00.000Z")],
		],
	]);
});

test("create distinguishes an omitted nullable caller Field from explicit null", async () => {
	const baseline = createPlan();
	const plan = {
		...baseline,
		candidate: {
			...baseline.candidate,
			fields: baseline.candidate.fields.map((field) =>
				field.path[0] === "body" ? { ...field, nullable: true } : field,
			),
		},
	};
	const writes: unknown[][] = [];
	const data = dataFor([plan], async (statement, parameters = []) => {
		if (statement.endsWith("AUTHORITY_SQL")) return [{ allowed: true }];
		writes.push([...parameters]);
		return [
			{
				qp_result_0: id,
				qp_result_1: "Required",
				qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
			},
		];
	});

	await data.records.create({ input: { title: "Required" } });
	await data.records.create({ input: { title: "Required", body: null } });
	expect(writes).toEqual([
		["Required", false, null, new Date("2026-08-16T20:00:00.000Z")],
		["Required", true, null, new Date("2026-08-16T20:00:00.000Z")],
	]);
});

test("create requires only artifact-owned caller Fields before PostgreSQL", async () => {
	let calls = 0;
	const data = dataFor([createPlan()], async (statement) => {
		calls += 1;
		if (statement.endsWith("AUTHORITY_SQL")) return [{ allowed: true }];
		return [
			{
				qp_result_0: id,
				qp_result_1: "Required",
				qp_result_2: new Date("2026-08-16T20:00:00.000Z"),
			},
		];
	});

	await expect(
		data.records.create({ input: { body: "optional" } }),
	).rejects.toThrow("Collection create candidate is missing required Fields");
	expect(calls).toBe(0);
	await expect(
		data.records.create({ input: { title: "Required" } }),
	).resolves.toMatchObject({ id, title: "Required" });
	expect(calls).toBeGreaterThan(0);
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
	).rejects.toThrow("contains undeclared Fields");
	await expect(
		data.records.create({
			input: { title: "Title", body: "Body", smuggled: {} },
		}),
	).rejects.toThrow("contains undeclared Fields");
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

test("treats object, array, and json Fields as atomic normalized jsonb values", async () => {
	const profileCodec = {
		kind: "object",
		properties: {
			displayName: { kind: "text", minLength: 1, maxLength: 120 },
			verifiedAt: {
				kind: "nullable",
				codec: { kind: "timestamp", withTimezone: true },
			},
		},
	} as const;
	const tagsCodec = {
		kind: "array",
		maximum: 2,
		items: { kind: "text", minLength: 1, maxLength: 20 },
	} as const;
	const jsonCodec = { kind: "json" } as const;
	const writeResult = [
		{
			path: ["profile"],
			column: "qp_result_0",
			codec: profileCodec,
			nullable: false,
		},
		{
			path: ["tags"],
			column: "qp_result_1",
			codec: tagsCodec,
			nullable: false,
		},
		{
			path: ["metadata"],
			column: "qp_result_2",
			codec: jsonCodec,
			nullable: false,
		},
	] as const;
	const writeStatement = bindPostgresCollectionStatement({
		identity: "mutation:records.create",
		leaf: "write",
		text: 'SELECT $1::jsonb AS "qp_result_0", $2::jsonb AS "qp_result_1", $3::jsonb AS "qp_result_2"',
		parameterCount: 3,
		result: writeResult,
	});
	const baseline = createPlan();
	const complexPlan = {
		...baseline,
		operation: {
			...baseline.operation,
			callerInputFields: [["profile"], ["tags"]],
			requiredCallerInputFields: [["profile"], ["tags"]],
			trustedValueFields: [["metadata"]],
			requiredTrustedValueFields: [["metadata"]],
			selectedFieldPaths: [["profile"], ["tags"], ["metadata"]],
		},
		candidate: {
			steps: [],
			fields: [
				{
					path: ["profile"],
					codec: profileCodec,
					nullable: false,
					requiredInput: true,
				},
				{
					path: ["tags"],
					codec: tagsCodec,
					nullable: false,
					requiredInput: true,
				},
				{
					path: ["metadata"],
					codec: jsonCodec,
					nullable: false,
					requiredInput: true,
				},
			],
		},
		fieldAuthority: { suppliedPathsOnly: true, checks: [] },
		write: {
			sql: "WRITE_JSONB_SQL",
			parameters: [
				{
					position: 1,
					postgresType: "jsonb",
					kind: "callerInput",
					path: ["profile"],
					codec: profileCodec,
				},
				{
					position: 2,
					postgresType: "jsonb",
					kind: "callerInput",
					path: ["tags"],
					codec: tagsCodec,
				},
				{
					position: 3,
					postgresType: "jsonb",
					kind: "trustedValue",
					path: ["metadata"],
					codec: jsonCodec,
				},
			],
			result: writeResult,
			statement: writeStatement,
		},
	} as const;
	const calls: unknown[][] = [];
	const data = createCollectionMutationData({
		plans: {
			plans: [complexPlan],
			byIdentity: new Map([[complexPlan.identity, complexPlan]]),
		} as any,
		facts: {
			principal: { id: principalId, kind: "user" },
			authority: { kind: "ordinary" },
			tenant: { id },
		},
		operationTime: new Date("2026-08-28T10:00:00.000Z"),
		consumeRows() {},
		resultValuesDecoded: false,
		async executeLeaf(_leaf, parameters = []) {
			calls.push([...parameters]);
			return [
				{
					qp_result_0: {
						displayName: "Ada",
						verifiedAt: "2026-08-28T09:00:00.000Z",
					},
					qp_result_1: ["owner"],
					qp_result_2: { kind: "json", value: { audit: true } },
				},
			];
		},
	});

	const result = await (data as any).records.create({
		input: {
			profile: {
				displayName: "Ada",
				verifiedAt: new Date("2026-08-28T09:00:00.000Z"),
			},
			tags: ["owner"],
		},
		values: { metadata: { kind: "json", value: { audit: true } } },
	});
	expect(calls).toEqual([
		[
			{
				kind: "json",
				value: {
					displayName: "Ada",
					verifiedAt: "2026-08-28T09:00:00.000Z",
				},
			},
			{ kind: "json", value: ["owner"] },
			{ kind: "json", value: { audit: true } },
		],
	]);
	expect(result).toEqual({
		profile: {
			displayName: "Ada",
			verifiedAt: new Date("2026-08-28T09:00:00.000Z"),
		},
		tags: ["owner"],
		metadata: {
			kind: "json",
			value: { kind: "json", value: { audit: true } },
		},
	});
	const databaseData = createCollectionMutationData({
		plans: {
			plans: [complexPlan],
			byIdentity: new Map([[complexPlan.identity, complexPlan]]),
		} as any,
		facts: {
			principal: { id: principalId, kind: "user" },
			authority: { kind: "ordinary" },
			tenant: { id },
		},
		operationTime: new Date("2026-08-28T10:00:00.000Z"),
		consumeRows() {},
		resultValuesDecoded: true,
		executeLeaf: async (leaf) =>
			leaf.statement.decode({
				command: "SELECT",
				rowCount: 1,
				rows: [
					[
						{
							displayName: "Ada",
							verifiedAt: "2026-08-28T09:00:00.000Z",
						},
						["owner"],
						{ kind: "json", value: { audit: true } },
					],
				],
			}),
	});
	expect(
		await (databaseData as any).records.create({
			input: {
				profile: {
					displayName: "Ada",
					verifiedAt: new Date("2026-08-28T09:00:00.000Z"),
				},
				tags: ["owner"],
			},
			values: { metadata: { kind: "json", value: { audit: true } } },
		}),
	).toEqual(result);

	for (const invalid of [
		{
			profile: { displayName: "Ada", verifiedAt: null, extra: true },
			tags: ["owner"],
		},
		{
			profile: { displayName: "Ada", verifiedAt: null },
			tags: ["one", "two", "three"],
		},
	] as const) {
		await expect(
			(data as any).records.create({
				input: invalid,
				values: { metadata: { kind: "json", value: { audit: true } } },
			}),
		).rejects.toThrow();
	}
	const validInput = {
		profile: { displayName: "Ada", verifiedAt: null },
		tags: ["owner"],
	};
	const sparseTags: string[] = [];
	sparseTags.length = 1;
	for (const request of [
		{
			input: { ...validInput, tags: sparseTags },
			values: { metadata: { kind: "json", value: true } },
		},
		{ input: validInput, values: { metadata: { audit: true } } },
		{
			input: validInput,
			values: { metadata: { kind: "json", value: Number.NaN } },
		},
		{ input: validInput, values: { metadata: { kind: "json", value: -0 } } },
		{
			input: validInput,
			values: { metadata: { kind: "json", value: "e\u0301" } },
		},
	] as const) {
		await expect((data as any).records.create(request)).rejects.toThrow();
	}
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	await expect(
		(data as any).records.create({
			input: validInput,
			values: { metadata: { kind: "json", value: cyclic } },
		}),
	).rejects.toThrow();
	expect(calls).toHaveLength(1);
});

test("links only jsonb PostgreSQL types to recursive Collection Field codecs", () => {
	const profileCodec = {
		kind: "object",
		properties: {
			name: { kind: "text" },
			seenAt: {
				kind: "nullable",
				codec: { kind: "timestamp", withTimezone: true },
			},
		},
	} as const;
	expect(
		decodePostgresCollectionParameters(
			[
				{
					position: 1,
					postgresType: "jsonb",
					kind: "callerInput",
					path: ["profile"],
					codec: profileCodec,
				},
			],
			"SELECT $1::jsonb",
			"jsonb",
		),
	).toHaveLength(1);
	expect(() =>
		decodePostgresCollectionParameters(
			[
				{
					position: 1,
					postgresType: "text",
					kind: "callerInput",
					path: ["profile"],
					codec: {
						kind: "object",
						properties: { name: { kind: "text" } },
					},
				},
			],
			"SELECT $1::text",
			"jsonb",
		),
	).toThrow("PostgreSQL type disagrees");

	const bound = bindPostgresCollectionStatement({
		identity: "mutation:records.create",
		leaf: "write",
		text: 'SELECT "profile" AS "qp_result_0", "metadata" AS "qp_result_1"',
		parameterCount: 0,
		result: [
			{
				path: ["profile"],
				column: "qp_result_0",
				codec: profileCodec,
				nullable: false,
			},
			{
				path: ["metadata"],
				column: "qp_result_1",
				codec: { kind: "json" },
				nullable: false,
			},
		],
	});
	expect(
		bound.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [
				[
					{ name: "Ada", seenAt: "2026-08-28T09:00:00.000Z" },
					{ kind: "json", value: { audit: true } },
				],
			],
		}),
	).toEqual([
		{
			qp_result_0: {
				name: "Ada",
				seenAt: new Date("2026-08-28T09:00:00.000Z"),
			},
			qp_result_1: {
				kind: "json",
				value: { kind: "json", value: { audit: true } },
			},
		},
	]);
});
