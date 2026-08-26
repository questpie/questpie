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

export const teamListPlan = dataQuery<AppData["collections"]["teams"]>()({
	from: "teams",
	parameters: {
		organizationId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields }) => ({
		id: fields.id,
		organizationId: fields.organizationId,
		name: fields.name,
		routingStatus: fields.routingStatus,
	}),
	where: ({ fields, parameters }) =>
		fields.organizationId.equal(parameters.organizationId),
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
