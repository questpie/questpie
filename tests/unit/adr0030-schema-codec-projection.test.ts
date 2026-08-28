import { expect, test } from "bun:test";

import { projectCollectionFieldCodec } from "../../packages/compiler/src/codec";

test("projects one Collection Field codec through both compiler consumers", () => {
	const fieldCodec = {
		kind: "object",
		properties: [
			{
				key: "displayName",
				codec: {
					kind: "text",
					minLength: 1,
					maxLength: 120,
					nullable: false,
				},
			},
			{
				key: "aliases",
				codec: {
					kind: "array",
					maximumItems: 4,
					nullable: true,
					items: { kind: "uuid", nullable: false },
				},
			},
		],
	};

	expect(projectCollectionFieldCodec(fieldCodec, "dataContract")).toEqual({
		kind: "object",
		properties: {
			displayName: { kind: "text", minLength: 1, maxLength: 120 },
			aliases: {
				kind: "array",
				items: { kind: "uuid" },
				maximum: 4,
			},
		},
	});
	expect(projectCollectionFieldCodec(fieldCodec, "schemaProjection")).toEqual({
		kind: "object",
		properties: {
			displayName: { kind: "text", minLength: 1, maxLength: 120 },
			aliases: {
				kind: "nullable",
				codec: {
					kind: "array",
					items: { kind: "uuid" },
					maximum: 4,
				},
			},
		},
	});
});

test("keeps schema validation stricter than Data Contract compatibility", () => {
	const normalized = {
		kind: "object",
		properties: { label: { kind: "text" } },
	};
	expect(projectCollectionFieldCodec(normalized, "dataContract")).toEqual(
		normalized,
	);
	expect(() =>
		projectCollectionFieldCodec(normalized, "schemaProjection"),
	).toThrow("embedded object properties must be an array");
	expect(() =>
		projectCollectionFieldCodec(
			{ kind: "array", items: { kind: "uuid", nullable: false } },
			"schemaProjection",
		),
	).toThrow("embedded array maximumItems is invalid");
});
