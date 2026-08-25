import { defineCollectionOperations, mutation, operation } from "questpie";

import { comments } from "./comments";
import { labels } from "./labels";
import { memberships } from "./memberships";
import { organizations } from "./organizations";
import {
	commentPolicy,
	labelPolicy,
	membershipPolicy,
	organizationPolicy,
	teamPolicy,
	ticketPolicy,
} from "./support-policy";
import { teams } from "./teams";
import { tickets } from "./tickets";

export const organizationOperations = defineCollectionOperations(
	organizations,
	{
		name: "organizations",
		policy: organizationPolicy,
		get: { select: { id: true, name: true, createdAt: true, updatedAt: true } },
	},
);

export const membershipOperations = defineCollectionOperations(memberships, {
	name: "memberships",
	policy: membershipPolicy,
	get: {
		select: {
			id: true,
			organizationId: true,
			principalId: true,
			role: true,
			status: true,
		},
	},
	update: {
		input: ["role", "status"],
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, role: true, status: true, updatedAt: true },
	},
});

export const teamOperations = defineCollectionOperations(teams, {
	name: "teams",
	policy: teamPolicy,
	get: {
		select: {
			id: true,
			organizationId: true,
			name: true,
			routingStatus: true,
		},
	},
	update: {
		input: ["name", "routingStatus"],
		normalize: ({ input }) => ({
			name: operation.text.trimIfPresent(input.name),
		}),
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, name: true, routingStatus: true, updatedAt: true },
	},
});

export const ticketOperations = defineCollectionOperations(tickets, {
	name: "tickets",
	policy: ticketPolicy,
	get: {
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
		},
	},
	create: {
		input: [
			"teamId",
			"requesterMembershipId",
			"assigneeMembershipId",
			"reference",
			"priority",
			"status",
			"summary",
			"description",
		],
		normalize: ({ input }) => ({
			reference: operation.text.trim(input.reference),
			summary: operation.text.trim(input.summary),
			description: operation.text.trim(input.description),
		}),
		values: ({ tenant, operationTime }) => ({
			organizationId: mutation.overwrite(tenant.id),
			createdAt: mutation.overwrite(operationTime),
			updatedAt: mutation.overwrite(operationTime),
		}),
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
		},
	},
	update: {
		input: [
			"teamId",
			"assigneeMembershipId",
			"priority",
			"status",
			"summary",
			"description",
			"closedAt",
			"lastSlaFollowUpAt",
		],
		normalize: ({ input }) => ({
			summary: operation.text.trimIfPresent(input.summary),
			description: operation.text.trimIfPresent(input.description),
		}),
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
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
		},
	},
});

export const commentOperations = defineCollectionOperations(comments, {
	name: "comments",
	policy: commentPolicy,
	create: {
		input: ["ticketId", "authorMembershipId", "body", "kind"],
		normalize: ({ input }) => ({ body: operation.text.trim(input.body) }),
		values: ({ operationTime }) => ({
			createdAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			ticketId: true,
			authorMembershipId: true,
			body: true,
			kind: true,
			createdAt: true,
		},
	},
});

export const labelOperations = defineCollectionOperations(labels, {
	name: "labels",
	policy: labelPolicy,
	create: {
		input: ["ticketId", "name", "color"],
		normalize: ({ input }) => ({
			name: operation.text.trim(input.name),
			color: operation.text.trim(input.color),
		}),
		values: ({ tenant, operationTime }) => ({
			organizationId: mutation.overwrite(tenant.id),
			createdAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			organizationId: true,
			ticketId: true,
			name: true,
			color: true,
			createdAt: true,
		},
	},
	update: {
		input: ["name", "color"],
		normalize: ({ input }) => ({
			name: operation.text.trimIfPresent(input.name),
			color: operation.text.trimIfPresent(input.color),
		}),
		select: { id: true, name: true, color: true },
	},
	delete: { select: { id: true } },
});
