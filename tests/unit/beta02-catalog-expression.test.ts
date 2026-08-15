import { expect, test } from "bun:test";

import {
	parseCatalogCheck,
	parseCatalogDefault,
} from "../../packages/compiler/src/schema/postgres/catalog-expression";

test("parses the closed PostgreSQL default and check expression grammar", () => {
	expect(
		[
			null,
			"gen_random_uuid()",
			"now()",
			"true",
			"42",
			"1.25",
			"'it''s canonical'::text",
		].map(parseCatalogDefault),
	).toEqual([
		null,
		{ kind: "randomUuid" },
		{ kind: "now" },
		{ kind: "literal", value: true },
		{ kind: "literal", value: 42 },
		{ kind: "literal", value: 1.25 },
		{ kind: "literal", value: "it's canonical" },
	]);

	expect(
		parseCatalogCheck(
			'CHECK ((char_length("body") > 1) AND ("endsAt" > "startsAt") AND ("body" IS NOT NULL))',
		),
	).toEqual({
		kind: "and",
		expressions: [
			{
				kind: "compare",
				operator: "greaterThan",
				left: {
					kind: "textLength",
					expression: { kind: "field", field: "body" },
				},
				right: { kind: "literal", value: 1 },
			},
			{
				kind: "compare",
				operator: "greaterThan",
				left: { kind: "field", field: "endsAt" },
				right: { kind: "field", field: "startsAt" },
			},
			{
				kind: "isNotNull",
				expression: { kind: "field", field: "body" },
			},
		],
	});
	expect(parseCatalogCheck("CHECK (lower(body) = 'x'::text)")).toBeNull();
	expect(parseCatalogCheck("ends_at > starts_at")).toEqual({
		kind: "compare",
		operator: "greaterThan",
		left: { kind: "field", field: "ends_at" },
		right: { kind: "field", field: "starts_at" },
	});
});
