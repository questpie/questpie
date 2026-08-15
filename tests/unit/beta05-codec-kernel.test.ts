import { expect, expectTypeOf, test } from "bun:test";

import { codec, type CodecValue } from "../../packages/questpie/src";

const page = codec.object({
	nodes: codec.array(
		codec.object({
			body: codec.optional(codec.text()),
			createdAt: codec.timestamp(),
		}),
	),
	pageInfo: codec.object({
		endCursor: codec.nullable(codec.text()),
		hasNextPage: codec.boolean(),
	}),
});

test("projects one recursive built-in codec grammar for the Message page", () => {
	expect(page).toEqual({
		kind: "object",
		properties: {
			nodes: {
				kind: "array",
				items: {
					kind: "object",
					properties: {
						body: {
							kind: "optional",
							presence: "optional",
							codec: { kind: "text" },
						},
						createdAt: { kind: "timestamp" },
					},
				},
			},
			pageInfo: {
				kind: "object",
				properties: {
					endCursor: { kind: "nullable", codec: { kind: "text" } },
					hasNextPage: { kind: "boolean" },
				},
			},
		},
	});
	expectTypeOf<CodecValue<typeof page>>().toEqualTypeOf<
		Readonly<{
			nodes: readonly Readonly<{
				body?: string;
				createdAt: string;
			}>[];
			pageInfo: Readonly<{
				endCursor: string | null;
				hasNextPage: boolean;
			}>;
		}>
	>();
});

test("uses wrappers as the only nullable and optional representation", () => {
	expect(codec.text()).toEqual({ kind: "text" });
	expect(codec.nullable(codec.text())).toEqual({
		kind: "nullable",
		codec: { kind: "text" },
	});
	expect(codec.optional(codec.text())).toEqual({
		kind: "optional",
		presence: "optional",
		codec: { kind: "text" },
	});
});
