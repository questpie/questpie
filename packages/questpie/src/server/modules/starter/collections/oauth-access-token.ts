import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthAccessToken` table (from `@better-auth/oauth-provider`).
 * Stores issued OAuth 2.1 access tokens with their granted `scopes`. Without
 * this table the provider fails at runtime and the MCP HTTP route cannot resolve
 * a session (the regression MO3 fixes). `token` is secret — hidden from reads.
 * `scopes` is a better-auth `string[]`; the pg drizzle adapter passes it as a
 * native array, so it MUST be a `jsonb` column (`f.json()`), not text.
 */
export default collection("oauthAccessToken")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		token: f.text(500),
		clientId: f.text(255).required(),
		sessionId: f.text(255),
		userId: f.text(255),
		referenceId: f.text(255),
		refreshId: f.text(255),
		expiresAt: f.datetime(),
		createdAt: f.datetime(),
		scopes: f.json().required(),
	}))
	.access({
		fields: {
			token: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.clientId);
