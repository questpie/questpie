import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const recordMessageDelivery = defineMutation({
	name: "message.recordDelivery",
	input: codec.object({ messageId: codec.uuid() }),
	output: codec.object({ eventId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: {
		deliveryUnavailable: operation.error({
			code: "DELIVERY_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const event = await ctx.data.messageEvents.create({
			input: { messageId: input.messageId, kind: "delivered" },
		});
		if (event.id === undefined) throw errors.deliveryUnavailable();
		return { eventId: event.id };
	},
});
