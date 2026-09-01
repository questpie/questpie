import { expect, expectTypeOf, test } from "bun:test";

import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "../../packages/questpie/src";

const comments = defineCollection({
	name: "comments",
	fields: {
		id: field.uuid({ nullable: false }),
		ticketId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false }),
		createdAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {},
});

const tickets = defineCollection({
	name: "tickets",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		comments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }),
	},
});

const child = comments.list({
	first: 50,
	where: ({ row }) => row.body.notEqual("filtered"),
	orderBy: { createdAt: "desc", id: "desc" },
	select: { id: true, body: true, createdAt: true },
});

const selected = tickets.list({
	parameters: {},
	where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
	orderBy: { id: "asc" },
	select: { id: true, comments: child },
	page: () => ({ first: undefined as never, after: undefined as never }),
});

test("authors one exact branded inverse child selection", () => {
	expect(child).toMatchObject({
		kind: "toManyList",
		source: "collection:comments",
		first: 50,
	});
	expectTypeOf<
		(typeof selected.result.nodes)[number]["comments"]
	>().toEqualTypeOf<
		readonly Readonly<{ id: string; body: string; createdAt: Date }>[]
	>();
});

comments.list({
	// @ts-expect-error child first is a literal integer from 1 through 50
	first: 51,
	orderBy: { id: "asc" },
	select: { id: true },
});

const mixed = {
	first: 1 as const,
	parameters: {},
	orderBy: { id: "asc" } as const,
	select: { id: true } as const,
	page: () => ({ first: undefined as never, after: undefined as never }),
};
// @ts-expect-error root and nested list shapes remain disjoint through variables
comments.list(mixed);
