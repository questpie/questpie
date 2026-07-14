# @questpie/mcp

## 3.15.0

### Patch Changes

- [#166](https://github.com/questpie/questpie/pull/166) [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Advertise OAuth protected-resource metadata at the actual MCP adapter mount path, including generated apps mounted under `/api`, and allow public MCP clients to complete dynamic client registration before the user signs in.

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0

## 3.3.0

### Minor Changes

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make the AI, MCP, and sandbox packages publishable with release metadata, README documentation, package typecheck fixes, and stable sandbox adapter tests.

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add MCP-over-OAuth 2.1. An external MCP client can now connect to a QUESTPIE app purely via OAuth 2.1 (dynamic client registration → authorize + PKCE → consent → token → `POST /mcp`), authorized as `scopes ∩ RBAC`: out-of-scope tools are not even listed, and the user's `.access()` rules still apply.

  - **First-class request `principal`** (`user | oauth | system`) — an OAuth access token resolves to the underlying user, so existing RBAC keeps working, with consented scopes layered on top.
  - **Declarative granular scope catalog** — `collections:<name>:read|write|delete`, `globals:<name>:read|write`, `routes:<key>:invoke` (+ coarse `collections:*` umbrellas) DERIVED from the app's collections/globals/routes and merged into the provider at auth-instance build; the MCP scope gate derives its required scopes from the same source, so they never drift.
  - **EdDSA token-verify pinning** — access-token verification is pinned to the exact algorithm the provider issues, rejecting algorithm-substitution.
  - **Composable `oauthModule`** — the OAuth provider + OAuth tables are a self-contained module. `starterModule` bundles it (existing apps unchanged), and a custom-auth / headless (hono/elysia) app can add `oauthModule` on top of its own better-auth user model.
  - Root OAuth/MCP discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/jwks`); the HTTP `/mcp` route requires a verified principal (401 + `WWW-Authenticate`). Uses `@better-auth/oauth-provider` (replaces the deprecated `mcp` / `oidc-provider` plugins).

- [#125](https://github.com/questpie/questpie/pull/125) [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The MCP HTTP endpoint is now expressed through the codegen route convention instead of a hand-written `module.ts`: one shared `mcpHandler` registered by four single-method route files (`mcp.ts` = POST, `mcp.get.ts`, `mcp.delete.ts`, `mcp.options.ts`) on the same `mcp` path. To support this, the codegen file convention now recognises `.options` and `.head` method suffixes (e.g. `mcp.options.ts` → route key `mcp:OPTIONS`), matching the existing `.get`/`.post`/`.put`/`.patch`/`.delete` handling.

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - questpie@3.14.0
