import {
	bindDefinitions,
	operation,
	type InputOf,
	type OutputOf,
} from "./framework";
import type { AppContract } from "./generated-app";

const define = bindDefinitions<AppContract>();

export const getMessage = define.query({
	name: "messages.get",
	input: { messageId: operation.uuid() },
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		});

		// @ts-expect-error Query mode has no Collection writes.
		ctx.data.messages.create;
		// @ts-expect-error The generated map has no phantom Collection.
		ctx.data.comments;
		return message;
	},
});

export const createMessage = define.mutation({
	name: "messages.create",
	input: { body: operation.text() },
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.create({
			input: { body: input.body },
			select: { id: true, body: true },
		});
		const accepted = await ctx.dispatch.messageSubmitted({
			messageId: message.id,
		});
		return { message, runId: accepted.runId };
	},
});

export const messageSubmitted = define.reaction({
	name: "messageSubmitted",
	input: { messageId: operation.uuid() },
	handler: async ({ input, ctx, run, attempt }) => {
		const delivery = await ctx.actions["delivery.send"]({
			messageId: input.messageId,
			effectKey: run.effect("deliver-message"),
		});
		return { providerId: delivery.providerId, attempt: attempt.number };
	},
});

export const rebuildMessage = define.job({
	name: "messages.rebuild",
	input: { messageId: operation.uuid() },
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		});
		return { found: message !== null };
	},
});

export const sendDelivery = define.action({
	name: "delivery.send",
	input: {
		messageId: operation.uuid(),
		effectKey: operation.text(),
	},
	handler: async ({ input, ctx }) => {
		const message = await ctx.queries["messages.get"]({
			messageId: input.messageId,
		});
		// @ts-expect-error Action mode has no Collection surface.
		ctx.data;
		return { providerId: `${input.effectKey}:${message?.id ?? "missing"}` };
	},
});

export const deliveryWebhook = define.route({
	name: "delivery.webhook",
	handler: async ({ request, ctx }) => {
		const body = await request.text();
		await ctx.execution({ companyId: "company-1" }, ({ mutations }) =>
			mutations["messages.create"]({ body }),
		);
		return new Response(null, { status: 204 });
	},
});

type Equal<TLeft, TRight> =
	(<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
		? true
		: false;
type Expect<TValue extends true> = TValue;

type _QueryInput = Expect<
	Equal<InputOf<typeof getMessage>, { messageId: string }>
>;
type _QueryOutput = Expect<
	Equal<
		OutputOf<typeof getMessage>,
		{ readonly id: string; readonly body: string } | null
	>
>;
type _MutationOutput = Expect<
	Equal<
		OutputOf<typeof createMessage>,
		{
			message: { readonly id: string; readonly body: string };
			runId: string;
		}
	>
>;
