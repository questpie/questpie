import { codec } from "questpie";

import { defineQuery } from "#questpie/app";

import {
	commentPagePlan,
	labelPagePlan,
	teamListPlan,
	ticketDetailPlan,
	ticketListByStatusAndTeamPlan,
	ticketListByStatusPlan,
	ticketListByTeamPlan,
	ticketListPlan,
	ticketSearchByReferencePlan,
} from "./support-query-plans";

const pageInfoCodec = codec.object({
	endCursor: codec.nullable(codec.text()),
	hasNextPage: codec.boolean(),
});

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

const ticketPageCodec = codec.object({
	nodes: codec.array(ticketSummaryCodec),
	pageInfo: pageInfoCodec,
});

const pageInputCodec = {
	first: codec.integer(),
	after: codec.nullable(codec.text()),
} as const;

function timestamp(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

export const listTickets = defineQuery({
	name: "tickets.list",
	network: true,
	input: codec.object(pageInputCodec),
	output: ticketPageCodec,
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketListPlan, input);
		return {
			...page,
			nodes: page.nodes.map((ticket) => ({
				...ticket,
				updatedAt: timestamp(ticket.updatedAt),
			})),
		};
	},
});

export const listTicketsByStatus = defineQuery({
	name: "tickets.listByStatus",
	network: true,
	input: codec.object({ ...pageInputCodec, status: codec.text() }),
	output: ticketPageCodec,
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketListByStatusPlan, input);
		return {
			...page,
			nodes: page.nodes.map((ticket) => ({
				...ticket,
				updatedAt: timestamp(ticket.updatedAt),
			})),
		};
	},
});

export const listTicketsByTeam = defineQuery({
	name: "tickets.listByTeam",
	network: true,
	input: codec.object({ ...pageInputCodec, teamId: codec.uuid() }),
	output: ticketPageCodec,
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketListByTeamPlan, input);
		return {
			...page,
			nodes: page.nodes.map((ticket) => ({
				...ticket,
				updatedAt: timestamp(ticket.updatedAt),
			})),
		};
	},
});

export const listTicketsByStatusAndTeam = defineQuery({
	name: "tickets.listByStatusAndTeam",
	network: true,
	input: codec.object({
		...pageInputCodec,
		status: codec.text(),
		teamId: codec.uuid(),
	}),
	output: ticketPageCodec,
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(ticketListByStatusAndTeamPlan, input);
		return {
			...page,
			nodes: page.nodes.map((ticket) => ({
				...ticket,
				updatedAt: timestamp(ticket.updatedAt),
			})),
		};
	},
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

export const pageComments = defineQuery({
	name: "comments.page",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				ticketId: codec.uuid(),
				authorMembershipId: codec.uuid(),
				body: codec.text(),
				kind: codec.text(),
				createdAt: codec.timestamp(),
				author: codec.nullable(membershipSummaryCodec),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(commentPagePlan, input);
		return {
			...page,
			nodes: page.nodes.map((comment) => ({
				...comment,
				createdAt: timestamp(comment.createdAt),
			})),
		};
	},
});

export const pageLabels = defineQuery({
	name: "labels.page",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				organizationId: codec.uuid(),
				ticketId: codec.uuid(),
				name: codec.text(),
				color: codec.text(),
				createdAt: codec.timestamp(),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: async ({ input, ctx }) => {
		const page = await ctx.data.run(labelPagePlan, input);
		return {
			...page,
			nodes: page.nodes.map((label) => ({
				...label,
				createdAt: timestamp(label.createdAt),
			})),
		};
	},
});

export const listTeams = defineQuery({
	name: "teams.list",
	network: true,
	input: codec.object({ organizationId: codec.uuid(), ...pageInputCodec }),
	output: codec.object({
		nodes: codec.array(
			codec.object({
				id: codec.uuid(),
				organizationId: codec.uuid(),
				name: codec.text(),
				routingStatus: codec.text(),
			}),
		),
		pageInfo: pageInfoCodec,
	}),
	handler: ({ input, ctx }) => ctx.data.run(teamListPlan, input),
});
