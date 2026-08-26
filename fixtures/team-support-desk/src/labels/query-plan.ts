import { dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

const pageParameters = {
	first: query.parameter.integer({
		nullable: false,
		minimum: 1,
		maximum: 100,
	}),
	after: query.parameter.cursor({ nullable: true }),
} as const;

export const labelPagePlan = dataQuery<AppData["collections"]["labels"]>()({
	from: "labels",
	parameters: {
		ticketId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields }) => ({
		id: fields.id,
		organizationId: fields.organizationId,
		ticketId: fields.ticketId,
		name: fields.name,
		color: fields.color,
		createdAt: fields.createdAt,
	}),
	where: ({ fields, parameters }) => fields.ticketId.equal(parameters.ticketId),
	orderBy: ({ fields }) => [
		fields.name.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
