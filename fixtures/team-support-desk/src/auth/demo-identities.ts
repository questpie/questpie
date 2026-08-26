import { demoIds } from "../demo-ids";

// These are public, local-only reference identities. Passwords are fixture data,
// never deployment secrets. Better Auth owns authentication; the hints only
// select a QUESTPIE Context input, which revalidates current Membership state.
export const demoAuthIdentities = Object.freeze({
	customer: Object.freeze({
		email: "customer@support.example",
		label: "Customer",
		membershipHint: demoIds.memberships.customer,
		name: "Casey Customer",
		organizationHint: demoIds.organization,
		password: "Customer-demo-2026!",
		principalId: demoIds.principals.customer,
		roleHint: "customer" as const,
	}),
	agent: Object.freeze({
		email: "agent@support.example",
		label: "Agent",
		membershipHint: demoIds.memberships.agent,
		name: "Alex Agent",
		organizationHint: demoIds.organization,
		password: "Agent-demo-2026!",
		principalId: demoIds.principals.agent,
		roleHint: "agent" as const,
	}),
	admin: Object.freeze({
		email: "admin@support.example",
		label: "Admin",
		membershipHint: demoIds.memberships.admin,
		name: "Avery Admin",
		organizationHint: demoIds.organization,
		password: "Admin-demo-2026!",
		principalId: demoIds.principals.admin,
		roleHint: "admin" as const,
	}),
});

export type DemoAuthPersona = keyof typeof demoAuthIdentities;
