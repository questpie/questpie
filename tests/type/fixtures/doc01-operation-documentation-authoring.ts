import {
	codec,
	constraint,
	defineCollection,
	defineCollectionOperations,
	definePolicy,
	field,
	type OperationDescription,
} from "questpie";

const input = codec.object({ id: codec.uuid() });
const output = codec.object({ id: codec.uuid(), status: codec.text() });

const exact = {
	summary: "Close an open ticket",
	examples: [{ input: { id: "ticket-id" }, output: { id: "ticket-id", status: "closed" } }],
} as const satisfies OperationDescription<
	{ readonly id: string },
	{ readonly id: string; readonly status: string }
>;

void input;
void output;
void exact;

const invalid = {
	summary: "Close an open ticket",
	examples: [
		{
			// @ts-expect-error examples inherit the Operation input type.
			input: { ticketId: "ticket-id" },
		},
	],
} as const satisfies OperationDescription<{ readonly id: string }, unknown>;

void invalid;

const tickets = defineCollection({
	name: "tickets",
	fields: {
		id: field.uuid({ nullable: false }),
		status: field.text({ nullable: false }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
const ticketPolicy = definePolicy(tickets, { name: "tickets.default" });

defineCollectionOperations(tickets, {
	name: "tickets",
	policy: ticketPolicy,
	list: { data: { kind: "dataQuery" } as never, describe: { summary: "List tickets" } },
	get: { select: { id: true }, describe: { summary: "Get a ticket" } },
	create: {
		input: ["id", "status"],
		select: { id: true, status: true },
		describe: { summary: "Create a ticket" },
	},
	update: {
		input: ["status"],
		select: { id: true, status: true },
		describe: { summary: "Update a ticket" },
	},
	delete: {
		select: { id: true },
		describe: { summary: "Delete a ticket" },
	},
});
