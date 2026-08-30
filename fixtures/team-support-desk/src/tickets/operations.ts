import { defineCollectionOperations } from "questpie";

import { tickets } from "../tickets";
import { ticketPolicy } from "./policy";

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
});
