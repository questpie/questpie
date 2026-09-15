import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { surfaceRecognisedPostgresErrors } from "#questpie/server/modules/core/integrated/auth/adapter-postgres-errors.js";
import { createOAuthNativeLoopbackRegistrationPlugin } from "#questpie/server/modules/core/integrated/auth/oauth-native-registration.js";
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
		const auth = betterAuth({
			baseURL: app.config.app.url,
			secret: app.config.secret,
			...authOptions,
			plugins: [
				// Better Auth initializes plugins in array order. Bind only the
				// framework adapter so a later user replacement fails closed.
				createAuthTransactionalQueuePlugin({
					jobs,
					getQueue: () => app.queue,
				}),
				...(authOptions.plugins ?? []),
				...(authOptions.plugins?.some(
					(plugin) => plugin?.id === "oauth-provider",
				)
					? [createOAuthNativeLoopbackRegistrationPlugin()]
					: []),
			],
			database: surfaceRecognisedPostgresErrors(
				drizzleAdapter(createAuthTransactionalDatabase(app.db), {
					provider: "pg",
					schema: app.getSchema(),
					transaction: true,
				}),
			),
		});
		// Better Auth 1.7 plugins query the database while the context initialises
		// (oauth-provider seeds `oauthResource`). A CLI command that closes the
		// connection before that finishes must not crash the process on an
		// unhandled rejection; anything awaiting the context still receives it.
		auth.$context.catch(() => {});
		return auth;
	},
});
