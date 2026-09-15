import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthRefreshToken` table (from `@better-auth/oauth-provider`).
 * Backs the `offline_access` scope / refresh-token grant. `token` is secret —
 * hidden from reads. `scopes` is a better-auth `string[]`; the pg drizzle
 * adapter passes it as a native array, so it MUST be a `jsonb` column
 * (`f.json()`), not text. Reference columns stay plain text like the other
 * auth tables.
 */
export default collection("oauthRefreshToken")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		token: f.text(500).required(),
		clientId: f.text(255).required(),
		sessionId: f.text(255),
		userId: f.text(255).required(),
		referenceId: f.text(255),
		authorizationCodeId: f.text(255),
		expiresAt: f.datetime(),
		createdAt: f.datetime(),
		revoked: f.datetime(),
		rotatedAt: f.datetime(),
		rotationReplayResponse: f.textarea(),
		rotationReplayExpiresAt: f.datetime(),
		authTime: f.datetime(),
		scopes: f.json().required(),
		resources: f.json(),
		requestedUserInfoClaims: f.json(),
		confirmation: f.json(),
	}))
	.access({
		fields: {
			token: { read: false, create: false, update: false },
			rotationReplayResponse: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.clientId);
