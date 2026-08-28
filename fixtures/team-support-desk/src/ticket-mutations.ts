import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

const ticketResultCodec = codec.object({
	id: codec.uuid(),
	organizationId: codec.uuid(),
	teamId: codec.uuid(),
	requesterMembershipId: codec.uuid(),
	assigneeMembershipId: codec.nullable(codec.uuid()),
	reference: codec.text(),
	priority: codec.text(),
	status: codec.text(),
	summary: codec.text(),
	description: codec.text(),
	createdAt: codec.timestamp(),
	updatedAt: codec.timestamp(),
	closedAt: codec.nullable(codec.timestamp()),
});

const ticketUnavailable = operation.error({
	code: "TICKET_UNAVAILABLE",
	status: 404,
});

const transitionRejected = operation.error({
	code: "TICKET_TRANSITION_REJECTED",
	status: 409,
});

function ticketResult(
	ticket: Readonly<{
		id: string;
		organizationId: string;
		teamId: string;
		requesterMembershipId: string;
		assigneeMembershipId: string | null;
		reference: string;
		priority: string;
		status: string;
		summary: string;
		description: string;
		createdAt: Date;
		updatedAt: Date;
		closedAt: Date | null;
	}>,
) {
	return {
		id: ticket.id,
		organizationId: ticket.organizationId,
		teamId: ticket.teamId,
		requesterMembershipId: ticket.requesterMembershipId,
		assigneeMembershipId: ticket.assigneeMembershipId,
		reference: ticket.reference,
		priority: ticket.priority,
		status: ticket.status,
		summary: ticket.summary,
		description: ticket.description,
		createdAt: ticket.createdAt,
		updatedAt: ticket.updatedAt,
		closedAt: ticket.closedAt,
	};
}

export const createTicket = defineMutation({
	name: "ticket.create",
	network: true,
	input: codec.object({
		teamId: codec.uuid(),
		reference: codec.text(),
		priority: codec.text(),
		summary: codec.text(),
		description: codec.text(),
	}),
	output: ticketResultCodec,
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx }) => {
		const ticket = await ctx.data.tickets.create({
			input: {
				teamId: input.teamId,
				assigneeMembershipId: null,
				reference: input.reference,
				priority: input.priority,
				summary: input.summary,
				description: input.description,
			},
			values: {
				requesterMembershipId: ctx.values.membershipId,
				status: "open",
			},
		});
		return ticketResult(ticket);
	},
});

export const editTicket = defineMutation({
	name: "ticket.edit",
	network: true,
	input: codec.object({
		ticketId: codec.uuid(),
		teamId: codec.optional(codec.uuid()),
		priority: codec.optional(codec.text()),
		summary: codec.optional(codec.text()),
		description: codec.optional(codec.text()),
	}),
	output: ticketResultCodec,
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({ key: { id: input.ticketId } });
		if (current === null) throw errors.ticketUnavailable();
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			patch: {
				...(input.teamId === undefined ? {} : { teamId: input.teamId }),
				...(input.priority === undefined ? {} : { priority: input.priority }),
				...(input.summary === undefined ? {} : { summary: input.summary }),
				...(input.description === undefined
					? {}
					: { description: input.description }),
			},
		});
		if (updated === null) throw errors.ticketUnavailable();
		return ticketResult(updated);
	},
});

export const assignTicket = defineMutation({
	name: "ticket.assign",
	network: true,
	input: codec.object({
		ticketId: codec.uuid(),
		assigneeMembershipId: codec.nullable(codec.uuid()),
	}),
	output: ticketResultCodec,
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx, errors }) => {
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			patch: { assigneeMembershipId: input.assigneeMembershipId },
		});
		if (updated === null) throw errors.ticketUnavailable();
		return ticketResult(updated);
	},
});

export const closeTicket = defineMutation({
	name: "ticket.close",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	output: ticketResultCodec,
	policy: policy.authenticated(),
	errors: { ticketUnavailable, transitionRejected },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({ key: { id: input.ticketId } });
		if (current === null) throw errors.ticketUnavailable();
		if (current.status !== "open") throw errors.transitionRejected();

		// Collection update owns the row lock and rechecks Policy against current
		// and candidate state. A concurrent loser cannot overwrite the winner.
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			values: { status: "closed", closedAt: ctx.operationTime },
		});
		if (updated === null) throw errors.ticketUnavailable();
		return ticketResult(updated);
	},
});

export const reopenTicket = defineMutation({
	name: "ticket.reopen",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	output: ticketResultCodec,
	policy: policy.authenticated(),
	errors: { ticketUnavailable, transitionRejected },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({ key: { id: input.ticketId } });
		if (current === null) throw errors.ticketUnavailable();
		if (current.status !== "closed") throw errors.transitionRejected();
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			values: { status: "open", closedAt: null },
		});
		if (updated === null) throw errors.ticketUnavailable();
		return ticketResult(updated);
	},
});

export const addTicketComment = defineMutation({
	name: "ticket.addComment",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), body: codec.text() }),
	output: codec.object({
		comment: codec.object({
			id: codec.uuid(),
			ticketId: codec.uuid(),
			authorMembershipId: codec.uuid(),
			body: codec.text(),
			kind: codec.text(),
			createdAt: codec.timestamp(),
		}),
		job: codec.object({ runId: codec.uuid(), resource: codec.text() }),
	}),
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({ key: { id: input.ticketId } });
		if (current === null) throw errors.ticketUnavailable();
		const comment = await ctx.data.comments.create({
			input: {
				ticketId: current.id,
				body: input.body,
			},
			values: {
				authorMembershipId: ctx.values.membershipId,
				kind: "public",
			},
		});
		const dueAt = new Date(ctx.operationTime.getTime() + 1_500);
		const job = await ctx.jobs.ticket.slaFollowUp.accept(
			{
				organizationId: current.organizationId,
				ticketId: current.id,
				reference: current.reference,
				summary: current.summary,
				dueAt,
			},
			{ idempotencyKey: `comment:${comment.id}:sla-follow-up` },
		);
		return { comment, job };
	},
});
