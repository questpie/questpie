import { dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

const pageParameters = {
	first: query.parameter.integer({
		nullable: false,
		minimum: 1,
		maximum: 100,
	}),
	after: query.parameter.cursor({ nullable: true }),
} as const;

type TicketSelectionScope = Parameters<
	Parameters<
		ReturnType<typeof dataQuery<AppData["collections"]["tickets"]>>
	>[0]["select"]
>[0];

const ticketSelection = ({ fields, relations }: TicketSelectionScope) => ({
	id: fields.id,
	organizationId: fields.organizationId,
	teamId: fields.teamId,
	requesterMembershipId: fields.requesterMembershipId,
	assigneeMembershipId: fields.assigneeMembershipId,
	reference: fields.reference,
	priority: fields.priority,
	status: fields.status,
	summary: fields.summary,
	updatedAt: fields.updatedAt,
	team: relations.team.select(({ fields: team }) => ({
		id: team.id,
		name: team.name,
		routingStatus: team.routingStatus,
	})),
	assignee: relations.assignee.select(({ fields: assignee }) => ({
		id: assignee.id,
		principalId: assignee.principalId,
		role: assignee.role,
	})),
});

export const ticketListPlan = dataQuery<AppData["collections"]["tickets"]>()({
	from: "tickets",
	parameters: pageParameters,
	select: ticketSelection,
	where: null,
	orderBy: ({ fields }) => [
		fields.updatedAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const ticketListByStatusPlan = dataQuery<
	AppData["collections"]["tickets"]
>()({
	from: "tickets",
	parameters: {
		...pageParameters,
		status: query.parameter.text({ nullable: false }),
	},
	select: ticketSelection,
	where: ({ fields, parameters }) => fields.status.equal(parameters.status),
	orderBy: ({ fields }) => [
		fields.updatedAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const ticketListByTeamPlan = dataQuery<
	AppData["collections"]["tickets"]
>()({
	from: "tickets",
	parameters: {
		...pageParameters,
		teamId: query.parameter.uuid({ nullable: false }),
	},
	select: ticketSelection,
	where: ({ fields, parameters }) => fields.teamId.equal(parameters.teamId),
	orderBy: ({ fields }) => [
		fields.updatedAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const ticketListByStatusAndTeamPlan = dataQuery<
	AppData["collections"]["tickets"]
>()({
	from: "tickets",
	parameters: {
		...pageParameters,
		status: query.parameter.text({ nullable: false }),
		teamId: query.parameter.uuid({ nullable: false }),
	},
	select: ticketSelection,
	where: ({ fields, parameters }) =>
		query.and(
			fields.status.equal(parameters.status),
			fields.teamId.equal(parameters.teamId),
		),
	orderBy: ({ fields }) => [
		fields.updatedAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const ticketDetailPlan = dataQuery<AppData["collections"]["tickets"]>()({
	from: "tickets",
	parameters: {
		id: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		organizationId: fields.organizationId,
		teamId: fields.teamId,
		requesterMembershipId: fields.requesterMembershipId,
		assigneeMembershipId: fields.assigneeMembershipId,
		reference: fields.reference,
		priority: fields.priority,
		status: fields.status,
		summary: fields.summary,
		description: fields.description,
		createdAt: fields.createdAt,
		updatedAt: fields.updatedAt,
		closedAt: fields.closedAt,
		lastSlaFollowUpAt: fields.lastSlaFollowUpAt,
		team: relations.team.select(({ fields: team }) => ({
			id: team.id,
			name: team.name,
			routingStatus: team.routingStatus,
		})),
		requester: relations.requester.select(({ fields: requester }) => ({
			id: requester.id,
			principalId: requester.principalId,
			role: requester.role,
		})),
		assignee: relations.assignee.select(({ fields: assignee }) => ({
			id: assignee.id,
			principalId: assignee.principalId,
			role: assignee.role,
		})),
	}),
	where: ({ fields, parameters }) => fields.id.equal(parameters.id),
	orderBy: ({ fields }) => [fields.id.ascending({ nulls: "last" })],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const ticketSearchByReferencePlan = dataQuery<
	AppData["collections"]["tickets"]
>()({
	from: "tickets",
	parameters: {
		reference: query.parameter.text({ nullable: false }),
		...pageParameters,
	},
	select: ticketSelection,
	where: ({ fields, parameters }) =>
		fields.reference.equal(parameters.reference),
	orderBy: ({ fields }) => [fields.id.ascending({ nulls: "last" })],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const commentPagePlan = dataQuery<AppData["collections"]["comments"]>()({
	from: "comments",
	parameters: {
		ticketId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		ticketId: fields.ticketId,
		authorMembershipId: fields.authorMembershipId,
		body: fields.body,
		kind: fields.kind,
		createdAt: fields.createdAt,
		author: relations.author.select(({ fields: author }) => ({
			id: author.id,
			principalId: author.principalId,
			role: author.role,
		})),
	}),
	where: ({ fields, parameters }) => fields.ticketId.equal(parameters.ticketId),
	orderBy: ({ fields }) => [
		fields.createdAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const labelPagePlan = dataQuery<AppData["collections"]["labels"]>()({
	from: "labels",
	parameters: {
		ticketId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields }) => ({
		id: fields.id,
		organizationId: fields.organizationId,
		ticketId: fields.ticketId,
		name: fields.name,
		color: fields.color,
		createdAt: fields.createdAt,
	}),
	where: ({ fields, parameters }) => fields.ticketId.equal(parameters.ticketId),
	orderBy: ({ fields }) => [
		fields.name.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const teamListPlan = dataQuery<AppData["collections"]["teams"]>()({
	from: "teams",
	parameters: {
		organizationId: query.parameter.uuid({ nullable: false }),
		...pageParameters,
	},
	select: ({ fields }) => ({
		id: fields.id,
		organizationId: fields.organizationId,
		name: fields.name,
		routingStatus: fields.routingStatus,
	}),
	where: ({ fields, parameters }) =>
		fields.organizationId.equal(parameters.organizationId),
	orderBy: ({ fields }) => [
		fields.name.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
