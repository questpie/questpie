import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

export const messageById = defineQuery({
	name: "messages.byId",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ id: codec.uuid(), body: codec.text() }),
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.get({ key: { id: input.id } });
		if (!message) throw new Error("message not found");
		return { id: message.id, body: message.body };
	},
});
