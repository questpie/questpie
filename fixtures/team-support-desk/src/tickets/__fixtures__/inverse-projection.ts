import { codec } from "questpie";

import { tickets } from "..";
import { comments } from "../../comments";

const ticketComments = comments.list({
	first: 50,
	orderBy: { createdAt: "desc", id: "desc" },
	select: {
		id: true,
		body: true,
		createdAt: true,
		author: { select: { id: true, role: true } },
	},
});

export const ticketDetailWithComments = tickets.list({
	parameters: {
		id: codec.uuid(),
		first: codec.integer({ minimum: 1, maximum: 100 }),
		after: codec.nullable(codec.cursor()),
	},
	where: ({ row, parameters }) => row.id.equal(parameters.id),
	orderBy: { id: "asc" },
	select: { id: true, comments: ticketComments },
	page: ({ parameters }) => ({
		first: parameters.first,
		after: parameters.after,
	}),
});
