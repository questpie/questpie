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
	issueMappings: {
		messageEvents: { invalidKind: "deliveryUnavailable" },
	},
	handler: async ({ input, ctx, errors }) => {
		const event = await ctx.data.messageEvents.create({
			input: { messageId: input.messageId, kind: "delivered" },
			values: { occurredAt: ctx.operationTime },
		});
		if (event.id === undefined) throw errors.deliveryUnavailable();
		return { eventId: event.id };
	},
});
