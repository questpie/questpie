/**
 * Default auth config for the starter module: the admin plugin (role/ban
 * management), bearer token plugin, and openAPI plugin (which exposes
 * `auth.api.generateOpenAPISchema()` for @questpie/openapi).
 *
 * The OAuth 2.1 provider (`oauthProvider()` + `jwt()`) and the OAuth tables
 * (`collections/oauth-*.ts`, `jwks`) live in `oauthModule`, which `starterModule`
 * includes (see `modules.ts`) — so every starter/admin app is OAuth-MCP-ready,
 * while a custom-auth headless app can add `oauthModule` on top of its own
 * better-auth user model without pulling in admin.
 *
 * User projects can override or extend via their own `config/auth.ts`. Plugins
 * are deduped by ID during merge (see auth/merge.ts), so duplicates are safe.
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
