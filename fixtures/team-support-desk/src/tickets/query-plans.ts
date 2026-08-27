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

const ticketSearchSelection = ({
	fields,
	relations,
}: TicketSelectionScope) => ({
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
	select: ticketSearchSelection,
	where: ({ fields, parameters }) =>
		fields.reference.equal(parameters.reference),
	orderBy: ({ fields }) => [fields.id.ascending({ nulls: "last" })],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
