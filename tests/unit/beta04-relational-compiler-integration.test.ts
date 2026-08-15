import { expect, test } from "bun:test";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import {
	normalizeBoundPolicy,
	projectRelationalCompilation,
} from "../../packages/compiler/src/relational";
import type {
	EvaluatedExport,
	NormalizedResource,
} from "../../packages/compiler/src/types";

const span = {
	start: { line: 1, column: 14 },
	end: { line: 1, column: 27 },
} as const;

function collection(identity: `collection:${string}`): NormalizedResource {
	const name = identity.slice("collection:".length);
	return {
		identity,
		kind: "collection",
		name,
		contract: {},
		contributions: [],
		origin: {
			logicalPath: `src/${name}.ts`,
			exportName: name,
			packageId: null,
			span,
			memberSpans: {},
		},
		value: {},
	};
}

const policyValue = {
	__questpie: { category: "definition", resourceKind: "policy" },
	kind: "policy",
	name: "messages.default",
	identity: "policy:messages.default",
	target: "collection:messages",
	program: {
		identity: "policy:messages.default",
		target: "collection:messages",
		attachment: { kind: "default", requiredForNormalDataAccess: true },
		operations: {
			read: {
				admission: { kind: "authenticated" },
				rows: {
					kind: "exists",
					collection: "collection:memberships",
					scope: "evidence0",
					predicate: {
						kind: "equal",
						left: {
							kind: "field",
							scope: "evidence0",
							collection: "collection:memberships",
							path: ["companyId"],
							codec: "uuid",
						},
						right: {
							kind: "executionFact",
							source: "tenant",
							path: ["id"],
							codec: "uuid",
						},
					},
				},
			},
		},
	},
	policyScopes: [
		{ scope: "row", collection: "collection:messages", parentScope: null },
		{
			scope: "evidence0",
			collection: "collection:memberships",
			parentScope: "row",
		},
	],
} as const;

const policyResource: NormalizedResource = {
	identity: policyValue.identity,
	kind: "policy",
	name: policyValue.name,
	contract: policyValue.program,
	contributions: [],
	origin: {
		logicalPath: "src/message-policy.ts",
		exportName: "messagePolicy",
		packageId: null,
		span,
		memberSpans: {},
	},
	value: policyValue,
};

const queryExport: EvaluatedExport = {
	logicalPath: "src/message-page.ts",
	exportName: "channelMessagePage",
	packageId: null,
	span,
	memberSpans: {},
	acceptanceSpans: [],
	value: {
		kind: "dataQuery",
		templateInput: {
			from: "collection:messages",
			parameters: [
				{ kind: "cursor", name: "after", nullable: true },
				{
					kind: "scalar",
					name: "first",
					codec: { kind: "integer", minimum: null, maximum: null },
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
		},
	},
};

test("projects Policy identity and an identity-free structural dataQuery origin", () => {
	const projection = projectRelationalCompilation({
		exports: [queryExport],
		resources: [
			collection("collection:memberships"),
			collection("collection:messages"),
			policyResource,
		],
		schema: { format: "questpie.schema-projection", version: 1 },
		data: { format: "questpie.data-contract-projection", version: 1 },
	});

	expect(projection.policy).toMatchObject({
		format: "questpie.policy-projection",
		policies: [
			{
				program: { identity: "policy:messages.default" },
				scopeBindings: [
					{
						scope: "evidence0",
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
		],
	});
	expect(projection.query).toMatchObject({
		format: "questpie.query-projection",
		queries: [
			{
				template: { from: "collection:messages" },
				origin: {
					path: "src/message-page.ts",
					exportName: "channelMessagePage",
				},
			},
		],
	});
	expect(projection.structuralOrigins[0]).not.toHaveProperty("identity");
});

test("rejects a sibling exists scope used outside its lexical branch", () => {
	const invalid = structuredClone(policyValue) as Record<string, unknown>;
	const program = invalid.program as {
		operations: { read: { rows: Record<string, unknown> } };
	};
	program.operations.read.rows = {
		kind: "and",
		items: [
			program.operations.read.rows,
			{
				kind: "equal",
				left: {
					kind: "field",
					scope: "evidence0",
					collection: "collection:memberships",
					path: ["companyId"],
					codec: "uuid",
				},
				right: {
					kind: "literal",
					codec: "uuid",
					value: "00000000-0000-0000-0000-000000000000",
				},
			},
		],
	};

	expect(() => normalizeBoundPolicy(invalid)).toThrow(CompilerDiagnosticError);
	expect(() => normalizeBoundPolicy(invalid)).toThrow(
		"out-of-scope Field operand",
	);
});
