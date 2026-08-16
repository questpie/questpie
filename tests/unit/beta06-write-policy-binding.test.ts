import { expect, test } from "bun:test";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import { normalizeBoundPolicy } from "../../packages/compiler/src/relational";

const field = (scope: string, collection: string, path: string) => ({
	kind: "field" as const,
	scope,
	collection,
	path: [path],
	codec: "uuid",
});

const literal = {
	kind: "literal" as const,
	codec: "uuid",
	value: "00000000-0000-0000-0000-000000000000",
};

const valid = {
	program: {
		identity: "policy:messages.default",
		target: "collection:messages",
		attachment: { kind: "default", requiredForNormalDataAccess: true },
		operations: {
			create: {
				admission: { kind: "authenticated" },
				candidate: {
					kind: "exists",
					collection: "collection:memberships",
					scope: "evidence0",
					semantics: "policyEvidenceBooleanOnly",
					targetDisclosurePolicy: "notApplied",
					predicate: {
						kind: "equal",
						left: field("evidence0", "collection:memberships", "companyId"),
						right: field("candidate", "collection:messages", "channelId"),
					},
				},
			},
			update: {
				admission: { kind: "authenticated" },
				current: {
					kind: "equal",
					left: field("current", "collection:messages", "id"),
					right: literal,
				},
				candidate: {
					kind: "equal",
					left: field("candidate", "collection:messages", "channelId"),
					right: field("current", "collection:messages", "channelId"),
				},
			},
		},
		fields: {
			callerInput: {
				suppliedPathsOnly: true,
				create: [
					{
						path: ["channelId"],
						when: {
							kind: "equal",
							left: field("candidate", "collection:messages", "channelId"),
							right: literal,
						},
					},
				],
				update: [],
			},
			selectedOutput: [],
		},
	},
	policyScopes: [
		{
			scope: "candidate",
			collection: "collection:messages",
			parentScope: null,
		},
		{
			scope: "current",
			collection: "collection:messages",
			parentScope: null,
		},
		{
			scope: "evidence0",
			collection: "collection:memberships",
			parentScope: "candidate",
		},
	],
} as const;

test("validates write Policy expressions in their exact lexical scopes", () => {
	const bound = normalizeBoundPolicy(valid);
	expect(bound.program.operations.create?.candidate).toMatchObject({
		kind: "exists",
		scope: "evidence0",
	});
	expect(bound.program.operations.update?.candidate).toMatchObject({
		kind: "equal",
	});
});

test("rejects current-row authority leaking into a create candidate rule", () => {
	const invalid = structuredClone(valid);
	const candidate = invalid.program.operations.create.candidate.predicate;
	candidate.right = field("current", "collection:messages", "channelId");
	expect(() => normalizeBoundPolicy(invalid)).toThrow(CompilerDiagnosticError);
	expect(() => normalizeBoundPolicy(invalid)).toThrow(
		"out-of-scope Field operand",
	);
});
