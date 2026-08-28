import { expect, test } from "bun:test";

import {
	normalizeResources,
	semanticDraft,
} from "../../packages/compiler/src/model";

const codec = {
	kind: "object",
	properties: {
		amount: { kind: "numeric", precision: 9, scale: 2 },
		at: { kind: "timestamp", withTimezone: false },
		count: { kind: "bigint", minimum: "0", maximum: "99" },
		day: { kind: "date" },
		label: { kind: "text", minLength: 1, maxLength: 32 },
		metadata: { kind: "json" },
		nested: {
			kind: "array",
			maximum: 3,
			items: {
				kind: "object",
				properties: { rank: { kind: "integer", minimum: 1, maximum: 5 } },
			},
		},
	},
} as const;

function resource(input: unknown = codec) {
	return normalizeResources(
		[
			{
				logicalPath: "src/report.ts",
				exportName: "report",
				value: {
					__questpie: { category: "definition", resourceKind: "query" },
					name: "report.read",
					input,
					output: codec,
					network: true,
				},
				span: null,
				memberSpans: {},
				acceptanceSpans: [],
				packageId: null,
			},
		],
		[],
	)[0]!;
}

test("compiler preserves exact recursive Field-derived Operation codec options", () => {
	const normalized = resource();
	expect(normalized.contract.input).toEqual(codec);
	expect(normalized.contract.output).toEqual(codec);
	expect(semanticDraft([normalized])).not.toBe(
		semanticDraft([
			resource({
				...codec,
				properties: {
					...codec.properties,
					label: { ...codec.properties.label, maxLength: 31 },
				},
			}),
		]),
	);
});

test("compiler rejects malformed lossless Operation codec descriptors", () => {
	for (const hostile of [
		{ kind: "text", minLength: 2, maxLength: 1 },
		{ kind: "bigint", minimum: "01" },
		{ kind: "numeric", precision: 0, scale: 0 },
		{ kind: "timestamp", withTimezone: "false" },
		{ kind: "array", items: { kind: "text" }, maximum: 0 },
		{ kind: "json", extra: true },
	] as const)
		expect(() => resource(hostile)).toThrow(/QP-COMPOSE-013/);
});
