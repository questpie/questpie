import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { service } from "#questpie/server/services/define-service.js";

/**
 * Auth service — creates the Better Auth instance from app config.
 *
 * Depends on: db (resolved via service container).
 * Namespace: null (top-level in AppContext as `auth`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		return betterAuth({
			...(app.config.auth ?? {}),
			database: drizzleAdapter(app.db, {
				provider: "pg",
				schema: app.getSchema(),
				transaction: true,
			}),
		});
	},
});
