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

export const commentPagePlan = dataQuery<AppData["collections"]["comments"]>()({
	from: "comments",
	parameters: {
		ticketId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		ticketId: fields.ticketId,
		authorMembershipId: fields.authorMembershipId,
		body: fields.body,
		kind: fields.kind,
		createdAt: fields.createdAt,
		author: relations.author.select(({ fields: author }) => ({
			id: author.id,
			principalId: author.principalId,
			role: author.role,
		})),
	}),
	where: ({ fields, parameters }) => fields.ticketId.equal(parameters.ticketId),
	orderBy: ({ fields }) => [
		fields.createdAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
