import { expect, expectTypeOf, test } from "bun:test";

import {
	defineCollection,
	type ObjectSelection,
	type SelectedObject,
} from "./authoring-types";

const memberships = defineCollection({
	name: "memberships",
	fields: {
		id: { kind: "field", value: undefined as unknown as string },
		principalId: { kind: "field", value: undefined as unknown as string },
	},
	relations: {},
});

const comments = defineCollection({
	name: "comments",
	fields: {
		id: { kind: "field", value: undefined as unknown as string },
		body: {
			kind: "field",
			value: undefined as unknown as string,
			conditionalOutput: true,
		},
		createdAt: { kind: "field", value: undefined as unknown as Date },
	},
	relations: {
		author: { kind: "toOne", target: memberships },
	},
});

const auditEntries = defineCollection({
	name: "auditEntries",
	fields: {
		id: { kind: "field", value: undefined as unknown as string },
	},
	relations: {},
});

const tickets = defineCollection({
	name: "tickets",
	fields: {
		id: { kind: "field", value: undefined as unknown as string },
		title: { kind: "field", value: undefined as unknown as string },
	},
	relations: {
		comments: {
			kind: "toMany",
			inverseOf: "collection:comments/relation:ticket",
		},
	},
});

const selection = {
	id: true,
	comments: comments.list({
		first: 50,
		where: ({ row }) => row.body.equal("public reply"),
		orderBy: { createdAt: "desc", id: "desc" },
		select: {
			id: true,
			body: true,
			createdAt: true,
			author: { select: { id: true, principalId: true } },
		},
	}),
} as const satisfies ObjectSelection<
	typeof tickets.fields,
	typeof tickets.relations
>;

type TicketDetail = SelectedObject<
	typeof tickets.fields,
	typeof tickets.relations,
	typeof selection
>;

test("the child-owned list overload preserves the exact inverse array result", () => {
	expectTypeOf<TicketDetail>().toEqualTypeOf<
		Readonly<{
			id: string;
			comments: readonly Readonly<{
				id: string;
				body?: string;
				createdAt: Date;
				author: Readonly<{ id: string; principalId: string }> | null;
			}>[];
		}>
	>();
	expect(selection.comments.source).toBe("collection:comments");
});

const wrongInverseTarget: ObjectSelection<
	typeof tickets.fields,
	typeof tickets.relations
> = {
	// @ts-expect-error an auditEntries list cannot satisfy tickets.comments
	comments: auditEntries.list({
		first: 1,
		orderBy: { id: "asc" },
		select: { id: true },
	}),
};

comments.list({
	// @ts-expect-error invalid child order cannot select the root overload
	first: 1,
	// @ts-expect-error child ordering cannot name a Field from the parent
	orderBy: { title: "asc" },
	select: { id: true },
});

comments.list({
	// @ts-expect-error invalid child selection cannot select the root overload
	first: 1,
	orderBy: { id: "asc" },
	// @ts-expect-error child selection cannot name a Field from the parent
	select: { title: true },
});

comments.list({
	// @ts-expect-error invalid nested selection cannot select the root overload
	first: 1,
	orderBy: { id: "asc" },
	select: {
		author: {
			select: {
				// @ts-expect-error nested child Relation selection remains exact
				email: true,
			},
		},
	},
});

comments.list({
	// @ts-expect-error child first must be a positive literal at most 50
	first: 0,
	orderBy: { id: "asc" },
	select: { id: true },
});

comments.list({
	// @ts-expect-error child first must be at most 50
	first: 51,
	orderBy: { id: "asc" },
	select: { id: true },
});

comments.list({
	// @ts-expect-error child first must be an integer
	first: 1.5,
	orderBy: { id: "asc" },
	select: { id: true },
});

const dynamicFirst: number = 50;
comments.list({
	// @ts-expect-error a widened runtime number cannot define an artifact bound
	first: dynamicFirst,
	orderBy: { id: "asc" },
	select: { id: true },
});

const rootList = tickets.list({
	parameters: {},
	where: ({ row }) => row.id.equal("ticket-1"),
	orderBy: { id: "asc" },
	select: { id: true },
	page: () => ({ first: undefined, after: undefined }),
});

const mixedListMembers = {
	first: 1 as const,
	parameters: {},
	where: () => ({ kind: "booleanExpression" as const }),
	orderBy: { id: "asc" } as const,
	select: { id: true } as const,
	page: () => ({ first: undefined, after: undefined }),
};
if (process.env.QUESTPIE_TYPECHECK_ONLY === "1") {
	// @ts-expect-error root and nested list members remain disjoint through a variable
	comments.list(mixedListMembers);
}

test("list overloads are structurally disjoint", () => {
	expect(rootList.kind).toBe("rootList");
	expect(selection.comments.kind).toBe("toManyList");
	const unsafeList = comments.list as unknown as (
		input: Readonly<Record<string, unknown>>,
	) => unknown;
	expect(() => unsafeList(mixedListMembers)).toThrow("invalid mixed list form");
	type RootRow = NonNullable<typeof rootList.result>["nodes"][number];
	expectTypeOf<RootRow>().toEqualTypeOf<Readonly<{ id: string }>>();
});
