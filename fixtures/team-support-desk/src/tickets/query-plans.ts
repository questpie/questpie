import { codec, dataQuery, query } from "questpie";

import type { AppData } from "#questpie/app";

import { comments } from "../comments";
import { tickets } from "./index";

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

export const ticketDetailPlan = tickets.list({
	parameters: {
		id: codec.uuid(),
		first: codec.integer({ minimum: 1, maximum: 1 }),
		after: codec.nullable(codec.cursor()),
	},
	where: ({ row, parameters }) => row.id.equal(parameters.id),
	orderBy: { id: "asc" },
	select: {
		id: true,
		organizationId: true,
		teamId: true,
		requesterMembershipId: true,
		assigneeMembershipId: true,
		reference: true,
		priority: true,
		status: true,
		summary: true,
		description: true,
		createdAt: true,
		updatedAt: true,
		closedAt: true,
		lastSlaFollowUpAt: true,
		team: { select: { id: true, name: true, routingStatus: true } },
		requester: { select: { id: true, principalId: true, role: true } },
		assignee: { select: { id: true, principalId: true, role: true } },
		comments: comments.list({
			first: 50,
			orderBy: { createdAt: "desc", id: "desc" },
			select: {
				id: true,
				ticketId: true,
				authorMembershipId: true,
				body: true,
				kind: true,
				createdAt: true,
			},
		}),
	},
	page: ({ parameters }) => ({
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
