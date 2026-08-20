import { dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

export const archiveRecordPage = dataQuery<AppData["collections"]["records"]>()(
	{
		from: "records",
		parameters: {
			archiveCode: query.parameter.text({ nullable: false }),
			first: query.parameter.integer({
				nullable: false,
				minimum: 1,
				maximum: 100,
			}),
			after: query.parameter.cursor({ nullable: true }),
		},
		select: ({ fields }) => ({
			archiveCode: fields.archiveCode,
			catalogueNumber: fields.catalogueNumber,
			visibility: fields.visibility,
			title: fields.title,
			body: fields.body,
			createdAt: fields.createdAt,
		}),
		where: ({ fields, parameters }) =>
			fields.archiveCode.equal(parameters.archiveCode),
		orderBy: ({ fields }) => [
			fields.archiveCode.ascending({ nulls: "last" }),
			fields.catalogueNumber.descending({ nulls: "last" }),
		],
		page: ({ parameters }) =>
			query.forwardCursor({ first: parameters.first, after: parameters.after }),
	},
);
