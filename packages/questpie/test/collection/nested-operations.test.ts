import { describe, expect, test } from "bun:test";

import type { RelationConfig } from "../../src/server/collection/builder/types.js";
import { extractBelongsToConnectValues } from "../../src/server/collection/crud/relation-mutations/nested-operations.js";

const belongsToRelation = {
	type: "one",
	fields: [{ name: "authorId" }],
} as unknown as RelationConfig;

const resolveFieldKey = (_state: unknown, field: { name?: string }) =>
	field.name;

describe("extractBelongsToConnectValues", () => {
	test("extracts a connect value and removes the consumed relation operation", () => {
		const result = extractBelongsToConnectValues(
			{},
			{ author: { connect: { id: "author-1" } } },
			{ author: belongsToRelation },
			resolveFieldKey as never,
			{},
			{},
		);

		expect(result.regularFields).toEqual({ authorId: "author-1" });
		expect(result.nestedRelations).toEqual({});
	});

	test("removes connect while preserving mixed operations for later processing", () => {
		const create = { name: "New author" };
		const connectOrCreate = {
			where: { email: "author@example.com" },
			create,
		};
		const result = extractBelongsToConnectValues(
			{},
			{
				author: {
					connect: { id: "author-1" },
					create,
					connectOrCreate,
				},
			},
			{ author: belongsToRelation },
			resolveFieldKey as never,
			{},
			{},
		);

		expect(result.regularFields).toEqual({ authorId: "author-1" });
		expect(result.nestedRelations).toEqual({
			author: { create, connectOrCreate },
		});
	});
});
