import { codec, expr } from "questpie";

import { tickets } from "./index";

export const dueTickets = tickets.list({
	parameters: {
		first: codec.integer({ minimum: 1, maximum: 1 }),
		after: codec.nullable(codec.cursor()),
	},
	where: ({ row }) =>
		expr.and(row.status.equal("open"), expr.not(row.slaFollowUpDueAt.isNull())),
	orderBy: { slaFollowUpDueAt: { direction: "asc", nulls: "last" }, id: "asc" },
	select: { id: true, slaFollowUpDueAt: true },
	page: ({ parameters }) => ({
		first: parameters.first,
		after: parameters.after,
	}),
});
