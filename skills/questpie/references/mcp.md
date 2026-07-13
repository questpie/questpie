# MCP Integration

Use `@questpie/mcp` when a QUESTPIE app should expose collections, globals, annotated JSON routes, schemas, or custom tools to Model Context Protocol clients.

## Static Module Pattern

MCP is codegen-aware. Keep `modules.ts` static and put options in `config/mcp.ts`.

```ts title="modules.ts"
import mcpModule from "@questpie/mcp";

export default [mcpModule] as const;
```

```ts title="config/mcp.ts"
import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	crud: {
		defaults: {
			collections: { read: true, write: false, delete: false },
			globals: { read: true, write: false },
		},
		collections: {
			posts: { read: true, write: true },
			users: false,
		},
		globals: {
			siteSettings: { read: true, write: true },
		},
	},
	routes: {
		exposeAnnotated: true,
	},
});
```

Do not use `mcpModule(options)`. Runtime options belong in the plugin-discovered config file.

`mcpModule` carries its codegen plugin. Do not also add `mcpPlugin()` to `questpie.config.ts` unless you are doing a custom setup that deliberately omits `mcpModule`, double registration duplicates the plugin.

## CRUD Policy

Generated collection tools:

- `collections.{name}.list`
- `collections.{name}.count`
- `collections.{name}.get`
- `collections.{name}.create`
- `collections.{name}.update`
- `collections.{name}.delete`

Generated global tools:

- `globals.{name}.get`
- `globals.{name}.update`

Policy order:

1. Transport defaults.
2. CRUD defaults.
3. Per-entity override.
4. QUESTPIE access rules execute last and can still deny.

HTTP is user mode and read-oriented by default. HTTP cannot be made system mode with config or options. Stdio defaults to trusted system mode unless explicitly lowered to user mode.

Use `fields.include` / `fields.exclude` for top-level filtering. It applies to create/update input, CRUD outputs, list docs, global results, and schema resources. Nested relation projection is out of scope for v1.

## MCP over OAuth 2.1

`POST /mcp` requires a verified caller. Cookie/bearer sessions (first-party admin) resolve to a `user` principal; an external MCP client authenticates with an OAuth 2.1 access token and resolves to an `oauth` principal. An unauthenticated request gets `401` + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"` so the client auto-discovers the authorization server and starts the flow. Stdio never uses OAuth (see Programmatic Servers).

### Enabling It

The OAuth provider is an auth concern, not an MCP one, and lives in a **composable `oauthModule`** (`packages/questpie/src/server/modules/oauth/`): the `oauthProvider()` + `jwt()` Better Auth plugins, the OAuth tables (`oauth-*` collections + `jwks`), and - via `coreModule` - the root discovery routes. `starterModule` bundles `oauthModule` (`modules/starter/modules.ts` → `export default [oauthModule]`), and `adminModule` bundles `starterModule`, so any admin-enabled app already has all of it. You only add the endpoint:

```ts title="modules.ts"
import { adminModule } from "@questpie/admin/modules/admin";
import mcpModule from "@questpie/mcp";

export default [adminModule, mcpModule] as const;
```

