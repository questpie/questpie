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
				createdAt: Date;
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

test("authors bounded integer, list, and opaque cursor codecs", () => {
	const filters = codec.object({
		first: codec.integer({ minimum: 1, maximum: 100 }),
		statuses: codec.list(codec.text(), { maximum: 8 }),
		after: codec.nullable(codec.cursor()),
	});

	expect(filters).toEqual({
		kind: "object",
		properties: {
			first: { kind: "integer", minimum: 1, maximum: 100 },
			statuses: {
				kind: "array",
				items: { kind: "text" },
				maximum: 8,
			},
			after: { kind: "nullable", codec: { kind: "cursor" } },
		},
	});
	expectTypeOf<CodecValue<typeof filters>>().toEqualTypeOf<
		Readonly<{
			first: number;
			statuses: readonly string[];
			after: string | null;
		}>
	>();
});

test("rejects invalid public codec bounds", () => {
	expect(() => codec.integer({ minimum: 2, maximum: 1 })).toThrow(
		"minimum must not exceed maximum",
	);
	expect(() => codec.integer({ minimum: 1.5 })).toThrow(
		"minimum must be a safe integer",
	);
	expect(() => codec.list(codec.text(), { maximum: 0 })).toThrow(
		"maximum must be a positive safe integer",
	);
});
