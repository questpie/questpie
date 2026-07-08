/**
 * Default auth config for the starter module.
 * Includes the admin plugin (role/ban management), bearer token plugin, and
 * the OAuth 2.1 provider (`@better-auth/oauth-provider`) + `jwt()` that back
 * MCP-over-OAuth. The OAuth provider replaces the deprecated `mcp` /
 * `oidc-provider` plugins.
 *
 * ── How MCP-over-OAuth composes (no bespoke internal APIs) ──
 * The OAuth provider is an AUTH concern and lives HERE, alongside the OAuth
 * tables (`collections/oauth-*.ts`, `jwks`). The rest of the flow is assembled
 * from ordinary, userland-visible seams — nothing hidden, no imperative switch:
 * - This starter config declares `oauthProvider()` + `jwt()` (the provider).
 * - `coreModule` (auto-included) mounts the root discovery routes
 *   (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`,
 *   `/jwks`) as plain `route()` definitions.
 * - The QUESTPIE adapter resolves a bearer JWT to an `oauth` principal
 *   (`resolveOAuthPrincipal`) — one auth seam for MCP and any future
 *   OAuth-protected route.
 * - `@questpie/mcp`'s `mcpModule` mounts `POST /mcp` (requiring a verified
 *   principal) and runs the scope gate (`scopeGateAllows`) alongside RBAC.
 * So an app is OAuth-MCP-ready simply by using the starter (directly, or via
 * `adminModule`, which bundles it) and adding `mcpModule` — the exact
 * composition the e2e (`packages/mcp/test/oauth-mcp-e2e.test.ts`) exercises.
 *
 * User projects can override or extend via their own `config/auth.ts`.
 * Plugins are deduped by ID during merge (see auth/merge.ts), so duplicates —
 * including a user-supplied `oauthProvider()` (id `"oauth-provider"`) — are safe;
 * an app's own admin+bearer config keeps the starter's `oauth-provider`/`jwt`.
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
 * The OIDC base scopes the provider always offers (`openid` marks it an OIDC
 * server). The QUESTPIE resource scope catalog — the coarse `collections:*`
 * umbrellas (MO1 #2) plus the granular `collections:<name>:read|write|delete`,
 * `globals:<name>:read|write`, `routes:<key>:invoke` — is DERIVED from the app's
 * collections/globals/routes and merged in at auth-instance build time by
 * `applyOAuthScopeCatalog` (MO11, `core/integrated/auth/scope-catalog.ts`).
 * `config/auth.ts` cannot see the app's resources, so the framework wires them in
 * there — the same declarative source the MCP scope gate derives from, so the two
 * can never drift.
 */
const OIDC_BASE_SCOPES: string[] = [
	"openid",
	"profile",
	"email",
	"offline_access",
];

export default authConfig({
	plugins: [
		admin(),
		bearer(),
		jwt(),
		oauthProvider({
			loginPage: "/admin/login",
			consentPage: "/admin/oauth/consent",
			// Resource scopes (umbrellas + granular) are unioned in by MO11.
			scopes: OIDC_BASE_SCOPES,
			// Public subset advertised at the discovery endpoints. MO11 unions the
			// coarse umbrellas in; the granular per-resource scopes stay grantable
			// but are not publicly enumerated.
			advertisedMetadata: {
				scopes_supported: ["openid", "profile", "email"],
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
