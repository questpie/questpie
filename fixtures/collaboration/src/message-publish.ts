import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const publishMessage = defineMutation({
	name: "message.publish",
	network: true,
	input: codec.object({
		channelId: codec.uuid(),
		body: codec.text(),
	}),
	output: codec.object({
		id: codec.uuid(),
		channelId: codec.uuid(),
		body: codec.text(),
		createdAt: codec.timestamp(),
	}),
	policy: policy.authenticated(),
	errors: {
		channelUnavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
		idempotencyConflict: operation.error({
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: codec.object({ callId: codec.uuid() }),
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		ctx.signal.throwIfAborted();
		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
		});
		const space = channel
			? await ctx.data.spaces.get({
					key: { id: channel.spaceId },
				})
			: null;
		if (channel === null || space === null || space.companyId !== ctx.tenant.id)
			throw errors.channelUnavailable();
		const message = await ctx.data.messages.create({
			input: {
				channelId: channel.id,
				authorMembershipId: ctx.values.selectedMembershipId,
				body: input.body,
			},
		});
		if (message.body === undefined) throw errors.channelUnavailable();
		await ctx.data.messageEvents.create({
			input: {
				messageId: message.id,
				kind: "published",
			},
		});
		await ctx.dispatch.messagePublished({
			companyId: ctx.tenant.id,
			messageId: message.id,
		});
		return {
			id: message.id,
			channelId: message.channelId,
			body: message.body,
			createdAt: message.createdAt,
		};
	},
});
