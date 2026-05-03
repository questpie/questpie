import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export default collection("apikey")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		configId: f.text(255).required().default("default"),
		name: f.text(255),
		start: f.text(255),
		prefix: f.text(255),
		referenceId: f.text(255).required(),
		key: f.text(500).required(),
		userId: f.text(255),
		refillInterval: f.number(),
		refillAmount: f.number(),
		lastRefillAt: f.datetime(),
		enabled: f.boolean().default(true),
		rateLimitEnabled: f.boolean().default(true),
		rateLimitTimeWindow: f.number(),
		rateLimitMax: f.number(),
		requestCount: f.number().default(0),
		remaining: f.number(),
		lastRequest: f.datetime(),
		expiresAt: f.datetime(),
		permissions: f.textarea(),
		metadata: f.textarea(),
	}))
	.title(({ f }) => f.key);
