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
	callerInputFields: [["summary"], ["description"], ["priority"]],
	requiredCallerInputFields: [["summary"]],
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
	expect(output).toContain(
		'readonly input: Readonly<{ readonly "description"?: string; readonly "priority"?: string; readonly "summary": string; }>',
	);
});

test("generated create keeps the values envelope optional without required trusted Fields", () => {
	const output = renderGeneratedMutationData(
		{ operations: [{ ...base, requiredTrustedValueFields: [] }] },
		{ field: () => "string", fieldIdentity: () => "string" },
	);
	expect(output).toContain("readonly values?:");
});

test("generated create requires every parent of a required nested Field", () => {
	const output = renderGeneratedMutationData(
		{
			operations: [
				{
					...base,
					callerInputFields: [
						["profile", "name"],
						["profile", "nickname"],
					],
					requiredCallerInputFields: [["profile", "name"]],
					trustedValueFields: [["audit", "createdBy"]],
					requiredTrustedValueFields: [["audit", "createdBy"]],
				},
			],
		},
		{ field: () => "string", fieldIdentity: () => "string" },
	);
	expect(output).toContain(
		'readonly input: Readonly<{ readonly "profile": Readonly<{ readonly "name": string; readonly "nickname"?: string; }>; }>',
	);
	expect(output).toContain(
		'readonly values: Readonly<{ readonly "audit": Readonly<{ readonly "createdBy": string; }>; }>',
	);
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

test("derives required caller create Fields after provenance filtering", async () => {
	const { requiredCreateCallerInputFields } =
		await import("../../packages/compiler/src/mutation/operation-set");
	const field = (
		name: string,
		contract: Readonly<Record<string, unknown>>,
	) => ({ path: [name], contract });
	expect(
		requiredCreateCallerInputFields(
			[
				field("required", { nullable: false, default: null }),
				field("nullable", { nullable: true, default: null }),
				field("defaulted", {
					nullable: false,
					default: { kind: "literal", value: "normal" },
				}),
				field("trustedRequired", { nullable: false, default: null }),
			],
			[["required"], ["nullable"], ["defaulted"]],
		),
	).toEqual([["required"]]);
});
