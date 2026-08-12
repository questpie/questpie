import { operation, policy } from "questpie";

import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
} from "#questpie/app";

import { importedHandler, importedInput } from "./imported-query-handler";

const companyInput = operation.object({
	companyId: operation.uuid(),
});

export const companySummary = defineQuery({
	name: "companies.summary",
	input: companyInput,
	handler: async ({ input, ctx }) => {
		const company = await ctx.data.companies.get({
			key: { id: input.companyId },
			select: { name: true },
		});
		return company === null ? null : { name: company.name };
	},
	network: true,
});

export const importedCompanyCheck = defineQuery({
	name: "companies.importedCheck",
	input: importedInput,
	handler: importedHandler,
});

export const messageSummary = defineQuery({
	name: "messages.summary",
	input: operation.object({ id: operation.uuid() }),
	handler: async ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
	network: true,
});

export const renameMessage = defineMutation({
	name: "messages.rename",
	input: operation.object({
		id: operation.uuid(),
		body: operation.text({ maximumLength: 20_000 }),
	}),
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.update({
			key: { id: input.id },
			patch: { body: input.body, updatedAt: ctx.operationTime },
			select: { id: true, body: true, updatedAt: true },
		});

		if (message !== null) {
			await ctx.dispatch.messageRenamed({ messageId: message.id });
		}

		// @ts-expect-error The dispatch map has exact keys.
		ctx.dispatch.phantom;
		return message;
	},
	network: true,
});

const provider = {
	async send(input: { readonly body: string; readonly effectKey: string }) {
		return { providerId: `${input.effectKey}:${input.body}` };
	},
};

export const sendDelivery = defineAction({
	name: "delivery.send",
	input: operation.object({
		body: operation.text(),
		effectKey: operation.text(),
	}),
	handler: async ({ input, ctx }) => {
		ctx.signal.throwIfAborted();
		// @ts-expect-error Action mode has no Collection data surface.
		ctx.data;
		return provider.send(input);
	},
});

export const messageRenamed = defineReaction({
	name: "messageRenamed",
	input: operation.object({ messageId: operation.uuid() }),
	handler: async ({ input, ctx, run, attempt }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { body: true },
		});
		if (message === null) return { kind: "unavailable" as const };

		const sent = await ctx.actions["delivery.send"]({
			body: message.body,
			effectKey: run.effect("deliver"),
		});
		return {
			kind: "sent" as const,
			providerId: sent.providerId,
			attempt: attempt.number,
		};
	},
});

export const companyDigest = defineJob({
	name: "companyDigest",
	input: companyInput,
	handler: async ({ input, ctx }) => {
		const summary = await ctx.queries["companies.summary"](input);
		return { title: summary?.name ?? "Unavailable" };
	},
});

export const deliveryWebhook = defineRoute({
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

// @ts-expect-error The generated application has no `accounts` Collection.
void companySummary.__output?.accounts;

const authenticated = policy.authenticated();
void authenticated;
