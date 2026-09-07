import { codec, durable, operation, policy, principal } from "questpie";

import { defineJob, defineMutation } from "#questpie/app";

import { demoIds } from "../demo-ids";

export const sweepSla = defineMutation({
	name: "ticket.sweepSla",
	network: false,
	input: codec.object({}),
	output: codec.object({
		processed: codec.integer({ minimum: 0, maximum: 1 }),
	}),
	policy: policy.authenticated(),
	errors: {
		invalidTicket: operation.error({ code: "SLA_TICKET_INVALID", status: 422 }),
	},
	issueMappings: { tickets: { invalidReference: "invalidTicket" } },
	handler: async ({ ctx }) => {
		const due = await ctx.data.tickets.list({ first: 1, after: null });
		let processed = 0;
		for (const candidate of due.nodes) {
			// A nested get locks the row and reads fresh Policy/state after waiting.
			const current = await ctx.data.tickets.get({ key: { id: candidate.id } });
			if (
				current === null ||
				current.status !== "open" ||
				current.slaFollowUpDueAt === null ||
				current.slaFollowUpDueAt.getTime() > ctx.now.getTime()
			)
				continue;
			const advanced = await ctx.data.tickets.update({
				key: { id: current.id },
				values: {
					lastSlaFollowUpAt: ctx.now,
					slaFollowUpDueAt: new Date(ctx.now.getTime() + 60 * 60 * 1000),
				},
			});
			// Ticket afterWrite accepts the ordinary follow-up Job in this transaction.
			if (advanced !== null) processed++;
		}
		return { processed };
	},
});

export const sweepSlaJob = defineJob({
	name: "ticket.sweepSla",
	input: codec.object({}),
	output: codec.object({
		processed: codec.integer({ minimum: 0, maximum: 1 }),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "10s",
		jitter: "full",
		horizon: "1h",
	}),
	schedule: {
		cron: "* * * * *",
		execution: {
			principal: principal.service({ name: demoIds.principals.sweep }),
			context: {
				organizationId: demoIds.organization,
				membershipId: demoIds.memberships.sweep,
			},
		},
		input: {},
	},
	handler: ({ ctx }) =>
		ctx.run.step.mutation("due-tickets", ctx.mutations.ticket.sweepSla, {}),
});
