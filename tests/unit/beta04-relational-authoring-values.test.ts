import { expect, test } from "bun:test";

import { dataQuery, query } from "questpie";

test("preserves integer parameter bounds for compiler normalization", () => {
	expect(
		query.parameter.integer({ nullable: false, minimum: 1, maximum: 100 }),
	).toEqual({
		kind: "parameter",
		parameterKind: "integer",
		nullable: false,
		minimum: 1,
		maximum: 100,
	});
});

test("keeps structural Data Queries unbranded while retaining their authored template", () => {
	const descriptor = dataQuery<{
		name: "messages";
		identity: "collection:messages";
		fields: {};
		uniqueConstraints: {};
		relations: {};
	}>()({
		from: "messages",
		parameters: {
			first: query.parameter.integer({
				nullable: false,
				minimum: 1,
				maximum: 100,
			}),
			after: query.parameter.cursor({ nullable: true }),
		},
		select: () => ({}),
		where: null,
		orderBy: () => [] as never,
		page: ({ parameters }) =>
			query.forwardCursor({ first: parameters.first, after: parameters.after }),
	});

	expect(Object.keys(descriptor)).toEqual(["kind", "template"]);
	expect("__questpie" in descriptor).toBe(false);
	expect(
		(descriptor as unknown as { template: { parameters: unknown } }).template
			.parameters,
	).toEqual({
		first: {
			kind: "parameter",
			parameterKind: "integer",
			nullable: false,
			minimum: 1,
			maximum: 100,
		},
		after: { kind: "parameter", parameterKind: "cursor", nullable: true },
	});
});
