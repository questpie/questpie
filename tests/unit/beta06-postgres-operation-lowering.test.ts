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
				field("collection:records", "body", "body", {
					kind: "text",
					minLength: 1,
					maxLength: 8_192,
					collation: "questpie.binary",
				}),
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
				kind: "executionFact",
				source: "principal",
				path: ["id"],
			}),
			expect.objectContaining({ kind: "literal", value: "classified" }),
		]),
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
