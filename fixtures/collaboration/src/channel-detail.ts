import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { channels } from "./channels";
import { messages } from "./messages";

export const channelDetailPlan = channels.list({
	parameters: {
		id: codec.uuid(),
		first: codec.integer({ minimum: 1, maximum: 1 }),
		after: codec.nullable(codec.cursor()),
	},
	where: ({ row, parameters }) => row.id.equal(parameters.id),
	orderBy: { id: "asc" },
	select: {
		id: true,
		spaceId: true,
		name: true,
		messages: messages.list({
			first: 50,
			orderBy: { createdAt: "desc", id: "desc" },
			select: {
				id: true,
				channelId: true,
				authorMembershipId: true,
				body: true,
				createdAt: true,
			},
		}),
	},
	page: ({ parameters }) => ({
		first: parameters.first,
		after: parameters.after,
	}),
});

const channelDetailCodec = codec.object({
	id: codec.uuid(),
	spaceId: codec.uuid(),
	name: codec.text(),
	messages: codec.array(
		codec.object({
			id: codec.uuid(),
			channelId: codec.uuid(),
			authorMembershipId: codec.uuid(),
			body: codec.optional(codec.text()),
			createdAt: codec.timestamp(),
		}),
	),
});

export const channelDetail = defineQuery({
	name: "channels.detail",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.nullable(channelDetailCodec),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(channelDetailPlan, {
			id: input.id,
			first: 1,
			after: null,
		});
		const channel = page.nodes[0];
		return channel
			? {
					...channel,
					messages: channel.messages.map((message) => ({
						...message,
						createdAt: new Date(message.createdAt),
					})),
				}
			: null;
	},
});
