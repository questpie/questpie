import { defineSeed, seed } from "questpie";

import { comments } from "./comments";
import { demoIds } from "./demo-ids";
import { labels } from "./labels";
import { tickets } from "./tickets";

export const supportDemo = defineSeed({
	name: "teamSupport.demo.v1",
	dependsOn: ["teamSupport.identity.v1"],
	steps: [
		seed.insert(tickets, {
			id: demoIds.tickets.customerOpen,
			organizationId: demoIds.organization,
			teamId: demoIds.team,
			requesterMembershipId: demoIds.memberships.customer,
			assigneeMembershipId: demoIds.memberships.agent,
			reference: "SUP-1042",
			priority: "high",
			status: "open",
			summary: "Cannot export the August invoice",
			description: "The invoice export finishes without a download in Firefox.",
			createdAt: "2026-08-26T08:15:00.000Z",
			updatedAt: "2026-08-26T08:20:00.000Z",
			closedAt: null,
			lastSlaFollowUpAt: null,
		}),
		seed.insert(tickets, {
			id: demoIds.tickets.agentClosed,
			organizationId: demoIds.organization,
			teamId: demoIds.team,
			requesterMembershipId: demoIds.memberships.customer,
			assigneeMembershipId: demoIds.memberships.agent,
			reference: "SUP-1038",
			priority: "normal",
			status: "closed",
			summary: "Update account billing address",
			description: "Please update the billing city to Bratislava.",
			createdAt: "2026-08-25T12:00:00.000Z",
			updatedAt: "2026-08-25T13:30:00.000Z",
			closedAt: "2026-08-25T13:30:00.000Z",
			lastSlaFollowUpAt: "2026-08-25T12:30:00.000Z",
		}),
		seed.insert(comments, {
			id: demoIds.comments.customer,
			ticketId: demoIds.tickets.customerOpen,
			authorMembershipId: demoIds.memberships.customer,
			body: "I reproduced this twice after signing in again.",
			kind: "public",
			createdAt: "2026-08-26T08:16:00.000Z",
		}),
		seed.insert(comments, {
			id: demoIds.comments.agent,
			ticketId: demoIds.tickets.customerOpen,
			authorMembershipId: demoIds.memberships.agent,
			body: "We are checking the export worker and will follow up shortly.",
			kind: "public",
			createdAt: "2026-08-26T08:20:00.000Z",
		}),
		seed.insert(labels, {
			id: demoIds.labels.urgent,
			organizationId: demoIds.organization,
			ticketId: demoIds.tickets.customerOpen,
			name: "urgent",
			color: "#dc2626",
			createdAt: "2026-08-26T08:18:00.000Z",
		}),
		seed.insert(labels, {
			id: demoIds.labels.billing,
			organizationId: demoIds.organization,
			ticketId: demoIds.tickets.agentClosed,
			name: "billing",
			color: "#2563eb",
			createdAt: "2026-08-25T12:05:00.000Z",
		}),
	],
});
