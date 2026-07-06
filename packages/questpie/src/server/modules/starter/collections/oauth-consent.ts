import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthConsent` table (from `@better-auth/oauth-provider`). Records
 * a user's granted consent (which `scopes`) for an OAuth client, so the consent
 * screen is skipped on subsequent authorizations. `scopes` is a better-auth
 * `string[]` stored as a JSON string (text). Reference columns stay plain text.
 */
export default collection("oauthConsent")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		clientId: f.text(255).required(),
		userId: f.text(255),
		referenceId: f.text(255),
		scopes: f.textarea().required(),
		createdAt: f.datetime(),
		updatedAt: f.datetime(),
	}))
	.title(({ f }) => f.clientId);
