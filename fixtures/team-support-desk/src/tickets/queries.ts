import { codec, expr } from "questpie";

import { defineQuery } from "#questpie/app";

import { tickets } from "../tickets";
import { ticketDetailPlan, ticketSearchByReferencePlan } from "./query-plans";

const membershipSummaryCodec = codec.object({
	id: codec.uuid(),
	principalId: codec.text(),
	role: codec.text(),
});

const teamSummaryCodec = codec.object({
	id: codec.uuid(),
	name: codec.text(),
	routingStatus: codec.text(),
});

const ticketSummaryCodec = codec.object({
	id: codec.uuid(),
	organizationId: codec.uuid(),
	teamId: codec.uuid(),
	requesterMembershipId: codec.uuid(),
	assigneeMembershipId: codec.nullable(codec.uuid()),
	reference: codec.text(),
	priority: codec.text(),
	status: codec.text(),
	summary: codec.text(),
	updatedAt: codec.timestamp(),
	team: codec.nullable(teamSummaryCodec),
	assignee: codec.nullable(membershipSummaryCodec),
});

function timestamp(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

export const ticketQueue = defineQuery({
	name: "tickets.queue",
	network: true,
	query: tickets.list({
		parameters: {
			statuses: codec.nullable(codec.list(codec.text(), { maximum: 8 })),
			teamIds: codec.nullable(codec.list(codec.uuid(), { maximum: 16 })),
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row, parameters }) =>
			expr.and(
				row.status.in(parameters.statuses),
				row.teamId.in(parameters.teamIds),
			),
		orderBy: {
			updatedAt: { direction: "desc", nulls: "last" },
			id: "desc",
		},
		select: {
			id: true,
			organizationId: true,
			status: true,
			teamId: true,
			requesterMembershipId: true,
			assigneeMembershipId: true,
			reference: true,
			priority: true,
			summary: true,
			updatedAt: true,
			team: {
				select: {
					id: true,
					name: true,
					routingStatus: true,
					organization: { select: { id: true, name: true } },
				},
			},
			assignee: {
				select: { id: true, principalId: true, role: true },
			},
		},
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});

const ticketDetailCodec = codec.object({
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
	lastSlaFollowUpAt: codec.nullable(codec.timestamp()),
	team: codec.nullable(teamSummaryCodec),
	requester: codec.nullable(membershipSummaryCodec),
	assignee: codec.nullable(membershipSummaryCodec),
});

export const ticketDetail = defineQuery({
	name: "tickets.detail",
	network: true,
	describe: {
		summary: "Fetch one visible support ticket",
		description:
			"Returns the ticket only when the current principal may see it.",
		examples: [{ input: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" } }],
	},
	input: codec.object({ id: codec.uuid() }),
	output: codec.nullable(ticketDetailCodec),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketDetailPlan, {
			id: input.id,
			first: 1,
			after: null,
		});
		const ticket = page.nodes[0];
		return ticket
			? {
					...ticket,
					createdAt: timestamp(ticket.createdAt),
					updatedAt: timestamp(ticket.updatedAt),
					closedAt:
						ticket.closedAt === null ? null : timestamp(ticket.closedAt),
					lastSlaFollowUpAt:
						ticket.lastSlaFollowUpAt === null
							? null
							: timestamp(ticket.lastSlaFollowUpAt),
				}
			: null;
	},
});

export const searchTicketByReference = defineQuery({
	name: "tickets.searchByReference",
	network: true,
	input: codec.object({ reference: codec.text() }),
	output: codec.nullable(ticketSummaryCodec),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketSearchByReferencePlan, {
			reference: input.reference,
			first: 1,
			after: null,
		});
		const ticket = page.nodes[0];
		return ticket
			? { ...ticket, updatedAt: timestamp(ticket.updatedAt) }
			: null;
	},
});
