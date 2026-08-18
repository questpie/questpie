import { codec, durable, operation } from "questpie";

import { defineReaction } from "#questpie/app";

import { deliverMessage, lookupDelivery } from "./delivery";
import { channelMessagePage } from "./message-page";

export const messagePublished = defineReaction({
	name: "messagePublished",
	input: codec.object({
		channelId: codec.uuid(),
		companyId: codec.uuid(),
		messageId: codec.uuid(),
	}),
	output: codec.object({
		// A delivery confirmation echoes what was delivered. `body` is governed by
		// the Message output Field Policy, which withholds it from members whose
		// role is not owner or admin — so this result carries content the
		// equivalent Query would omit for such a caller.
		deliveredBody: codec.text(),
		deliveryReceipt: codec.text(),
		eventId: codec.uuid(),
		messageId: codec.uuid(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 8,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "900s",
		jitter: "full",
		horizon: "24h",
	}),
	effects: ["deliver-message"],
	errors: {
		messageUnavailable: operation.error({
			code: "MESSAGE_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		await ctx.attempt.heartbeat();
		const page = await ctx.data.run(channelMessagePage, {
			channelId: input.channelId,
			first: 100,
			after: null,
		});
		const message = page.nodes.find((node) => node.id === input.messageId);
		if (message?.body === undefined) throw errors.messageUnavailable();
		const body = message.body;
		const deliveryReceipt = await ctx.run.effect("deliver-message").invoke({
			input: { messageId: input.messageId },
			perform: ({ attempt, effectId }) =>
				deliverMessage({ attempt, body, effectId }),
			recover: ({ effectId }) => lookupDelivery({ body, effectId }),
		});
		const recorded = await ctx.mutations["message.recordDelivery"](
			{ messageId: input.messageId },
			{ callId: `run:${ctx.run.id}` },
		);
		return {
			deliveredBody: body,
			deliveryReceipt,
			eventId: recorded.eventId,
			messageId: input.messageId,
		};
	},
});
