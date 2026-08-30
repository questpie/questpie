import { codec, policy } from "questpie";

import { defineMutation } from "#questpie/app";

import { teams } from "./teams";

export const updateTeam = defineMutation({
	name: "teams.update",
	input: codec.object({
		key: codec.object({ id: codec.uuid() }),
		patch: teams.updateInput().pick({ name: true, routingStatus: true }),
	}),
	output: codec.nullable(
		codec.object({
			id: codec.uuid(),
			name: codec.text(),
			routingStatus: codec.text(),
			updatedAt: codec.timestamp(),
		}),
	),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const team = await ctx.data.teams.update({
			key: input.key,
			patch: {
				...(input.patch.name === undefined ? {} : { name: input.patch.name }),
				...(input.patch.routingStatus === undefined
					? {}
					: { routingStatus: input.patch.routingStatus }),
			},
			values: { updatedAt: ctx.now },
		});
		return team === null
			? null
			: {
					id: team.id,
					name: team.name,
					routingStatus: team.routingStatus,
					updatedAt: team.updatedAt,
				};
	},
});
