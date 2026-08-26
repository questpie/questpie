const prefix = "018f5f6e-5f2c-7b41-a854-3d9a6b6b";

export const demoIds = Object.freeze({
	organization: `${prefix}7100`,
	principals: Object.freeze({
		customer: `${prefix}7101`,
		agent: `${prefix}7102`,
		admin: `${prefix}7103`,
		integration: `${prefix}7104`,
	}),
	memberships: Object.freeze({
		customer: `${prefix}7111`,
		agent: `${prefix}7112`,
		admin: `${prefix}7113`,
		integration: `${prefix}7114`,
	}),
	team: `${prefix}7121`,
	tickets: Object.freeze({
		customerOpen: `${prefix}7131`,
		agentClosed: `${prefix}7132`,
	}),
	references: Object.freeze({
		customerOpen: "SUP-1042",
		agentClosed: "SUP-1038",
	}),
	comments: Object.freeze({
		customer: `${prefix}7141`,
		agent: `${prefix}7142`,
	}),
	labels: Object.freeze({
		urgent: `${prefix}7151`,
		billing: `${prefix}7152`,
	}),
});
