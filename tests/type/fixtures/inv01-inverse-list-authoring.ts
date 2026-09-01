import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

const teams = defineCollection({
	name: "teams",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {},
});
const comments = defineCollection({
	name: "comments",
	fields: {
		id: field.uuid({ nullable: false }),
		teamId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		team: relation.toOne({
			target: teams,
			fields: ["teamId"],
			references: ["id"],
		}),
	},
});
const tickets = defineCollection({
	name: "tickets",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		comments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }),
	},
});
const labels = defineCollection({
	name: "labels",
	fields: { id: field.uuid({ nullable: false }) },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {},
});

const child = comments.list({
	first: 50,
	orderBy: { id: "asc" },
	select: { id: true, team: { select: { id: true } } },
});
const query = tickets.list({
	parameters: {},
	where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
	orderBy: { id: "asc" },
	select: { id: true, comments: child },
	page: () => ({ first: undefined as never, after: undefined as never }),
});
const exact: readonly Readonly<{
	id: string;
	team: Readonly<{ id: string }> | null;
}>[] = undefined as unknown as (typeof query.result.nodes)[number]["comments"];
void exact;

const wrongSource = labels.list({
	first: 1,
	orderBy: { id: "asc" },
	select: { id: true },
});
tickets.list({
	parameters: {},
	where: ({ row }) => row.id.equal("00000000-0000-0000-0000-000000000000"),
	orderBy: { id: "asc" },
	// @ts-expect-error inverse relation accepts only its declared child Collection source
	select: { id: true, comments: wrongSource },
	page: () => ({ first: undefined as never, after: undefined as never }),
});

comments.list({
	// @ts-expect-error child first is a literal integer from 1 through 50
	first: 51,
	orderBy: { id: "asc" },
	select: { id: true },
});

const dynamicFirst: number = 10;
comments.list({
	// @ts-expect-error child first must remain a compiler-visible literal
	first: dynamicFirst,
	orderBy: { id: "asc" },
	select: { id: true },
});

// @ts-expect-error nested orderBy is required and non-empty
comments.list({
	first: 1,
	orderBy: {},
	select: { id: true },
});

comments.list({
	// @ts-expect-error nested select is required and non-empty
	first: 1,
	orderBy: { id: "asc" },
	select: {},
});

// @ts-expect-error nested select rejects unknown keys
comments.list({
	first: 1,
	orderBy: { id: "asc" },
	select: { id: true, missing: true },
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

// @ts-expect-error every child order Field must be directly selected
comments.list({
	first: 1,
	orderBy: { id: "asc" },
	select: { body: true },
});
