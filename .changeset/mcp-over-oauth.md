---
"questpie": minor
"@questpie/mcp": minor
---

Add MCP-over-OAuth 2.1. An external MCP client can now connect to a QUESTPIE app purely via OAuth 2.1 (dynamic client registration → authorize + PKCE → consent → token → `POST /mcp`), authorized as `scopes ∩ RBAC`: out-of-scope tools are not even listed, and the user's `.access()` rules still apply.

- **First-class request `principal`** (`user | oauth | system`) — an OAuth access token resolves to the underlying user, so existing RBAC keeps working, with consented scopes layered on top.
- **Declarative granular scope catalog** — `collections:<name>:read|write|delete`, `globals:<name>:read|write`, `routes:<key>:invoke` (+ coarse `collections:*` umbrellas) DERIVED from the app's collections/globals/routes and merged into the provider at auth-instance build; the MCP scope gate derives its required scopes from the same source, so they never drift.
- **EdDSA token-verify pinning** — access-token verification is pinned to the exact algorithm the provider issues, rejecting algorithm-substitution.
- **Composable `oauthModule`** — the OAuth provider + OAuth tables are a self-contained module. `starterModule` bundles it (existing apps unchanged), and a custom-auth / headless (hono/elysia) app can add `oauthModule` on top of its own better-auth user model.
- Root OAuth/MCP discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/jwks`); the HTTP `/mcp` route requires a verified principal (401 + `WWW-Authenticate`). Uses `@better-auth/oauth-provider` (replaces the deprecated `mcp` / `oidc-provider` plugins).
