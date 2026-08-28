import { expect, test } from "bun:test";

import { digest } from "../../packages/compiler/src/canonical";
import { lowerPostgresCollectionOperationPlans } from "../../packages/compiler/src/mutation";

const schema = {
	format: "questpie.schema-projection",
	version: 1,
	application: { name: "archive", postgresSchema: "archive" },
	collections: [
		{
			identity: "collection:permits",
			postgresName: "permits",
			fields: [
				field("collection:permits", "principalId", "principal_id", {
					kind: "uuid",
				}),
				field("collection:permits", "ownerId", "owner_id", {
					kind: "uuid",
				}),
			],
			relations: [],
			constraints: [],
			indexes: [],
		},
		{
			identity: "collection:records",
			postgresName: "records",
			fields: [
				field(
					"collection:records",
					"body",
					"body",
					{
						kind: "text",
						minLength: 1,
						maxLength: 8_192,
						collation: "questpie.binary",
					},
					{ kind: "literal", value: "fallback" },
				),
				field(
					"collection:records",
					"createdAt",
					"created_at",
					{
						kind: "timestamp",
						withTimezone: true,
					},
					{ kind: "now" },
				),
				field(
					"collection:records",
					"id",
					"id",
					{ kind: "uuid" },
					{
						kind: "randomUuid",
					},
				),
				field("collection:records", "ownerId", "owner_id", {
					kind: "uuid",
				}),
				field("collection:records", "title", "title", {
					kind: "text",
					minLength: 1,
					maxLength: 120,
					collation: "questpie.binary",
				}),
			],
			relations: [],
			constraints: [],
			indexes: [],
		},
	],
};

function field(
	collection: string,
	name: string,
	postgresName: string,
	type: Readonly<Record<string, unknown>>,
	defaultValue: Readonly<Record<string, unknown>> | null = null,
) {
	return {
		identity: `${collection}/field:${name}`,
		path: [name],
		postgresName,
		nullable: false,
		default: defaultValue,
		collation: type.kind === "text" ? "questpie.binary" : null,
		type,
	};
}

const policyProgram = {
	format: "questpie.policy-program",
	version: 1,
	identity: "policy:records.default",
	target: "collection:records",
	attachment: { kind: "default", requiredForNormalDataAccess: true },
	operations: {
		read: {
			admission: { kind: "authenticated" },
			rows: {
				kind: "equal",
				left: fieldOperand("row", "collection:records", "ownerId", "uuid"),
				right: executionOperand("principal", "id", "uuid"),
			},
		},
		create: {
			admission: { kind: "authenticated" },
			candidate: {
				kind: "and",
				items: [
					{
						kind: "equal",
						left: fieldOperand(
							"candidate",
							"collection:records",
							"ownerId",
							"uuid",
						),
						right: executionOperand("principal", "id", "uuid"),
					},
					{
						kind: "exists",
						collection: "collection:permits",
						scope: "permit",
						semantics: "policyEvidenceBooleanOnly",
						targetDisclosurePolicy: "notApplied",
						predicate: {
							kind: "and",
							items: [
								{
									kind: "equal",
									left: fieldOperand(
										"permit",
										"collection:permits",
										"principalId",
										"uuid",
									),
									right: executionOperand("principal", "id", "uuid"),
								},
								{
									kind: "equal",
									left: fieldOperand(
										"permit",
										"collection:permits",
										"ownerId",
										"uuid",
									),
									right: fieldOperand(
										"candidate",
										"collection:records",
										"ownerId",
										"uuid",
									),
								},
							],
						},
					},
				],
			},
		},
	},
	fields: {
		callerInput: {
			create: [
				{ path: ["body"], when: { kind: "constant", value: true } },
				{ path: ["title"], when: { kind: "constant", value: true } },
			],
			suppliedPathsOnly: true,
		},
		selectedOutput: [
			{
				path: ["body"],
				deniedEncoding: "omitProperty",
				when: {
					kind: "and",
					items: [
						{
							kind: "notEqual",
							left: fieldOperand("row", "collection:records", "body", "text"),
							right: { kind: "literal", codec: "text", value: "classified" },
						},
						permitEvidence("row"),
					],
				},
			},
		],
	},
};

