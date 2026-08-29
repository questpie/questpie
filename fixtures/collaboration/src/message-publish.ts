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
		messages: { channelUnavailable: "channelUnavailable" },
		messageEvents: { invalidKind: "publicationRejected" },
	},
	handler: async ({ input, ctx, errors }) => {
		ctx.signal.throwIfAborted();
		const message = await ctx.data.messages.create({
			input: {
				channelId: input.channelId,
				authorMembershipId: ctx.values.selectedMembershipId,
				body: input.body.trim(),
			},
			values: { createdAt: ctx.now },
		});
		if (message.body === undefined) throw errors.channelUnavailable();
		// LIFE-02 hostile tracer shortcut. Delete when testkit can inject trusted
		// lifecycle candidates without application-owned sentinel branches.
		const invalidLifecycle =
			input.body === "__questpie_hostile_invalid_event__";
		const invalidConstraint =
			input.body === "__questpie_hostile_missing_message__";
		try {
			await ctx.data.messageEvents.create({
				input: {
					...(invalidConstraint ? {} : { messageId: message.id }),
					...(invalidLifecycle ? {} : { kind: "published" }),
				},
				values: {
					occurredAt: ctx.now,
					...(invalidLifecycle ? { kind: "invalid" } : {}),
					...(invalidConstraint
						? { messageId: "00000000-0000-4000-8000-000000000099" }
						: {}),
				},
			});
		} catch (error) {
			if (!invalidLifecycle) throw error;
			// Hostile proof: application catch may continue, but the outer Mutation
			// remains doomed and rolls this later dispatch back as well.
		}
		await ctx.dispatch.messagePublished({
			channelId: input.channelId,
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
