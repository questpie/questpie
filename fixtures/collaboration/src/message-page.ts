import { dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

export const channelMessagePage = dataQuery<
	AppData["collections"]["messages"]
>()({
	from: "messages",
	parameters: {
		channelId: query.parameter.uuid({ nullable: false }),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		body: fields.body,
		createdAt: fields.createdAt,
		author: relations.author.select(({ fields: author }) => ({
			id: author.id,
			role: author.role,
		})),
	}),
	where: ({ fields, parameters }) =>
		fields.channelId.equal(parameters.channelId),
	orderBy: ({ fields }) => [fields.id.descending({ nulls: "last" })],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
