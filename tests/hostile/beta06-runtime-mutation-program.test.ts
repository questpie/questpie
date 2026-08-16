import { expect, test } from "bun:test";

import { linkCollectionMutationPrograms } from "../../packages/runtime/src/mutation";

function emptyArtifacts() {
	return {
		collectionOperations: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: [],
		},
		fieldNormalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: [],
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: [],
		},
		policies: [],
	};
}

test("rejects a capability smuggled into a closed normalizer program", () => {
	const input = emptyArtifacts();
	input.fieldNormalizers.programs.push({
		artifact: "questpie.field-normalizer-program",
		version: 1,
		target: "collection:messages",
		operation: "create",
		steps: [],
		capabilities: ["databaseHandle"],
	});
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"normalizer program 0 header is invalid",
	);
});

test("rejects a duplicate Policy identity before it can redirect a link", () => {
	const input = emptyArtifacts();
	input.policies.push(
		{
			identity: "policy:messages.default",
			target: "collection:messages",
		},
		{
			identity: "policy:messages.default",
			target: "collection:channels",
		},
	);
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"Policy identity policy:messages.default is duplicated",
	);
});

test("rejects an extra Policy-link member", () => {
	const input = emptyArtifacts();
	input.policies.push({
		identity: "policy:messages.default",
		target: "collection:messages",
		digest: "a".repeat(64),
	});
	expect(() => linkCollectionMutationPrograms(input)).toThrow(
		"Policy link 0 has invalid keys",
	);
});
