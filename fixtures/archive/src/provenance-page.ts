import { dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

export const recordProvenancePage = dataQuery<
	AppData["collections"]["provenance"]
>()({
	from: "provenance",
	parameters: {
		archiveCode: query.parameter.text({ nullable: false }),
		catalogueNumber: query.parameter.text({ nullable: false }),
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
		sequence: fields.sequence,
		kind: fields.kind,
		note: fields.note,
		recordedAt: fields.recordedAt,
	}),
	where: ({ fields, parameters }) =>
		query.and(
			fields.archiveCode.equal(parameters.archiveCode),
			fields.catalogueNumber.equal(parameters.catalogueNumber),
		),
	orderBy: ({ fields }) => [
		fields.archiveCode.ascending({ nulls: "last" }),
		fields.catalogueNumber.ascending({ nulls: "last" }),
		fields.sequence.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
});
