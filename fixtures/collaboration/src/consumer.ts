import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import { channelMessagePage } from "./message-page";

export const messagePage = defineQuery({
	name: "messages.page",
	network: true,
	input: codec.object({
		channelId: codec.uuid(),
		first: codec.integer(),
		after: codec.nullable(codec.text()),
	}),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				author: codec.nullable(
					codec.object({ id: codec.uuid(), role: codec.text() }),
				),
				body: codec.optional(codec.text()),
				createdAt: codec.timestamp(),
				id: codec.uuid(),
			}),
		),
		pageInfo: codec.object({
			endCursor: codec.nullable(codec.text()),
			hasNextPage: codec.boolean(),
		}),
	}),
	handler: async ({ input, ctx }) => {
		return ctx.data.run(channelMessagePage, input);
	},
});
