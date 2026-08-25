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
	referenceOpen: "SUP-1001",
	referenceClosed: "SUP-1002",
});

export const supportPersonas = Object.freeze({
	customer: Object.freeze({
		label: "Customer",
		membershipId: supportTracerIds.membershipCustomer,
		principalId: supportTracerIds.principalCustomer,
	}),
	agent: Object.freeze({
		label: "Agent",
		membershipId: supportTracerIds.membershipAgent,
		principalId: supportTracerIds.principalAgent,
	}),
	admin: Object.freeze({
		label: "Admin",
		membershipId: supportTracerIds.membershipAdmin,
		principalId: supportTracerIds.principalAdmin,
	}),
});

export type SupportPersona = keyof typeof supportPersonas;
