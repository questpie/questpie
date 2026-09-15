import { uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";

/**
 * Better Auth `oauthClientResource` join table (from `@better-auth/oauth-provider`
 * 1.7): which client may request which resource. `resourceId` holds the
 * resource's `identifier`, not its row id. Better Auth relies on `(clientId,
 * resourceId)` being unique, so the pair carries a unique index. References stay
 * plain text, matching the other auth collections.
 */
export default collection("oauthClientResource")
	.options({ timestamps: false })
	.fields(({ f }) => ({
		clientId: f.text(255).required(),
		resourceId: f.text(500).required(),
		metadata: f.json(),
		createdAt: f.datetime(),
	}))
	.indexes(({ table }) => [uniqueIndex().on(table.clientId, table.resourceId)])
	.title(({ f }) => f.clientId);
