import { expect, test } from "bun:test";

import { renderGeneratedMutationData } from "../../packages/compiler/src/mutation/generated-contract";
import { requiredCreateTrustedValueFields } from "../../packages/compiler/src/mutation/operation-set";

const base = {
	identity: "mutation:tickets.create",
	kind: "mutation",
	mode: "writeTransaction",
	target: "collection:tickets",
	member: "create",
	policy: "policy:tickets.default",
	keyFields: [],
	callerInputFields: [["summary"]],
	trustedValueFields: [["id"], ["organizationId"], ["status"], ["closedAt"]],
	requiredTrustedValueFields: [["id"], ["organizationId"]],
	selectedFieldPaths: [["id"]],
	optionalSelectedFieldPaths: [],
	dataQuery: null,
	dataQueryDigest: null,
	normalizerProgramDigest: null,
	serverValueProgramDigest: null,
	outputCardinality: "one",
	limits: {
		inputBytes: 65_536,
		resultBytes: 1_048_576,
		rowsWritten: 100,
		durationMilliseconds: 5_000,
	},
} as const;

test("generated create requires only non-nullable defaultless trusted Fields", () => {
	const output = renderGeneratedMutationData(
		{ operations: [base] },
		{
			field: (_target, path) =>
				path.at(-1) === "closedAt" ? "Date | null" : "string",
			fieldIdentity: () => "string",
		},
	);
	expect(output).toContain(
		'readonly values: Readonly<{ readonly "closedAt"?: Date | null; readonly "id": string; readonly "organizationId": string; readonly "status"?: string; }>',
	);
});

test("generated create keeps the values envelope optional without required trusted Fields", () => {
	const output = renderGeneratedMutationData(
		{ operations: [{ ...base, requiredTrustedValueFields: [] }] },
		{ field: () => "string", fieldIdentity: () => "string" },
	);
	expect(output).toContain("readonly values?:");
});

test("derives required trusted create Fields after operation input filtering", () => {
	const field = (
		name: string,
		contract: Readonly<Record<string, unknown>>,
	) => ({
		path: [name],
		contract,
	});
	expect(
		requiredCreateTrustedValueFields(
			[
				field("requiredServer", {
					server: true,
					nullable: false,
					default: null,
				}),
				field("requiredImmutableServer", {
					server: true,
					immutable: true,
					nullable: false,
					default: null,
				}),
				field("nullableServer", {
					server: true,
					nullable: true,
					default: null,
				}),
				field("defaultedServer", {
					server: true,
					nullable: false,
					default: { kind: "literal", value: "ready" },
				}),
				field("caller", { nullable: false, default: null }),
			],
			[
				["requiredServer"],
				["requiredImmutableServer"],
				["nullableServer"],
				["defaultedServer"],
				["caller"],
			],
		),
	).toEqual([["requiredServer"], ["requiredImmutableServer"], ["caller"]]);
});
