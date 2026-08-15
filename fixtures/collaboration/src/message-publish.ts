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
		const membership = await ctx.data.memberships.get({
			key: {
				companyId: ctx.tenant.id,
				principalId: ctx.principal.id,
				scopeKey: "company",
			},
			select: { id: true, role: true, status: true },
		});
		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, spaceId: true },
		});
		const space = channel
			? await ctx.data.spaces.get({
					key: { id: channel.spaceId },
					select: { companyId: true },
				})
			: null;
		if (
			membership === null ||
			membership.status !== "active" ||
			channel === null ||
			space === null ||
			space.companyId !== ctx.tenant.id
		)
			throw errors.channelUnavailable();
		const message = await ctx.data.messages.create({
			input: {
				id: ctx.callId,
				channelId: channel.id,
				authorMembershipId: membership.id,
				body: input.body.trim(),
				createdAt: ctx.operationTime,
				auditId: ctx.callId,
				auditedAt: ctx.operationTime,
			},
			select: { id: true, channelId: true, body: true, createdAt: true },
		});
		await ctx.data.messageEvents.create({
			input: {
				id: crypto.randomUUID(),
				messageId: message.id,
				kind: "published",
				occurredAt: ctx.operationTime,
			},
			select: { id: true },
		});
		await ctx.dispatch.messagePublished({
			companyId: ctx.tenant.id,
			messageId: message.id,
		});
		return message;
	},
});
