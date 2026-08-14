import { codec, defineCollection, defineContext, defineSeed } from "./core";
import { defineReaction } from "./generated-app";

export const messages = defineCollection({ name: "messages" });
export const appContext = defineContext({ name: "app.context" });
export const demo = defineSeed({ name: "collaboration.demo" });

export const deliverMessage = defineReaction({
	name: "messages.deliver",
	input: codec.uuid(),
	async handler({ input, ctx, run }) {
		void ctx.data.snapshot;
		const delivery = await ctx.actions.delivery.sendMessage(
			{ message: { id: input, body: "hello" } },
			{ idempotencyKey: run.effect("deliver-message") },
		);
		await ctx.mutations.messages.recordDelivery({
			messageId: input,
			providerMessageId: delivery.providerMessageId,
		});
		await ctx.actions.constructor.inspect({ id: input });
		await ctx.actions.prototype.measure({ id: input });
		await ctx.actions.then.fire({ id: input });
		await ctx.actions.a.toString.b({ id: input });
		return delivery;
	},
});
