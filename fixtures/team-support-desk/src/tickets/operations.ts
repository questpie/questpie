import { defineCollectionOperations } from "questpie";

import { tickets } from "../tickets";
import { ticketPolicy } from "./policy";
import { dueTickets } from "./sla-query";

export const ticketOperations = defineCollectionOperations(tickets, {
	name: "tickets",
	policy: ticketPolicy,
	list: { data: dueTickets },
	get: {
		describe: {
			summary: "Get one ticket through the Collection kernel",
			description:
				"Uses the same Policy-aware generated read available to named Operations.",
			examples: [
				{
					input: {
						key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131" },
					},
				},
			],
		},
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
			slaFollowUpDueAt: true,
		},
	},
});
