import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthRefreshToken` table (from `@better-auth/oauth-provider`).
 * Backs the `offline_access` scope / refresh-token grant. `token` is secret —
 * hidden from reads. `scopes` is a better-auth `string[]` stored as a JSON
 * string (text). Reference columns stay plain text like the other auth tables.
 */
export default collection("oauthRefreshToken")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		token: f.text(500).required(),
		clientId: f.text(255).required(),
		sessionId: f.text(255),
		userId: f.text(255).required(),
		referenceId: f.text(255),
		expiresAt: f.datetime(),
		createdAt: f.datetime(),
		revoked: f.datetime(),
		authTime: f.datetime(),
		scopes: f.textarea().required(),
	}))
	.access({
		fields: {
			token: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.clientId);
