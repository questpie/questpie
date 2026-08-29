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
		publicationRejected: operation.error({
			code: "PUBLICATION_REJECTED",
			status: 422,
		}),
		channelUnavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
		idempotencyConflict: operation.error({
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: codec.object({ callId: codec.text() }),
		}),
	},
	issueMappings: {
		messageEvents: { invalidKind: "publicationRejected" },
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
				body: input.body.trim(),
			},
			values: { createdAt: ctx.operationTime },
		});
		if (message.body === undefined) throw errors.channelUnavailable();
		// LIFE-02 hostile tracer shortcut. Delete when testkit can inject trusted
		// lifecycle candidates without application-owned sentinel branches.
		const invalidLifecycle =
			input.body === "__questpie_hostile_invalid_event__";
		const invalidConstraint =
			input.body === "__questpie_hostile_missing_message__";
		await ctx.data.messageEvents.create({
			input: {
				...(invalidConstraint ? {} : { messageId: message.id }),
				...(invalidLifecycle ? {} : { kind: "published" }),
			},
			values: {
				occurredAt: ctx.operationTime,
				...(invalidLifecycle ? { kind: "invalid" } : {}),
				...(invalidConstraint
					? { messageId: "00000000-0000-4000-8000-000000000099" }
					: {}),
			},
		});
		await ctx.dispatch.messagePublished({
			channelId: channel.id,
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
