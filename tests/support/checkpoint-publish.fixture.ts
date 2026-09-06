import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

// Compiled only inside the disposable PostgreSQL checkpoint tracer.
export const publishMessage = defineMutation({
	name: "message.publish",
	network: true,
	input: codec.object({
		channelId: codec.uuid(),
		body: codec.text(),
		metadata: codec.object({
			at: codec.timestamp(),
			note: codec.optional(codec.text()),
		}),
	}),
	output: codec.object({
		id: codec.uuid(),
		channelId: codec.uuid(),
		body: codec.text(),
		createdAt: codec.timestamp(),
	}),
	policy: policy.authenticated(),
	errors: {
		afterWriteRejected: operation.error({
			code: "AFTER_WRITE_REJECTED",
			status: 422,
		}),
		publicationRejected: operation.error({
			code: "PUBLICATION_REJECTED",
			status: 422,
		}),
		channelUnavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
	},
	issueMappings: {
		messages: { channelUnavailable: "channelUnavailable" },
		messageEvents: { invalidKind: "publicationRejected" },
	},
	handler: async ({ input, ctx, errors }) => {
		const message = await ctx.data.messages.create({
			input: {
				channelId: input.channelId,
				authorMembershipId: ctx.values.selectedMembershipId,
				body: input.body,
			},
			values: { createdAt: input.metadata.at },
		});
		if (message.body === undefined) throw errors.channelUnavailable();
		if (input.metadata.note === "reject-after-write")
			throw errors.afterWriteRejected();
		return {
			id: message.id,
			channelId: message.channelId,
			// The fixed UUID/timestamp output frame is 146 canonical UTF-8 bytes.
			body: input.metadata.note?.startsWith("result-limit")
				? "é".repeat(524_215) +
					(input.metadata.note === "result-limit-over" ? "x" : "")
				: message.body,
			createdAt: message.createdAt,
		};
	},
});
