/**
 * Default auth config for the starter module.
 * Includes the admin plugin (role/ban management), bearer token plugin, and the
 * openAPI plugin (exposes `auth.api.generateOpenAPISchema()` so @questpie/openapi
 * can document the full, real auth surface instead of a hardcoded subset).
 *
 * User projects can override or extend via their own `config/auth.ts`.
 * Plugins are deduped by ID during merge, so duplicates are safe.
 */
import { admin, bearer, openAPI } from "better-auth/plugins";

import { authConfig } from "#questpie/server/config/factories.js";

export default authConfig({
	plugins: [admin(), bearer(), openAPI()],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
});
