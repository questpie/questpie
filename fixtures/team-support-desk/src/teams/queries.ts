import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { teamListPlan } from "./query-plan";

const pageInfoCodec = codec.object({
	endCursor: codec.nullable(codec.text()),
	hasNextPage: codec.boolean(),
});

const pageInputCodec = {
	first: codec.integer(),
	after: codec.nullable(codec.cursor()),
} as const;

export const listTeams = defineQuery({
	name: "teams.list",
	network: true,
	input: codec.object({ organizationId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				organizationId: codec.uuid(),
				name: codec.text(),
				routingStatus: codec.text(),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: ({ input, ctx }) => ctx.data.run(teamListPlan, input),
});
