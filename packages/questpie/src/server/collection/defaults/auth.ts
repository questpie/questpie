import { coreBuilder as q } from "./core-builder.js";

// User Collection
export const usersCollection = q
	.collection("user")
	.options({ timestamps: true })
	.fields((f) => ({
		name: f.text({ required: true, maxLength: 255 }),
		email: f.email({ required: true, maxLength: 255, unique: true }),
		emailVerified: f.boolean({ required: true }),
		image: f.url({ maxLength: 500 }),
		role: f.text({ maxLength: 50 }), // Optional: Better Auth role handling
		banned: f.boolean({ default: false }), // Optional: Better Auth ban handling
		banReason: f.text({ maxLength: 255 }),
		banExpires: f.datetime(),
	}))
	.title(({ f }) => f.name);

// Session Collection
export const sessionsCollection = q
	.collection("session")
	.options({ timestamps: true })
	.fields((f) => ({
		userId: f.text({ required: true, maxLength: 255 }),
		token: f.text({ required: true, maxLength: 255, unique: true }),
		expiresAt: f.datetime({ required: true }),
		ipAddress: f.text({ maxLength: 45 }),
		userAgent: f.text({ maxLength: 500 }),
		impersonatedBy: f.text({ maxLength: 255 }),
	}))
	.title(({ f }) => f.token);

// Account Collection (Social Logins)
export const accountsCollection = q
	.collection("account")
	.options({ timestamps: true })
	.fields((f) => ({
		userId: f.text({ required: true, maxLength: 255 }),
		accountId: f.text({ required: true, maxLength: 255 }),
		providerId: f.text({ required: true, maxLength: 255 }),
		accessToken: f.text({ maxLength: 500 }),
		refreshToken: f.text({ maxLength: 500 }),
		accessTokenExpiresAt: f.datetime(),
		refreshTokenExpiresAt: f.datetime(),
		scope: f.text({ maxLength: 255 }),
		idToken: f.text({ maxLength: 500 }),
		password: f.text({ maxLength: 255 }), // Optional: if using credential account here
	}))
	.title(({ f }) => f.providerId);

// Verification Collection
export const verificationsCollection = q
	.collection("verification")
	.options({ timestamps: true })
	.fields((f) => ({
		identifier: f.text({ required: true, maxLength: 255 }),
		value: f.text({ required: true, maxLength: 255 }),
		expiresAt: f.datetime({ required: true }),
	}))
	.title(({ f }) => f.identifier);

// API Key Collection (Better Auth apiKey plugin)
export const apiKeysCollection = q
	.collection("apikey")
	.options({ timestamps: true })
	.fields((f) => ({
		name: f.text({ maxLength: 255 }),
		start: f.text({ maxLength: 255 }),
		prefix: f.text({ maxLength: 255 }),
		key: f.text({ required: true, maxLength: 500, unique: true }),
		userId: f.text({ required: true, maxLength: 255 }),
		refillInterval: f.number(),
		refillAmount: f.number(),
		lastRefillAt: f.datetime(),
		enabled: f.boolean({ default: true }),
		rateLimitEnabled: f.boolean({ default: true }),
		rateLimitTimeWindow: f.number(),
		rateLimitMax: f.number(),
		requestCount: f.number({ default: 0 }),
		remaining: f.number(),
		lastRequest: f.datetime(),
		expiresAt: f.datetime(),
		permissions: f.textarea(), // Larger text for JSON permissions
		metadata: f.textarea(), // Larger text for JSON metadata
	}))
	.title(({ f }) => f.key);