function fieldOperand(
	scope: string,
	collection: string,
	name: string,
	codec: string,
) {
	return { kind: "field", scope, collection, path: [name], codec };
}

function executionOperand(source: string, name: string, codec: string) {
	return { kind: "executionFact", source, path: [name], codec };
}

function permitEvidence(rootScope: "row") {
	return {
		kind: "exists",
		collection: "collection:permits",
		scope: "permitOutput",
		semantics: "policyEvidenceBooleanOnly",
		targetDisclosurePolicy: "notApplied",
		predicate: {
			kind: "and",
			items: [
				{
					kind: "equal",
					left: fieldOperand(
						"permitOutput",
						"collection:permits",
						"principalId",
						"uuid",
					),
					right: executionOperand("principal", "id", "uuid"),
				},
				{
					kind: "equal",
					left: fieldOperand(
						"permitOutput",
						"collection:permits",
						"ownerId",
						"uuid",
					),
					right: fieldOperand(
						rootScope,
						"collection:records",
						"ownerId",
						"uuid",
					),
				},
			],
		},
	};
}

const policyProjection = {
	format: "questpie.policy-projection",
	version: 1,
	policies: [
		{
			program: policyProgram,
			scopeBindings: [
				{
					scope: "candidate",
					collection: "collection:records",
					parentScope: null,
				},
				{
					scope: "permit",
					collection: "collection:permits",
					parentScope: "candidate",
				},
				{
					scope: "permitOutput",
					collection: "collection:permits",
					parentScope: "row",
				},
				{
					scope: "row",
					collection: "collection:records",
					parentScope: null,
				},
			],
			origin: null,
		},
	],
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
};

const serverValues = {
	artifact: "questpie.server-value-program",
	version: 1,
	target: "collection:records",
	operation: "create",
	assignments: [
		{
			target: ["ownerId"],
			mode: "overwrite",
			source: ["principal", "id"],
		},
	],
	capabilities: [],
};

const operations = {
	format: "questpie.collection-operation-programs",
	version: 1,
	operations: [
		{
			identity: "mutation:records.create",
			kind: "mutation",
			mode: "writeTransaction",
			target: "collection:records",
			member: "create",
			policy: "policy:records.default",
			keyFields: [],
			callerInputFields: [["title"], ["body"]],
			requiredCallerInputFields: [["title"]],
			trustedValueFields: [["id"]],
			requiredTrustedValueFields: [],
			selectedFieldPaths: [["id"], ["body"], ["title"], ["createdAt"]],
			dataQuery: null,
			dataQueryDigest: null,
			normalizerProgramDigest: digest(
				"questpie-field-normalizer-program-v1",
				normalizer,
			),
			serverValueProgramDigest: digest(
				"questpie-server-value-program-v1",
				serverValues,
			),
			outputCardinality: "one",
			limits: {
				inputBytes: 65_536,
				resultBytes: 1_048_576,
				rowsWritten: 100,
				durationMilliseconds: 5_000,
			},
		},
		{
			identity: "query:records.get",
			kind: "query",
			mode: "readSnapshot",
			target: "collection:records",
			member: "get",
			policy: "policy:records.default",
			keyFields: [["id"]],
			callerInputFields: [],
			requiredCallerInputFields: [],
			trustedValueFields: [],
			requiredTrustedValueFields: [],
			selectedFieldPaths: [["id"], ["body"], ["title"]],
			dataQuery: null,
			dataQueryDigest: null,
			normalizerProgramDigest: null,
			serverValueProgramDigest: null,
			outputCardinality: "optionalOne",
			limits: {
				inputBytes: 65_536,
				resultBytes: 1_048_576,
				rowsRead: 10_000,
				durationMilliseconds: 5_000,
			},
		},
	],
};

