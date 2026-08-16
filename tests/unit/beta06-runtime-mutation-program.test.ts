import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { linkCollectionMutationPrograms } from "../../packages/runtime/src/mutation";
import { canonicalMutationBytes } from "../../packages/runtime/src/mutation/canonical";

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

const normalizer = {
	artifact: "questpie.field-normalizer-program",
	version: 1,
	target: "collection:messages",
	operation: "create",
	steps: [
		{
			target: ["title"],
			expression: { kind: "trim", source: ["title"] },
		},
	],
	capabilities: [],
} as const;

const serverValues = {
	artifact: "questpie.server-value-program",
	version: 1,
	target: "collection:messages",
	operation: "create",
	assignments: [
		{
			target: ["tenantId"],
			mode: "overwrite",
			source: ["tenant", "id"],
		},
	],
	capabilities: [],
} as const;

const operation = {
	identity: "mutation:messages.create",
	kind: "mutation",
	mode: "writeTransaction",
	target: "collection:messages",
	member: "create",
	policy: "policy:messages.default",
	keyFields: [],
	callerInputFields: [["body"], ["title"]],
	selectedFieldPaths: [["id"], ["title"]],
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
} as const;

const listQuery = {
	format: "questpie.data-query-template",
	version: 1,
	from: "collection:messages",
	schemaProjectionDigest: "a".repeat(64),
	dataContractProjectionDigest: "b".repeat(64),
	parameters: [
		{
			name: "after",
			kind: "cursor",
			nullable: true,
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
			kind: "field",
			key: "id",
			field: "collection:messages/field:id",
		},
	],
	filter: null,
	order: [
		{
			field: "collection:messages/field:id",
			direction: "asc",
			nulls: "last",
		},
	],
	page: {
		kind: "forwardCursor",
		first: { kind: "parameter", parameter: "first" },
		after: { kind: "parameter", parameter: "after" },
		uniqueConstraint: "collection:messages/constraint:primary",
	},
} as const;

const listOperation = {
	identity: "query:messages.list",
	kind: "query",
	mode: "readSnapshot",
	target: "collection:messages",
	member: "list",
	policy: "policy:messages.default",
	keyFields: [],
	callerInputFields: [["after"], ["first"]],
	selectedFieldPaths: [["id"]],
	dataQuery: listQuery,
	dataQueryDigest: digest("questpie-data-query-template-v1", listQuery),
	normalizerProgramDigest: null,
	serverValueProgramDigest: null,
	outputCardinality: "many",
	limits: {
		inputBytes: 65_536,
		resultBytes: 1_048_576,
		rowsRead: 10_000,
		durationMilliseconds: 5_000,
	},
} as const;

function artifacts() {
	return {
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [structuredClone(operation), structuredClone(listOperation)],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [structuredClone(normalizer)],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [structuredClone(serverValues)],
		},
		policies: [
			{
				identity: "policy:messages.default",
				target: "collection:messages",
			},
		],
	};
}

test("links exact plan-owned Collection Mutation programs", () => {
	const linked = linkCollectionMutationPrograms(artifacts());
	const create = linked.byTarget.get("collection:messages")?.get("create");

	expect(linked.operations.map(({ identity }) => identity)).toEqual([
		"mutation:messages.create",
		"query:messages.list",
	]);
	expect(create?.limits.rowsWritten).toBe(100);
	expect(create?.normalizerProgram?.steps[0]?.expression.kind).toBe("trim");
	expect(create?.serverValueProgram?.assignments[0]?.source).toEqual([
		"tenant",
		"id",
	]);
	expect(Object.isFrozen(create)).toBe(true);
});

test("reconstructs and deeply freezes a linked Data Query", () => {
	const input = artifacts();
	const linked = linkCollectionMutationPrograms(input);
	const query = linked.byTarget
		.get("collection:messages")
		?.get("list")?.dataQuery;
	if (!query) throw new TypeError("fixture has no linked Data Query");

	expect(Object.isFrozen(query)).toBe(true);
	expect(Object.isFrozen(query.parameters)).toBe(true);
	expect(Object.isFrozen(query.page)).toBe(true);
	input.collectionOperations.operations[1]!.dataQuery!.parameters.push({
		name: "smuggled",
		kind: "cursor",
		nullable: true,
	});
	expect(query.parameters).toHaveLength(2);
});

test("rejects an out-of-range scalar codec in a linked Data Query", () => {
	const input = artifacts();
	const list = input.collectionOperations.operations[1]!;
	const parameter = list.dataQuery!.parameters[1]!;
	if (parameter.kind !== "scalar" || parameter.codec.kind !== "integer")
		throw new TypeError("fixture has no integer scalar parameter");
	parameter.codec.minimum = -2_147_483_649;
	list.dataQueryDigest = digest(
		"questpie-data-query-template-v1",
		list.dataQuery,
	);

	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"bounds are invalid",
	);
});

test("rejects an unknown envelope member", () => {
	const input = artifacts();
	Object.assign(input.collectionOperations, { collections: [] });
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"collection-operation programs has invalid keys",
	);
});

test("rejects a recomputed program with the wrong linked digest", () => {
	const input = artifacts();
	input.fieldNormalizers.programs[0]!.steps[0]!.expression.kind =
		"trimIfPresent";
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"invalid normalizer link",
	);
});

test("rejects a Policy attached to a different Collection", () => {
	const input = artifacts();
	input.policies[0]!.target = "collection:channels";
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"invalid Policy link",
	);
});

test("rejects an operation kind/member mismatch", () => {
	const input = artifacts();
	input.collectionOperations.operations[0]!.kind = "query";
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"kind, mode, member, or cardinality is invalid",
	);
});

test("rejects a widened rows-written limit", () => {
	const input = artifacts();
	input.collectionOperations.operations[0]!.limits.rowsWritten = 101;
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"limits are invalid",
	);
});

test("rejects duplicate operation owners", () => {
	const input = artifacts();
	input.collectionOperations.operations.splice(
		1,
		0,
		structuredClone(input.collectionOperations.operations[0]!),
	);
	expect(() => linkCollectionMutationPrograms(input)).toThrow("duplicated");
});

test("rejects an unknown nested Data Query member even with a matching digest", () => {
	const input = artifacts();
	const list = input.collectionOperations.operations[1]!;
	Object.assign(list.dataQuery!, { rawSql: "select *" });
	list.dataQueryDigest = digest(
		"questpie-data-query-template-v1",
		list.dataQuery,
	);
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"dataQuery keys is invalid",
	);
});

test("rejects an unreferenced write program", () => {
	const input = artifacts();
	input.collectionOperations.operations[0]!.normalizerProgramDigest = null;
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"write program must be referenced exactly once",
	);
});
