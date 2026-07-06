import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthClient` table (from `@better-auth/oauth-provider`). One row
 * per registered OAuth client / application (incl. RFC 7591 dynamically
 * registered MCP clients). `clientSecret` is secret — hidden from reads.
 *
 * `scopes`/`contacts`/`redirectUris`/… are better-auth `string[]` fields and
 * `metadata` is a `json` field; the drizzle adapter serializes both to JSON
 * strings (supportsJSON/supportsArrays = false), so they are stored as text.
 * Reference columns (`userId` → user) stay plain text, matching the existing
 * auth collections (better-auth enforces integrity at the app layer).
 */
export default collection("oauthClient")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		clientId: f.text(255).required(),
		clientSecret: f.text(500),
		disabled: f.boolean().default(false),
		skipConsent: f.boolean(),
		enableEndSession: f.boolean(),
		subjectType: f.text(255),
		scopes: f.textarea(),
		userId: f.text(255),
		createdAt: f.datetime(),
		updatedAt: f.datetime(),
		name: f.text(255),
		uri: f.text(500),
		icon: f.text(500),
		contacts: f.textarea(),
		tos: f.text(500),
		policy: f.text(500),
		softwareId: f.text(255),
		softwareVersion: f.text(255),
		softwareStatement: f.textarea(),
		redirectUris: f.textarea().required(),
		postLogoutRedirectUris: f.textarea(),
		tokenEndpointAuthMethod: f.text(255),
		grantTypes: f.textarea(),
		responseTypes: f.textarea(),
		public: f.boolean(),
		type: f.text(255),
		requirePKCE: f.boolean(),
		referenceId: f.text(255),
		metadata: f.textarea(),
	}))
	.access({
		fields: {
			clientSecret: { read: false, create: false, update: false },
		},
	})
	.title(({ f }) => f.clientId);