(`create-questpie`'s "MCP" option adds `mcpModule` for you.) That composition is exactly what `packages/mcp/test/oauth-mcp-e2e.test.ts` exercises end to end - read it as the source of truth for the flow.

**Limitation:** a headless runtime with no `adminModule`/`starterModule` mounts `/mcp` but has NO OAuth provider, so HTTP MCP stays `401` with nothing to discover. A custom-auth/headless app enables it by adding the composable `oauthModule` on top of its own better-auth model (this shipped in 3.3.0, it is no longer a hand-wire-it-yourself follow-up). Stdio (trusted `system` worker) needs no OAuth and works on every runtime.

### Discovery Endpoints (server root)

- `/.well-known/oauth-authorization-server` - Authorization Server metadata (RFC 8414).
- `/.well-known/oauth-protected-resource` - Protected Resource metadata (RFC 9728).
- `/jwks` - JWK set for stateless token verification.

These are root-mounted (not under the auth `basePath`) because MCP clients look for them there. They proxy the provider's own helpers - issuer/JWKS/audience stay consistent with how tokens are issued.

### The Flow

Register (DCR) → authorize (+PKCE) → consent → token → call:

1. `POST /oauth2/register` - RFC 7591 dynamic client registration. MCP clients self-register as public clients (`token_endpoint_auth_method: "none"`), which forces PKCE.
2. `GET /oauth2/authorize` - with `code_challenge` (S256) and `resource=<mcp-endpoint-url>`. Redirects to `loginPage` (`/admin/login`) if no session, else to `consentPage` (`/admin/oauth/consent`).
3. `POST /oauth2/consent` - the admin consent screen approves the requested scopes (see the `questpie-admin` skill).
4. `POST /oauth2/token` - PKCE verifier + `resource` again → access token.
5. `POST /mcp` with `Authorization: Bearer <token>`.

`resource` (RFC 8707) binds the token to the MCP endpoint URL (`<app-url>/api/mcp`) as its audience (`aud`). **Only when `resource` is set is the token a verifiable JWT** (signed EdDSA, verified against `/jwks`); without it the token is opaque and the resource server cannot verify it. There is no `require_pkce` option - PKCE is enforced structurally by public-client (DCR) registration.

### Scope Model

Scopes are `<resource>:<name>:<verb>`, derived declaratively from the entity - no per-name hardcoding:

- Collections: `collections:<name>:read` | `:write` | `:delete`
- Globals: `globals:<name>:read` | `:write`
- Routes: `routes:<key>:invoke`

Plus two coarse **umbrellas**: `collections:read` and `collections:write`. An umbrella satisfies the matching granular `read`/`write` requirement for the same resource kind (`collections:read` covers `collections:posts:read`). Umbrellas exist for `read`/`write` ONLY - there is deliberately no umbrella for `:delete` or `routes:…:invoke` (least privilege), and `read`/`write` never cross (holding `collections:write` does not satisfy a `:read` requirement).

> The full granular catalog is DERIVED live, not hand-seeded: `buildScopeCatalog` + `applyOAuthScopeCatalog` (`core/integrated/auth/scope-catalog.ts`, wired at `core/services/auth.ts`) emit `collections:<name>:read|write|delete`, `globals:<name>:read|write`, and `routes:<key>:invoke` and union them into `oauthProvider.scopes` at auth-instance build. So a real DCR client CAN request the granular scopes. Nuance: only the umbrellas are advertised in discovery (`advertisedMetadata.scopes_supported`); the granular scopes are grantable but not enumerated there.

### Effective Permission = scopes ∩ RBAC

The scope gate is **additive** - it can only ever REMOVE access from an `oauth` caller, never grant it:

- The `oauth` principal's `accessMode` is always `"user"` (never `"system"`), so the collection/global `.access()` RBAC runs as that real user.
- The scope gate then narrows further: a tool is hidden at `tools/list` and denied at `tools/call` unless the token holds the required scope. So the effective bound is `scopes ∩ RBAC` - a token can never reach anything RBAC denies, and holding a broad scope never over-grants past RBAC.
- `system` (stdio) and `user` (admin cookie session) callers carry no scopes, so the scope gate does not apply to them - those paths are unchanged. Admin cookie sessions are unaffected by scopes.

### Declaring Required Scopes

Defaults are derived (`collections:posts:delete` for `collections.posts.delete`). Override declaratively:

```ts title="config/mcp.ts"
export default mcpConfig({
	crud: {
		collections: {
			posts: {
				read: true,
				write: true,
				// entity-level: every operation needs this
				requiredScopes: "collections:posts:write",
				// or per-operation (overrides the entity-level + default)
				operationScopes: { delete: "collections:posts:delete" },
			},
		},
	},
});
```

Custom tools declare their own scope (no default mapping exists for them, so omitting it requires no scope):

```ts
export default mcpTool("reports.generate", {
	inputSchema: z.object({ period: z.string() }),
	scopes: "routes:reports/generate:invoke",
}).handler(async ({ input, ctx }) => ({ structuredContent: {} }));
```

## Route Tools

Only simple JSON routes are auto-converted:

- Route has `.schema(...)`.
- Route is not `.raw()`.
- Route has `meta.mcp.expose === true`.
- `routes.exposeAnnotated` is not `false`.

```ts
route()
	.post()
	.schema(inputSchema)
	.outputSchema(outputSchema)
	.meta({
		title: "Generate report",
		mcp: {
			expose: true,
			name: "reports.generate",
			annotations: { readOnlyHint: true },
		},
	})
	.handler(async ({ input }) => ({ ok: true }));
```

Routes without path params use the route input schema directly. Routes with params use `{ params, input }`. Route policy keys use the route key, not the overridden tool name.

## Resources

Built-in resources:

- `questpie://schema/collections`
- `questpie://schema/collections/{name}`
- `questpie://schema/globals`
- `questpie://schema/globals/{name}`
- `questpie://schema/routes`
- `questpie://schema/routes/{key}`

Resources honor MCP policy and QUESTPIE access visibility. Route resources include input/output JSON Schema when the route has Zod schemas.

## Custom Tools

Custom tools live in `mcp-tools/` and are discovered by codegen.

```ts
import { mcpTool } from "@questpie/mcp";
import { z } from "zod";

export default mcpTool("generate-report", {
	description: "Generate a report.",
	inputSchema: z.object({ period: z.string() }),
	access: ({ session }) => !!session,
}).handler(async ({ input, ctx }) => ({
	structuredContent: await ctx.services.reports.generate(input),
}));
```

Custom tool access is checked during `tools/list` and again during `tools/call`.

## Programmatic Servers

Use `createMcpServer(app, { transport: "http", request })` for programmatic HTTP setup. If no `ctx` is passed, the request is preserved through `app.createContext()`.

Use `startStdioServer(app)` for trusted stdio integrations:

```ts
import { app } from "#questpie";
import { startStdioServer } from "@questpie/mcp/stdio";

await startStdioServer(app);
```

## Gotchas

- Add `mcpModule` to static `modules.ts`, then run codegen.
- HTTP callers are always `user` or `oauth`, never `system` - HTTP cannot be elevated to system mode. External access goes through OAuth (bounded by `scopes ∩ RBAC`), not system mode. Only stdio is `system`.
- Field filtering is top-level only.
- Raw routes and unannotated routes are not tools.
- Custom tool results should use `structuredContent` for machine-readable output.
