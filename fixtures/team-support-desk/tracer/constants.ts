import { demoAuthIdentities } from "../src/auth/demo-identities";
import { demoIds } from "../src/demo-ids";

export const supportTracerIds = Object.freeze({
	organization: demoIds.organization,
	principalCustomer: demoIds.principals.customer,
	principalAgent: demoIds.principals.agent,
	principalAdmin: demoIds.principals.admin,
	principalIntegration: demoIds.principals.integration,
	membershipCustomer: demoIds.memberships.customer,
	membershipAgent: demoIds.memberships.agent,
	membershipAdmin: demoIds.memberships.admin,
	membershipIntegration: demoIds.memberships.integration,
	teamPlatform: demoIds.team,
	ticketOpen: demoIds.tickets.customerOpen,
	ticketClosed: demoIds.tickets.agentClosed,
	referenceOpen: demoIds.references.customerOpen,
	referenceClosed: demoIds.references.agentClosed,
});

export const supportPersonas = Object.freeze({
	customer: Object.freeze({
		label: demoAuthIdentities.customer.label,
		membershipId: demoAuthIdentities.customer.membershipHint,
		principalId: demoAuthIdentities.customer.principalId,
	}),
	agent: Object.freeze({
		label: demoAuthIdentities.agent.label,
		membershipId: demoAuthIdentities.agent.membershipHint,
		principalId: demoAuthIdentities.agent.principalId,
	}),
	admin: Object.freeze({
		label: demoAuthIdentities.admin.label,
		membershipId: demoAuthIdentities.admin.membershipHint,
		principalId: demoAuthIdentities.admin.principalId,
	}),
});

// Public, local-only credentials for the reference application's three demo
// identities. They are test data, never deployment secrets.
export const supportAuthCredentials = Object.freeze({
	customer: Object.freeze({
		email: demoAuthIdentities.customer.email,
		password: demoAuthIdentities.customer.password,
	}),
	agent: Object.freeze({
		email: demoAuthIdentities.agent.email,
		password: demoAuthIdentities.agent.password,
	}),
	admin: Object.freeze({
		email: demoAuthIdentities.admin.email,
		password: demoAuthIdentities.admin.password,
	}),
});

export type SupportPersona = keyof typeof supportPersonas;
