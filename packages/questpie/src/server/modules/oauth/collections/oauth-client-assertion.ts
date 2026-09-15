import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthClientAssertion` table (from `@better-auth/oauth-provider`
 * 1.7). Records a used client assertion by its JWT id (the row `id`) until it
 * expires, so the same assertion cannot be replayed at the token endpoint.
 */
export default collection("oauthClientAssertion")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		expiresAt: f.datetime().required(),
	}))
	.title(({ f }) => f.expiresAt);