test("lowers plan-backed get/create without Runtime planning", () => {
	const lowered = lowerPostgresCollectionOperationPlans({
		collectionOperations: operations,
		schemaProjection: schema,
		policyProjection,
		normalizerPrograms: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValuePrograms: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [serverValues],
		},
	});

	expect(lowered).toMatchObject({
		format: "questpie.postgres-collection-operation-plans",
		version: 1,
	});
	expect(lowered.plans.map((plan) => plan.identity)).toEqual([
		"mutation:records.create",
		"query:records.get",
	]);
	const create = lowered.plans[0]!;
	expect(create).toMatchObject({
		member: "create",
		lifecycle: [
			"sparseCallerFieldAuthority",
			"pureNormalization",
			"schemaDefaults",
			"serverValues",
			"trustedValues",
			"completeCandidateValidation",
			"candidatePolicy",
			"postgresConstraints",
			"selection",
			"outputFieldAuthority",
			"outputValidation",
		],
		normalizerProgram: normalizer,
		serverValueProgram: serverValues,
		candidate: {
			steps: [
				{ phase: "callerInput", target: ["title"] },
				{ phase: "callerInput", target: ["body"] },
				{ phase: "normalizer", target: ["title"], transform: "trim" },
				{ phase: "schemaDefault", target: ["createdAt"], value: "now" },
				{ phase: "schemaDefault", target: ["id"], value: "randomUuid" },
				{
					phase: "serverValue",
					target: ["ownerId"],
					mode: "overwrite",
					source: ["principal", "id"],
				},
				{ phase: "trustedValue", target: ["id"] },
			],
		},
		fieldAuthority: { suppliedPathsOnly: true },
		candidatePolicy: {
			freshAfterRowLockWait: true,
			mutableEvidenceCollections: ["collection:permits"],
		},
		limits: { rows: 100, durationMilliseconds: 5_000 },
	});
	if (create.member !== "create") throw new Error("expected create plan");
	expect(create.fieldAuthority.checks).toHaveLength(2);
	expect(create.fieldAuthority.checks[0]?.sql).toContain("SELECT TRUE");
	expect(
		create.fieldAuthority.checks.map(({ parameters }) => parameters),
	).toEqual([[], []]);
	expect(create.write.sql).toContain('WITH "qp_candidate" AS');
	expect(create.write.sql).toContain("pg_catalog.gen_random_uuid()");
	expect(create.write.sql).toContain("pg_catalog.now()");
	expect(create.write.sql).toContain("btrim(");
	expect(create.write.sql).toContain('FROM "archive"."permits"');
	expect(create.write.sql).toContain('INSERT INTO "archive"."records"');
	expect(create.write.sql).toContain("RETURNING *");
	expect(create.write.sql).toContain('CASE WHEN "qp_guard_1"."allowed"');
	expect(create.write.sql).toContain('AS "qp_result_1_allowed"');
	expect(create.write.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "callerInput", path: ["title"] }),
			expect.objectContaining({
				kind: "callerInputPresent",
				path: ["body"],
			}),
			expect.objectContaining({
				kind: "executionFact",
				source: "principal",
				path: ["id"],
			}),
			expect.objectContaining({ kind: "literal", value: "classified" }),
			expect.objectContaining({ kind: "trustedValuePresent", path: ["id"] }),
			expect.objectContaining({ kind: "trustedValue", path: ["id"] }),
		]),
	);
	expect(create.write.sql).toMatch(
		/CASE WHEN \$\d+::boolean THEN \$\d+::uuid ELSE pg_catalog\.gen_random_uuid\(\) END AS "id"/,
	);
	expect(create.write.result).toEqual([
		expect.objectContaining({
			path: ["id"],
			codec: expect.objectContaining({ kind: "uuid" }),
		}),
		expect.objectContaining({
			path: ["body"],
			guardColumn: "qp_result_1_allowed",
			codec: expect.objectContaining({ kind: "text" }),
		}),
		expect.objectContaining({
			path: ["title"],
			codec: expect.objectContaining({ kind: "text" }),
		}),
		expect.objectContaining({
			path: ["createdAt"],
			codec: expect.objectContaining({ kind: "timestamp", withTimezone: true }),
		}),
	]);
	expect(create.outputAuthority.freshAfterRowLockWait).toBe(true);
	expect(create.outputAuthority.selectedPaths).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: ["id"], conditional: false }),
			expect.objectContaining({
				path: ["body"],
				conditional: true,
				guardColumn: "qp_result_1_allowed",
				mutableEvidenceCollections: ["collection:permits"],
			}),
		]),
	);
	expect(JSON.stringify(create)).not.toMatch(/runtimePlanning|dispatcher/i);
	expect(JSON.stringify(lowered)).not.toMatch(/messages|reaction/i);

	const get = lowered.plans[1]!;
	if (get.member !== "get") throw new Error("expected get plan");
	expect(get.consistency).toEqual({
		standalone: "readSnapshot",
		nestedMutation: "keyedLockThenFreshPolicyRead",
	});
	expect(get.lifecycle).toEqual([
		"keyedRowLock",
		"freshPolicyRead",
		"selection",
		"outputFieldAuthority",
	]);
	expect(get.lock.sql).toContain('FROM "archive"."records" AS "qp_lock_row"');
	expect(get.lock.sql).toContain("FOR UPDATE");
	expect(get.lock.sql).not.toContain('"archive"."permits"');
	expect(get.lock.outcome).toBe("internalLockedOrAbsent");
	expect(get.lock.parameters).toEqual([
		expect.objectContaining({ kind: "key", path: ["id"], position: 1 }),
	]);
	expect(get.read.freshAfterRowLockWait).toBe(true);
	expect(get.outputAuthority.freshAfterRowLockWait).toBe(true);
	expect(get.outputAuthority.selectedPaths[1]).toMatchObject({
		path: ["body"],
		conditional: true,
		mutableEvidenceCollections: ["collection:permits"],
	});
	expect(get.read.sql).toContain('FROM "archive"."records" AS "qp_row"');
	expect(get.read.sql).toContain('FROM "archive"."permits"');
	expect(get.read.sql).toContain('"qp_row"."id" IS NOT DISTINCT FROM');
	expect(get.read.sql).toContain('"qp_row"."owner_id" IS NOT DISTINCT FROM');
	expect(get.read.sql).toContain('CASE WHEN "qp_guard_1"."allowed"');
	expect(get.read.result).toContainEqual(
		expect.objectContaining({
			path: ["body"],
			guardColumn: "qp_result_1_allowed",
		}),
	);
	expect(get.read.sql).toContain("LIMIT 1");
	expect(get.read.sql).not.toContain("FOR UPDATE");
	expect(get.read.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "key", path: ["id"] }),
			expect.objectContaining({ kind: "executionFact", source: "principal" }),
			expect.objectContaining({ kind: "literal", value: "classified" }),
		]),
	);
});

