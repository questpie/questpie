import { defineCollectionOperations, mutation, operation } from "questpie";

import { tickets } from "../tickets";
import { ticketPolicy } from "./policy";

const invalidTicket = operation.error({
	code: "INVALID_TICKET",
	status: 422,
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
		errors: { invalidTicket },
		issueMappings: {
			tickets: { invalidReference: "invalidTicket" },
		},
		input: [
			"teamId",
			"assigneeMembershipId",
			"reference",
			"priority",
			"summary",
			"description",
		],
		normalize: ({ input }) => ({
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
		errors: { invalidTicket },
		issueMappings: {
			tickets: { invalidReference: "invalidTicket" },
		},
		input: [
			"teamId",
			"assigneeMembershipId",
			"priority",
			"summary",
			"description",
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
