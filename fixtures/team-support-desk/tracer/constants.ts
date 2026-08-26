import { demoAuthIdentities } from "../src/auth/demo-identities";
import { demoIds } from "../src/demo-ids";

export const supportTracerIds = Object.freeze({
	organization: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7100",
	principalCustomer: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7101",
	principalAgent: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7102",
	principalAdmin: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7103",
	principalIntegration: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7104",
	membershipCustomer: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7111",
	membershipAgent: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7112",
	membershipAdmin: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7113",
	membershipIntegration: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7114",
	teamPlatform: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7121",
	ticketOpen: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131",
	ticketClosed: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132",
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
