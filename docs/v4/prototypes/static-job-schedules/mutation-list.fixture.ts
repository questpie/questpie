import { codec, defineCollectionOperations, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

import { messagePolicy } from "./message-policy";
import { messages } from "./messages";

export const messageScanPage = messages.list({
	parameters: {
		channelId: codec.uuid(),
		first: codec.integer({ minimum: 1, maximum: 10 }),
		after: codec.nullable(codec.cursor()),
	},
	where: ({ row, parameters }) => row.channelId.equal(parameters.channelId),
	orderBy: { createdAt: "desc", id: "desc" },
	select: { id: true, createdAt: true },
	page: ({ parameters }) => ({
		first: parameters.first,
		after: parameters.after,
	}),
});
export const messageScan = defineCollectionOperations(messages, {
	name: "messageScan",
	policy: messagePolicy,
	list: { data: messageScanPage },
});

export const probeList = defineMutation({
	name: "message.probeList",
	network: false,
	policy: policy.authenticated(),
	input: codec.object({
		channelId: codec.uuid(),
		first: codec.integer({ minimum: 1, maximum: 10 }),
		after: codec.nullable(codec.cursor()),
		write: codec.boolean(),
		exhaust: codec.boolean(),
		extra: codec.boolean(),
	}),
	output: codec.object({
		nodes: codec.list(
			codec.object({ id: codec.uuid(), createdAt: codec.timestamp() }),
			{ maximum: 10 },
		),
		pageInfo: codec.object({
			endCursor: codec.nullable(codec.cursor()),
			hasNextPage: codec.boolean(),
		}),
	}),
	errors: {
		invalid: operation.error({ code: "LIST_WRITE_INVALID", status: 422 }),
	},
	issueMappings: {
		messages: { channelUnavailable: "invalid" },
		messageEvents: { invalidKind: "invalid" },
	},
	handler: async ({ input, ctx }) => {
		if (input.write)
			await ctx.data.messages.create({
				input: {
					channelId: input.channelId,
					authorMembershipId: ctx.values.selectedMembershipId,
					body: "inside-list-transaction",
				},
				values: { createdAt: ctx.now },
			});
		const request = {
			channelId: input.channelId,
			first: input.first,
			after: input.after,
			...(input.extra ? { unexpected: true } : {}),
		};
		const page = await ctx.data.messages.list(request);
		if (input.exhaust) {
			try {
				for (let index = 0; index < 100; index++)
					await ctx.data.messages.list(request);
			} catch {
				/* A caught budget failure must still roll back the write. */
			}
		}
		return page;
	},
});
