/**
 * Default auth config for the starter module.
 * Includes the admin plugin (role/ban management), bearer token plugin, and
 * the OAuth 2.1 provider (`@better-auth/oauth-provider`) + `jwt()` that back
 * MCP-over-OAuth. The OAuth provider replaces the deprecated `mcp` /
 * `oidc-provider` plugins.
 *
 * User projects can override or extend via their own `config/auth.ts`.
 * Plugins are deduped by ID during merge (see auth/merge.ts), so duplicates —
 * including a user-supplied `oauthProvider()` (id `"oauth-provider"`) — are safe.
 */
import { oauthProvider } from "@better-auth/oauth-provider";
import { admin, bearer, jwt } from "better-auth/plugins";

import { authConfig } from "#questpie/server/config/factories.js";

/**
 * Audience (`aud`) the OAuth provider binds access tokens to = the MCP endpoint
 * URL (RFC 8707 resource indicator), per the MO1 decision. Derived from the same
 * app-URL env chain the framework resolves `app.url` from
 * (`QUESTPIE_APP_URL` → `APP_URL` → `http://localhost:3000`) + the `/api/mcp`
 * route path. `oauthProvider.validAudiences` and `verifyAccessToken` both check
 * `aud` against this so a token cannot be replayed against other endpoints.
 *
 * TODO(mo4/mo9): finalize `aud` from the resolved MCP route URL once the root
 * discovery endpoints exist, instead of re-deriving it from env here.
 */
const appUrl =
	process.env.QUESTPIE_APP_URL ??
	process.env.APP_URL ??
	"http://localhost:3000";
const mcpAudience = `${appUrl.replace(/\/$/, "")}/api/mcp`;

/**
 * SEED scope catalog placeholder. The full declarative catalog — generated from
 * collections/globals/routes as `collections:<name>:read|write|delete`,
 * `globals:<name>:read|write`, `routes:<key>:invoke` — lands in MO11. Here we
 * only seed the OIDC scopes the provider needs (`openid` marks it an OIDC
 * server) plus the coarse `collections:*` umbrellas from MO1 #2.
 */
const SEED_SCOPES: string[] = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"collections:read",
	"collections:write",
];

export default authConfig({
	plugins: [
		admin(),
		bearer(),
		jwt(),
		oauthProvider({
			loginPage: "/admin/login",
			consentPage: "/admin/oauth/consent",
			scopes: SEED_SCOPES,
			// Public subset advertised at the discovery endpoints (MO11 expands this).
			advertisedMetadata: {
				scopes_supported: ["openid", "profile", "email", "collections:read"],
			},
			// RFC 7591 dynamic client registration — MCP clients self-register —
			// but keep it gated: unauthenticated registration stays off.
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: false,
			// OAuth 2.1: PKCE. There is no global plugin toggle; the provider
			// enforces PKCE for every DCR-registered (public) client — a client
			// registering with `require_pkce: false` is rejected. MCP clients
			// self-register via DCR, so PKCE is always required for them.
			validAudiences: [mcpAudience],
			accessTokenExpiresIn: 3600, // 1 hour (seconds).
		}),
	],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
});
