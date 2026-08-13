import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
} from "./generated-app";
import { operation } from "./framework";
import { importedHandler, importedInput } from "./imported-query-handler";

const companyInput = operation.object<{ companyId: string }>();
const messageInput = operation.object<{ id: string; body: string }>();

export const companySummary = defineQuery({
	name: "companies.summary",
	input: companyInput,
	handler: async ({ input, ctx }) => {
		const company = await ctx.data.companies.get({
			key: { id: input.companyId },
		});

		// @ts-expect-error Query mode has no writes.
		ctx.data.messages.create;
		// @ts-expect-error The generated application has no `accounts` Collection.
		ctx.data.accounts;

		return { name: company?.name ?? "missing" };
	},
});

export const importedCompanyCheck = defineQuery({
	name: "companies.importedCheck",
	input: importedInput,
	handler: importedHandler,
});

export const renameMessage = defineMutation({
	name: "messages.rename",
	input: messageInput,
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.update({
			key: { id: input.id },
			patch: { body: input.body },
		});
		await ctx.dispatch.messageSubmitted({ messageId: input.id });

		// @ts-expect-error The generated dispatch map is exact.
		ctx.dispatch.phantom;
		return message;
	},
});

export const delivery = defineAction({
	name: "delivery.send",
	input: operation.object<{ body: string }>(),
	handler: async ({ input, ctx }) => {
		ctx.signal.throwIfAborted();
		await ctx.queries["companies.summary"]({ companyId: ctx.tenant.id });

		// @ts-expect-error Action mode has no Collection surface.
		ctx.data;
		return { providerId: input.body };
	},
});

export const submitted = defineReaction({
	name: "messageSubmitted",
	input: operation.object<{ messageId: string }>(),
	handler: async ({ input, ctx, run, attempt }) => {
		const message = await ctx.data.messages.get({ key: { id: input.messageId } });
		if (message === null) return { kind: "missing" as const };

		const sent = await ctx.actions["delivery.send"]({ body: message.body });
		return {
			kind: "sent" as const,
			providerId: sent.providerId,
			effectKey: run.effect("deliver"),
			attempt: attempt.number,
		};
	},
});

export const digest = defineJob({
	name: "companyDigest",
	input: companyInput,
	handler: async ({ input, ctx }) => {
		const summary = await ctx.queries["companies.summary"](input);
		return { title: summary.name };
	},
});

export const webhook = defineRoute({
	name: "delivery.webhook",
	method: "POST",
	path: "/webhooks/delivery",
	handler: async ({ request, ctx }) => {
		const body = await request.text();
		// @ts-expect-error Raw Route ingress has no fabricated application Tenant.
		ctx.tenant;
		await ctx.execution(
			{
				principal: { id: "delivery.webhook" },
				context: { companyId: "company-from-verified-payload" },
			},
			({ mutations }) =>
				mutations["messages.rename"]({ id: "message-1", body }),
		);
		return new Response(null, { status: 204 });
	},
});

type QueryOutput = NonNullable<typeof companySummary["__output"]>;
const inferredOutput: QueryOutput = { name: "QUESTPIE" };
void inferredOutput;
