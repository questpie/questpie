import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { applyOAuthScopeCatalog } from "#questpie/server/modules/core/integrated/auth/scope-catalog.js";
import {
	createAuthTransactionalDatabase,
	createAuthTransactionalQueuePlugin,
} from "#questpie/server/modules/core/integrated/auth/transactional-queue.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Auth service — creates the Better Auth instance from app config.
 *
 * Depends on: db (resolved via service container).
 * Namespace: null (top-level in AppContext as `auth`).
 *
 * `applyOAuthScopeCatalog` is the one seam that sees both the resolved auth
 * config and the fully-built `app`: it derives the OAuth scope catalog from the
 * app's collections/globals/routes (MO11) and merges it into the
 * `oauthProvider()` plugin. A no-op when no OAuth provider is configured.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const authOptions = applyOAuthScopeCatalog(app, app.config.auth ?? {});
		const jobs = app.config.queue?.jobs ?? {};
		return betterAuth({
			baseURL: app.config.app.url,
			secret: app.config.secret,
			...authOptions,
			plugins: [
				...(authOptions.plugins ?? []),
				createAuthTransactionalQueuePlugin({
					jobs,
					getQueue: () => app.queue,
				}),
			],
			database: drizzleAdapter(createAuthTransactionalDatabase(app.db), {
				provider: "pg",
				schema: app.getSchema(),
				transaction: true,
			}),
		});
	},
});