test("rejects digest-only or mismatched executable programs", () => {
	const mismatched = structuredClone(operations);
	mismatched.operations[0]!.normalizerProgramDigest = "0".repeat(64);
	expect(() =>
		lowerPostgresCollectionOperationPlans({
			collectionOperations: mismatched,
			schemaProjection: schema,
			policyProjection,
			normalizerPrograms: {
				format: "questpie.field-normalizer-programs",
				version: 1,
				programs: [normalizer],
			},
			serverValuePrograms: {
				format: "questpie.server-value-programs",
				version: 1,
				programs: [serverValues],
			},
		}),
	).toThrow(/normalizer program digest/i);
});

test("merges trusted update values after caller patches without replaying create defaults", () => {
	const updatePolicyProjection = structuredClone(policyProjection) as any;
	const program = updatePolicyProjection.policies[0].program;
	program.operations.update = {
		admission: { kind: "authenticated" },
		current: {
			kind: "equal",
			left: fieldOperand("current", "collection:records", "ownerId", "uuid"),
			right: executionOperand("principal", "id", "uuid"),
		},
		candidate: {
			kind: "and",
			items: [
				{
					kind: "equal",
					left: fieldOperand(
						"candidate",
						"collection:records",
						"ownerId",
						"uuid",
					),
					right: fieldOperand(
						"current",
						"collection:records",
						"ownerId",
						"uuid",
					),
				},
				{
					kind: "notEqual",
					left: fieldOperand(
						"candidate",
						"collection:records",
						"title",
						"text",
					),
					right: fieldOperand("current", "collection:records", "title", "text"),
				},
			],
		},
	};
	program.fields.callerInput.update = [
		{ path: ["body"], when: { kind: "constant", value: true } },
	];
	updatePolicyProjection.policies[0].scopeBindings.push(
		{
			scope: "current",
			collection: "collection:records",
			parentScope: null,
		},
		{
			scope: "candidate",
			collection: "collection:records",
			parentScope: null,
		},
	);

	const updateOperations = structuredClone(operations) as any;
	updateOperations.operations = [
		{
			...updateOperations.operations[0],
			identity: "mutation:records.update",
			member: "update",
			keyFields: [["id"]],
			callerInputFields: [["body"]],
			requiredCallerInputFields: [],
			trustedValueFields: [["title"]],
			selectedFieldPaths: [["id"], ["body"], ["title"]],
			normalizerProgramDigest: null,
			serverValueProgramDigest: null,
			outputCardinality: "optionalOne",
		},
	];

	const lowered = lowerPostgresCollectionOperationPlans({
		collectionOperations: updateOperations,
		schemaProjection: schema,
		policyProjection: updatePolicyProjection,
		normalizerPrograms: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [],
		},
		serverValuePrograms: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
	});
	const update = lowered.plans[0]!;
	if (update.member !== "update") throw new Error("expected update plan");

	expect(update.candidate.steps).toEqual([
		{ phase: "callerInput", target: ["body"] },
		{ phase: "trustedValue", target: ["title"] },
	]);
	expect(update.fieldAuthority.checks.map(({ path }) => path)).toEqual([
		["body"],
	]);
	expect(update.candidateValidation.freshAfterRowLockWait).toBe(true);
	expect(update.candidateValidation.result.map(({ path }) => path)).toEqual(
		schema.collections
			.find(({ identity }) => identity === "collection:records")!
			.fields.map(({ path }) => path),
	);
	expect(update.candidateValidation.sql).toContain(
		'"qp_current"."owner_id" IS NOT DISTINCT FROM',
	);
	expect(update.candidateValidation.sql).not.toContain(
		'"qp_candidate"."title" IS DISTINCT FROM "qp_current"."title"',
	);
	expect(update.write.parameters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				kind: "expectedPresent",
				path: ["body"],
			}),
			expect.objectContaining({ kind: "expectedValue", path: ["body"] }),
			expect.objectContaining({
				kind: "trustedValuePresent",
				path: ["title"],
			}),
			expect.objectContaining({ kind: "trustedValue", path: ["title"] }),
		]),
	);
	expect(update.write.sql).toMatch(
		/CASE WHEN \$\d+::boolean THEN "qp_current"\."body" IS NOT DISTINCT FROM \$\d+::text ELSE TRUE END/,
	);
	expect(update.write.sql).toMatch(
		/CASE WHEN \$\d+::boolean THEN \$\d+::text ELSE "qp_current"\."title" END AS "title"/,
	);
	expect(update.write.sql).toContain(
		'"qp_candidate"."title" IS DISTINCT FROM "qp_current"."title"',
	);
	expect(update.write.sql).not.toContain("pg_catalog.gen_random_uuid()");
	expect(update.write.sql).not.toContain("pg_catalog.now()");
});

