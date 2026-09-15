import { uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthResource` table (from `@better-auth/oauth-provider` 1.7). One
 * row per protected resource the provider issues access tokens for; `identifier`
 * is the RFC 8707 `resource` parameter value, so it is unique. A token can only
 * target an enabled row here, which is what binds its audience (GHSA-p2fr-6hmx-4528).
 *
 * Rows are seeded at boot from `oauthProvider({ resources })`. `allowedScopes` is
 * a better-auth `string[]` and `customClaims`/`metadata` are `json`, so all three
 * are `jsonb` (see `oauth-client.ts`).
 */
export default collection("oauthResource")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		identifier: f.text(500).required(),
		name: f.text(255).required(),
		accessTokenTtl: f.number(),
		refreshTokenTtl: f.number(),
		signingAlgorithm: f.text(50),
		signingKeyId: f.text(255),
		allowedScopes: f.json(),
		customClaims: f.json(),
		dpopBoundAccessTokensRequired: f.boolean().default(false),
		disabled: f.boolean().default(false),
		createdAt: f.datetime(),
		updatedAt: f.datetime(),
		policyVersion: f.number().default(1),
		metadata: f.json(),
	}))
	.indexes(({ table }) => [uniqueIndex().on(table.identifier)])
	.title(({ f }) => f.identifier);
