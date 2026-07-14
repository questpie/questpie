# OpenAPI + Scalar (@questpie/openapi)

Auto-generates an **OpenAPI 3.1** spec by introspecting the running app, collections (CRUD), globals (get/update), standalone routes (Zod-derived schemas), Better Auth, and search, and serves it as raw JSON plus an interactive **Scalar** reference. No decorators, no hand-written spec, no build step: it reads the same runtime metadata (`app.getCollections()`, `app.getGlobals()`, `app.config.routes`) that powers the typed client and admin.

Opt-in package: `bun add @questpie/openapi`. Peer `questpie ^3`, dep `zod ^4`.

## Setup

Register the module (it carries its own codegen plugin); routes are auto-wired:

```ts
// src/questpie/server/modules.ts
import { openApiModule } from "@questpie/openapi/server";
export default [openApiModule /* , … */] as const;
```

Optional config in `config/openapi.ts`:

```ts
import { openApiConfig } from "@questpie/openapi/server";
export default openApiConfig({
	info: { title: "My API", version: "1.0.0" },
	servers: [{ url: "https://api.example.com" }],
	basePath: "/api",           // MUST match the fetch handler's base path
	scalar: { theme: "purple" },
	auth: true, search: true,   // set false to omit those paths
});
```

Served routes (under `basePath`): `GET /api/openapi.json` (spec) and `GET /api/docs` (Scalar UI). Route keys are hardcoded `openapi.json`/`docs`, the `specPath`/`docsPath` options are **dead** (no-ops).

## Exports

`@questpie/openapi/server` (the real surface): `openApiConfig`, `generateOpenApiSpec(app, config?)`, `openApiRoute`, `docsRoute`, `openApiModule` (also default). `openApiModule` is reachable from the root, `/server`, and `/modules/openapi`. `openApiConfig()` is a pure identity factory (type inference only); config is read at runtime from `app.state.config.openapi`.

Standalone (no module): `const spec = generateOpenApiSpec(app)` returns the full `OpenApiSpec` object.

## What Gets Introspected

- **Collections** → `GET /{c}` (list), `POST /{c}` (create), `/count`, `POST /{c}/delete-many`, `/schema`, `/meta`, `GET|PATCH|DELETE /{c}/{id}`, `/versions`, `/revert`. **Conditional**: `/upload` (needs `state.upload`), `/{id}/restore` (needs `softDelete`), `/{id}/transition` (needs versioning workflow). Components `{Pascal}Document`/`Insert`/`Update`. Tag `Collections: <name>`.
- **Globals** → `GET|PATCH /globals/{name}`, `/schema`, `/versions`, `/revert`, `/transition` (if workflow). Tag `Globals: <name>`.
- **Routes** → flattens the routes tree; kebab-cases literals; `[param]`/`[...slug]` → `{param}`/`{slug}`; splits trailing `:METHOD` suffix; input from `.schema()`, output from `.outputSchema()`. `.raw()` routes get a permissive body + generic `200`/`401`. Tag `Routes: <top-level-segment>`.
- **Auth** (unless `auth:false`) → `/auth/sign-in/email`, `/sign-up/email`, `/get-session`, `/sign-out`.
- **Search** (unless `search:false`) → `POST /search`, `POST /search/reindex/{collection}`.
- **Field input/output flags** (undocumented elsewhere): from each field's zod schema it builds insert/update/response variants, `input:false` fields are dropped from request bodies, `output:false` from responses, cross-cases marked `readOnly`/`writeOnly` (recurses into nested fields).

Two security schemes advertised: `bearerAuth` (http bearer) + `cookieAuth` (`better-auth.session_token`). Base components: `ErrorResponse`, `SuccessResponse`, `CountResponse`, `DeleteManyResponse`.

## Caching

`openApiRoute()` lazy-generates the spec once per app instance (`WeakMap`) and serves it with a hash `ETag`, `Cache-Control: public, max-age=3600, stale-while-revalidate=43200`, `Access-Control-Allow-Origin: *`, and `304` on match. **The `docs` route is NOT cached**, `docsRoute()` regenerates the spec on every request.

## Limitations (all TRUE in code, do NOT document the roadmap as done)

- **Zod→JSON-Schema fallback.** Route schemas call `z.toJSONSchema()` with no options; on throw (transforms, refinements) they fall back to `{ type: "object", description: "Schema could not be generated" }`. Collections/globals are more tolerant (`{ unrepresentable: "any" }`).
- **Security is declared once at spec root, not per-path.** `PathOperation.security` exists in the type but no generator populates it.
- **Path params are always `{ type: "string" }`** regardless of the real Zod type (routes, collection `{id}`, search `{collection}`).
- **Route `.meta()` is NOT wired.** `RouteMeta` (`title`/`description`/`tags`/`mcp`) is carried on route defs but the generator ignores it: `summary` is always the path, `tags` always `Routes: <segment>`. (Contrast [[mcp]], which DOES read `meta.mcp`.)
- `openapi-quality-v1` is a **docs-only roadmap label**, it appears nowhere in the source.

## Rules

- Set `basePath` to match your fetch handler, or documented URLs won't match served ones.
- Routes without `.outputSchema()` document their response as an opaque `{ type: "object" }`, add output schemas for accurate docs.
- The spec/docs routes have no built-in access rule; they advertise how to auth but don't enforce it. Gate them yourself if the API surface is sensitive.
- Don't rely on per-operation security or typed path params yet (see Limitations).

Full reference: docs page `integrations/openapi`. Related: [[mcp]] (same route introspection, but consumes `.meta()`), routes reference.