test("lowers object, array, and json Collection Fields as exact jsonb values", () => {
	const jsonSchema = structuredClone(schema) as any;
	const records = jsonSchema.collections.find(
		(collection: any) => collection.identity === "collection:records",
	);
	records.fields.push(
		field("collection:records", "profile", "profile", {
			kind: "object",
			properties: [
				{
					key: "displayName",
					codec: {
						kind: "text",
						minLength: 1,
						maxLength: 120,
						collation: "questpie.binary",
						nullable: false,
					},
				},
				{
					key: "verifiedAt",
					codec: { kind: "timestamp", withTimezone: true, nullable: true },
				},
			],
		}),
		field("collection:records", "tags", "tags", {
			kind: "array",
			maximumItems: 4,
			items: { kind: "text", minLength: 1, maxLength: 20, nullable: false },
		}),
		field("collection:records", "metadata", "metadata", { kind: "json" }),
	);

	const jsonPolicy = structuredClone(policyProjection) as any;
	jsonPolicy.policies[0].program.fields.callerInput.create.push(
		{ path: ["profile"], when: { kind: "constant", value: true } },
		{ path: ["tags"], when: { kind: "constant", value: true } },
	);
	const jsonOperations = structuredClone(operations) as any;
	const createOperation = jsonOperations.operations[0];
	createOperation.callerInputFields.push(["profile"], ["tags"]);
	createOperation.requiredCallerInputFields.push(["profile"], ["tags"]);
	createOperation.trustedValueFields.push(["metadata"]);
	createOperation.selectedFieldPaths.push(["profile"], ["tags"], ["metadata"]);

	const lowered = lowerPostgresCollectionOperationPlans({
		collectionOperations: jsonOperations,
		schemaProjection: jsonSchema,
		policyProjection: jsonPolicy,
		normalizerPrograms: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValuePrograms: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [serverValues],
		},
	});
	const create = lowered.plans[0]!;
	if (create.member !== "create") throw new Error("expected create plan");

	expect(create.candidate.fields).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				path: ["profile"],
				codec: {
					kind: "object",
					properties: {
						displayName: { kind: "text", minLength: 1, maxLength: 120 },
						verifiedAt: {
							kind: "nullable",
							codec: { kind: "timestamp", withTimezone: true },
						},
					},
				},
			}),
			expect.objectContaining({
				path: ["tags"],
				codec: {
					kind: "array",
					maximum: 4,
					items: { kind: "text", minLength: 1, maxLength: 20 },
				},
			}),
			expect.objectContaining({ path: ["metadata"], codec: { kind: "json" } }),
		]),
	);
	for (const fieldPath of [["profile"], ["tags"], ["metadata"]] as const) {
		const parameters = create.write.parameters.filter(
			(parameter) =>
				"path" in parameter &&
				JSON.stringify(parameter.path) === JSON.stringify(fieldPath),
		);
		expect(
			parameters.some((parameter) => parameter.postgresType === "jsonb"),
		).toBe(true);
	}
	expect(create.write.sql).toContain("::jsonb");
	expect(create.write.result).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				path: ["profile"],
				codec: expect.objectContaining({ kind: "object" }),
			}),
			expect.objectContaining({
				path: ["tags"],
				codec: expect.objectContaining({ kind: "array" }),
			}),
			expect.objectContaining({ path: ["metadata"], codec: { kind: "json" } }),
		]),
	);
});

test("lowers one create Field through either caller or trusted values", () => {
	const mergedOperations = structuredClone(operations) as any;
	const createOperation = mergedOperations.operations[0];
	createOperation.requiredCallerInputFields = [];
	createOperation.trustedValueFields = [["title"], ["body"], ["id"]];
	createOperation.requiredTrustedValueFields = [];

	const lowered = lowerPostgresCollectionOperationPlans({
		collectionOperations: mergedOperations,
		schemaProjection: schema,
		policyProjection,
		normalizerPrograms: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [normalizer],
		},
		serverValuePrograms: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [serverValues],
		},
	});
	const create = lowered.plans[0]!;
	if (create.member !== "create") throw new Error("expected create plan");
	for (const fieldPath of [["title"], ["body"]] as const) {
		expect(create.write.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "callerInputPresent",
					path: fieldPath,
				}),
				expect.objectContaining({
					kind: "trustedValuePresent",
					path: fieldPath,
				}),
			]),
		);
	}
	expect(create.write.sql).toMatch(
		/CASE WHEN \$\d+::boolean THEN \$\d+::text ELSE CASE WHEN \$\d+::boolean THEN btrim\(\$\d+::text\) ELSE NULL::text END END AS "title"/,
	);
});
