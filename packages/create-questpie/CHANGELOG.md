# create-questpie

## 2.4.0

### Minor Changes

- [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix two things every scaffolded project inherited.

  **Shutdown.** Only the TanStack Start template released what the app opened.
  Hono, Elysia and Next shipped no hook at all, so service `dispose` callbacks
  never fired, `destroyApp()` never ran, and every buffered observability span was
  lost on each deploy. Each template now gets the hook its own server offers.
  Elysia holds its server so it drains first. Hono and Next have no handle, so
  they release resources without draining, and say so.

  **Migrations.** All four templates set `cli.migrations.directory`, which is the
  only place `migrate:create` writes when present. Codegen only ever scans the
  server root, so `questpie migrate` answered "No migrations found" on a fresh
  project, and the search adapter's index migrations were skipped with it. The key
  is gone, so both commands resolve the same directory.

## 2.3.0

### Minor Changes

- [#183](https://github.com/questpie/questpie/pull/183) [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove the deprecated realtime compatibility layer and make Realtime v2 the only supported contract.

  QUESTPIE currently has no external realtime adopters, so this cleanup ships during
  the pre-adoption 3.x window as a minor release instead of reserving an otherwise
  empty 4.0 major solely for the removed compatibility surface.

  - Remove `RealtimeAdapter`, `realtime.adapter`, `realtime.rollout`, the `legacy` and `dual` modes, and the old Postgres, Redis Streams, and Cloudflare realtime adapter entrypoints.
  - Remove delta control frames and client downgrade behavior. Companion control now requires complete desired topology protocol v2.
  - Keep `ChangeBroker`, the distributed topology coordinator, structured non-retryable admission errors, and the default `maxFindLimit` of 100 as the supported framework path.

  Upgrade all QUESTPIE realtime clients and servers together within the consolidated
  3.x minor train. Postgres apps continue to receive the automatic
  `PgNotifyChangeBroker`; Redis deployments should configure
  `redisStreamsChangeBroker`.

## 2.2.2

### Patch Changes

- [#174](https://github.com/questpie/questpie/pull/174) [`03f17b6`](https://github.com/questpie/questpie/commit/03f17b63c3aff238a076446fbe444e655e65e184) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Wait for the canonical QUESTPIE skill installation, record project-local lock
  provenance, and report a deterministic recovery command when installation
  fails.

## 2.2.1

### Patch Changes

- [#170](https://github.com/questpie/questpie/pull/170) [`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Always tear down the application after `questpie push` so adapter handles cannot keep deployment init containers running after the schema is applied. Keep the development-only warning visible with `--force`, and make generated project guidance explicit that production deployments must use committed migrations.

## 2.2.0

### Minor Changes

- [#166](https://github.com/questpie/questpie/pull/166) [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Release the MCP module scaffold option so `--module mcp` installs `@questpie/mcp` and registers `mcpModule` in generated projects.

## 2.1.2

### Patch Changes

- [#115](https://github.com/questpie/questpie/pull/115) [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Mobile-first admin overhaul — the admin panel is now genuinely usable on phones (≤390px).
  - **Touch foundation:** 44px touch targets and 16px inputs under `@media (pointer: coarse)` (no more iOS zoom-on-focus), `hover: none` fallbacks so hover-only controls stay reachable, `touch-action`/tap-highlight tuning, and `svh`/`dvh` instead of `vh`.
  - **Navigation & forms:** a persistent mobile header with a reopenable navigation drawer, a sticky bottom save bar on record forms, and confirmation/workflow dialogs that become bottom drawers on mobile.
  - **List view:** replaces the desktop horizontal-scroll table on mobile with compact, expandable record rows — tap a row to reveal the remaining fields inline — reusing the same cell renderers, selection, bulk actions, sorting, presence and reorder.
  - **Fields:** native date pickers, correct `inputMode` keyboards, comfortable select/array/relation controls, and a working relation reorder.
  - **Media, editors, filters, dashboard** reflow for narrow screens; live-preview re-render churn is fixed by isolating the preview iframe behind `React.memo`.
  - `create-questpie` templates now emit `viewport-fit=cover` + a `theme-color` so the admin sits correctly under device notches with branded browser chrome.

## 2.1.1

### Patch Changes

- [#111](https://github.com/questpie/questpie/pull/111) [`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Tighten scaffold conventions, generated app typing, and admin auth session inference.

## 2.1.0

### Minor Changes

- [#109](https://github.com/questpie/questpie/pull/109) [`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Multi-runtime scaffolding: choose **TanStack Start, Next.js, Hono, or Elysia**.
  - **Next.js** (App Router, Turbopack) and **TanStack Start** are full-stack —
    admin UI, OpenAPI/Scalar docs, typed client + TanStack Query.
  - **Hono** and **Elysia** are headless API servers on Bun (no admin UI).
  - Interactive runtime + module selection; agent skills installed via
    `bunx skills add questpie/questpie`.
  - Every template ships an extensionless-import shared core that is
    byte-identical across runtimes; each was boot-verified to start with zero
    errors.

## 2.0.4

### Patch Changes

- [#97](https://github.com/questpie/questpie/pull/97) [`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The 3.6.0 dogfooding batch — fixes and primitives surfaced by building a real app (jubli) on the framework.

  **Correctness**

  - `/health` no longer reports `search: degraded` forever — `SearchService.isInitialized()` exists now.
  - Multi-field `orderBy` applies every field (drizzle's `.orderBy()` replaces, so clauses are collected into one call); keyset pagination with tiebreaks is correct.
  - System timestamps use millisecond precision (`timestamp(3)`) — a `Date` you read equals the value stored; ms-boundary keyset cursors no longer skip rows.
  - Conditional updates are atomic: `update()`/`updateMany()` lock candidate rows and re-check the `where` inside the transaction, returning the winners array — parallel claims can no longer both succeed. `updateMany` is the canonical bulk name and unknown CRUD methods fail loud with suggestions instead of `undefined is not a function`.
  - `questpie push` works on the default bun-sql driver — driver results are normalized at one seam.
  - Server-side validation enforces field-level zod schemas (`.zod()` transforms, email format, select enums, array shapes) on create/update — previously they only drove admin forms and OpenAPI.

  **Access control**

  - Deny-all means deny-all: the `visibility: "public"` upload read short-circuit is gone. New `serve` access kind separates listing rows from fetching bytes by key (signed-token check for private files still always applies), and the new `introspect` kind gates `/{schema,meta}` through the normal access system.
  - Access rules are typed per operation: `create` rules get a typed `input`, `update`/`delete`/`transition` rules get a non-optional typed `data` (and `update` a typed patch `input`).

  **Composition**

  - `.fields()` on collections and globals is cumulative — it adds and overrides by key, never wipes builder state, so `collection("user").merge(starterModule.collections.user).fields(...)` keeps the whole starter model. `.merge()` preserves unresolved relation fields from both sides.
  - Typed field escape hatches: `.zod()` propagates the returned schema's output into the field's value type, `.$type<T>()` sets it explicitly with zero runtime effect, and `.drizzle()` remains the raw column hatch (constraints/defaults land in DDL) with `$type` propagation.

  **New primitives**

  - **Request context**: the `appConfig({ context })` resolver result travels with the request — typed and available in access rules, hooks, route handlers, field access, search, and `getContext()`.
  - **Env**: `env.ts` convention validates at boot (before adapters/auth/db init) with aggregate errors and framework base vars; `env.client.ts` + codegen emit per-bundler client env modules with literal `process.env.PREFIX_*` references — server keys are physically absent from client artifacts.
  - **Realtime client contract**: typed `live()`/`liveIter()` mirror `find()` typing on the client; `{ realtime: true }` is part of the public @questpie/tanstack-query types; the wire payload is a documented, stable contract.
  - **Infer-first types**: codegen auto-populates names-only key registries — `f.relation("…")` autocompletes collection keys (plain strings keep compiling). The generated index exports `AccessRuleContext<K>`, `HookRuleContext<K>`, `CollectionDoc<K>`, `GlobalDoc<K>`, `AppSession`, `AppSessionUser`, and `ctx.app` is fully typed on every handler context. `InferRouteInput/Output/Params` exported for tRPC-style standalone inference.

  **Codegen + teaching**

  - Codegen templates fixed: builder augmentations merge cleanly (identical type parameter lists), job handler `collections` typing no longer collapses in module graphs, and `.test.`/`.spec.`/`__tests__` files are never discovered as conventions.
  - Docs and the shipped skill teach all of the above — including the type-inference map (`references/type-inference.md`), Better Auth callback context facts, and ~20 previously undocumented primitives — with a repeatable skill-coverage gate (`scripts/skill-coverage.ts`).
  - All teaching examples use `relation("user")` (the starter key); the Better Auth anonymous-plugin recipe is documented.

## 2.0.3

### Patch Changes

- [#57](https://github.com/questpie/questpie/pull/57) [`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Enhance the existing Preview flow with visual editing support, draft patch synchronization, inline scalar editing, block preview annotations, and block insertion affordances wired to the existing block editor.

  Update the barbershop example, documentation, scaffolder templates, and bundled QUESTPIE skills to describe and preserve the single Preview system architecture.

  Cache admin auth branding snapshots to avoid React update loops on login pages, translate select option labels consistently across admin tables and related UI, reduce hook recursion noise for legitimate nested read flows, resolve generated app output next to re-exported server configs for CLI commands, and add configurable request logging with request/trace id propagation and scoped application log correlation.

  The observability work provides a foundation without introducing OpenTelemetry tracing or exporter dependencies yet.

  Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to QUESTPIE Cloud.

## 2.0.2

### Patch Changes

- [#41](https://github.com/questpie/questpie/pull/41) [`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Prepare the next patch release across admin, core, scaffolding, and the Iconify Vite plugin.
  - Improve admin browser titles, metadata, dashboard widget sizing, form sidebar responsiveness, upload previews, localized validation messages, and file-first chrome/theme customization paths.
  - Add an admin-managed user avatar upload field backed by the assets collection while keeping Better Auth's `image` URL field compatible.
  - Expose a media upload sheet from upload-enabled collection list views.
  - Route admin server Drizzle imports through the `questpie` Drizzle re-exports so admin tests and published package consumers do not require a duplicate direct Drizzle resolution.
  - Improve migration and seed validation robustness, route/context propagation, and stricter CLI path/category/integer option parsing.
  - Harden project scaffolding with `.env` creation, non-interactive database/codegen/skills options, generated-project QUESTPIE agent skills, and fresh-app verification scripts.
  - Fix `@questpie/vite-plugin-iconify` package exports so the published package resolves to the built `dist/index.mjs` entrypoint with bundled declarations.

## 2.0.1

### Patch Changes

- [`fca6096`](https://github.com/questpie/questpie/commit/fca60967ee1c2b6b8fb439230e663daea60b0465) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Align v3 docs, generated app types, and the create-questpie starter template with the current file-convention and app API behavior.

## 2.0.0

### Major Changes

- [`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78) Thanks [@drepkovsky](https://github.com/drepkovsky)! - # QuestPie v3

  Full v3 architecture redesign — module system, core module extraction, service definitions, route conventions, and type-safe field methods.

  ## Breaking Changes

  - **`QuestpieBuilder` removed** — `q()`, `.use()`, `.build()` chain replaced by file convention + `questpie generate`
  - **RPC module removed** — replaced by `routes/*.ts` directory with `route()` builder
  - **`app.api.*` removed** — use `app.collections` / `app.globals` direct getters
  - **Positional callbacks → destructured** — `.fields((f) => ...)` → `.fields(({ f }) => ...)`
  - **`contextResolver` removed** — session/locale are scoped CRUD context params
  - **`RegisteredApp` type removed** — use `typedApp<App>(ctx.app)` instead
  - **`fetchFn` → `loader`** on all dashboard widget types
  - **Secure-by-default access** — authenticated session required when no access rules defined
  - **Audit module opt-in** — `auditModule` must be explicitly added via `.use(auditModule)`

  ## New Features

  - **Module system** — core infrastructure (search, realtime, auth, queue) wired as formal service definitions
  - **`fieldType()` + `FieldWithMethods`** — type-safe field chain methods (`.manyToMany()`, `.trim()`, `.autoNow()`, etc.)
  - **Hook type safety** — fully typed `ctx.data` in collection hooks, no more `{ [x: string]: any }` fallback
  - **Route system** — file-path conventions, method-specific route definitions, priority matcher
  - **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
  - **Version history** — full versions/revert parity across stack with admin UI
  - **Server actions** — real form field mapping, RPC execution, effects handling
  - **Admin field meta augmentation** — all field types properly augmented with admin meta

## 1.0.0

### Major Changes

- [#16](https://github.com/questpie/questpie/pull/16) [`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - ## Ship field builder platform, server-driven admin, and standalone RPC API

  ### `questpie` (core)

  #### Field Builder System (NEW)

  Replace raw Drizzle column definitions with a type-safe field builder. Collections and globals now define fields via a callback that receives a field builder proxy `f`:

  ```ts
  // Before
  collection("posts").fields({
    title: varchar("title", { length: 255 }),
    content: text("content"),
  });

  // After
  q.collection("posts").fields(({ f }) => ({
    title: f.text({ required: true }),
    content: f.textarea({ localized: true }),
    publishedAt: f.datetime(),
  }));
  ```

  Built-in field types: `text`, `textarea`, `number`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `select`, `upload`, `json`, `object`, `array`, `relation`. Each field produces Drizzle columns, Zod validation schemas, typed operators for filtering, and serializable metadata for admin introspection — all from a single declaration.

  **Custom field types** — define your own field types with the `field<TConfig, TValue>()` factory. A custom field implements `toColumn` (Drizzle column), `toZodSchema` (validation), `getOperators` (query filtering), and `getMetadata` (introspection). Register custom fields on the builder via `q.fields({ myField })` and they become available as `f.myField()` in all collections:

  ```ts
  const slugField = field<SlugFieldConfig, string>()({
    type: "slug",
    _value: undefined as unknown as string,
    toColumn: (name, config) => varchar(name, { length: 255 }),
    toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
    getOperators: (config) => ({
      column: stringColumnOperators,
      jsonb: stringJsonbOperators,
    }),
    getMetadata: (config) => ({
      type: "slug",
      label: config.label,
      required: config.required ?? false,
      localized: false,
      readOnly: false,
      writeOnly: false,
    }),
  });

  // Register:
  const app = q({ name: "app" }).fields({ slug: slugField });
  // Use:
  collection("pages").fields(({ f }) => ({ slug: f.slug({ required: true }) }));
  ```

  **Custom operators** — the `operator<TValue>()` helper creates typed filter functions from `(column, value, ctx) => SQL`. Each field's `getOperators` returns context-aware operator sets for both column and JSONB access. Operators are automatically used by the query builder and exposed via the client SDK's `where` parameter.

  #### Reactive Field System (NEW)

  Server-evaluated reactive behaviors on fields via `meta.admin`:

  - **`hidden`** / **`readOnly`** / **`disabled`** — conditionally toggle field state based on form data
  - **`compute`** — auto-compute values from other fields
  - **Dynamic `options`** — load select/relation options on the server with dependency tracking and debounce

  Reactive handlers run server-side with full access to `ctx.db`, `ctx.user`, `ctx.req`. A proxy-based dependency tracker automatically detects which form fields each handler reads and serializes that info to the client for efficient re-evaluation.

  #### Standalone RPC API (NEW)

  New `q.rpc()` builder for defining type-safe remote procedures outside collection/global CRUD. RPC procedures are routed through the HTTP adapter at `/rpc/<path>` with nested routers, access control, and full type inference on the client SDK.

  ```ts
  const r = q.rpc<typeof app>();
  export const dashboardRouter = r.router({
    stats: r.fn({
      handler: async ({ app }) => {
        /* ... */
      },
    }),
  });
  ```

  Collections and globals also support scoped `.functions()` for entity-specific RPC, routed at `/collections/:slug/rpc/:name` and `/globals/:slug/rpc/:name`.

  #### Callable `q` Builder

  The `q` export is now a callable builder: use `q({ name: "my-app" })` to create a fresh `QuestpieBuilder`, or access `q.collection()`, `q.global()`, `q.job()` etc. as methods. Default field types are auto-registered. Standalone function exports (`collection`, `global`, `job`, `fn`, `email`, `auth`, `config`, `rpc`) are are also re-exported.

  #### Introspection API (NEW)

  Full server-side introspection of collection and global schemas for admin consumption: field metadata, access permissions, relation info, reactive config, validation schemas — all serialized from builder state. Admin UI consumes this directly instead of relying on client-side config.

  #### Queue Runtime Redesign (BREAKING)

  - Redesigned `QueueService` with proper lifecycle (`start`/`stop`/`drain`), graceful shutdown, and health checks
  - New Cloudflare Queues adapter alongside pg-boss
  - Worker handlers now receive `{ payload, app }` instead of `(payload, ctx)`
  - Workflow builder API refined with better type inference

  #### Realtime Pipeline Hardening (BREAKING)

  - `PgNotifyAdapter`: proper connection lifecycle, idempotent `start`/`stop`, owned vs shared client tracking, handler cleanup
  - `RedisStreamsAdapter`: graceful error handling in read loop, no longer auto-disconnects client on `stop()`
  - `streamedQuery` from `@tanstack/react-query` integrated as first-class citizen in collection query options

  #### Access Control (BREAKING)

  - **Removed** `access.fields` from collection/global builder — field-level access is now defined per-field via `access: { read, update }` in the field definition itself
  - CRUD generator evaluates field-level access at runtime, filtering output and validating input per field

  #### CRUD API Alignment (BREAKING)

  - Client SDK `update`/`delete`/`restore` now accept object params `{ id, data }` instead of positional args
  - Relation field names are automatically transformed to FK columns in create/update operations
  - `updateMany` and `deleteMany` added to HTTP adapter, client SDK, and tanstack-query
  - Better Auth drizzle adapter now correctly uses transactions

  #### Server-Driven Admin Config

  Admin configuration (sidebar, dashboard, branding, actions) is now defined server-side and served via introspection. The server emits serializable `ComponentReference` objects (`{ type, props }`) instead of React elements. A typed **component factory** `c` is available in all admin config callbacks:

  ```ts
  // Server-side (serializable, no React imports):
  .admin(({ c }) => ({
    icon: c.icon("ph:article"),       // => { type: "icon", props: { name: "ph:article" } }
    badge: c.badge({ text: "New" }),   // => { type: "badge", props: { text: "New" } }
  }))
  ```

  The client resolves these references via `ComponentRenderer` which looks up the matching React component from the admin builder's component registry. Built-in components (`icon` → Iconify, `badge`) are registered by default; custom ones are added via `qa().components({ myComponent: MyReactComponent })`.

  ***

  ### `@questpie/admin`

  #### Server-Driven Schema (BREAKING)

  Admin UI now consumes field schemas, sidebar config, dashboard config, and branding from server introspection instead of client-side builder config. `defineAdminConfig` is replaced by server-defined metadata.

  #### Builder API Cleanup (BREAKING)

  - **Removed** from `qa` namespace: `qa.collection()`, `qa.global()`, `qa.block()`, `qa.sidebar()`, `qa.dashboard()`, `qa.branding()` — these are now server-side concerns
  - Kept: `qa.field()`, `qa.listView()`, `qa.editView()`, `qa.widget()`, `qa.page()` for client-only UI registrations
  - Admin `CollectionBuilder` and `GlobalBuilder` completely rewritten — all schema methods (`.fields()`, `.list()`, `.form()`) removed; only UI-specific methods remain (`.meta()`, `.preview()`, `.autoSave()`, `.use()`)

  #### Reactive Fields UI (NEW)

  - `useReactiveFields` hook evaluates server-defined reactive config (hidden/readOnly/disabled/compute) client-side with automatic dependency tracking
  - `useFieldOptions` hook for dynamic options loading with search debounce and SSE streaming

  #### Block Editor Rework

  - Full drag-and-drop block editor with canvas layout, block library sidebar, tree navigation
  - Block field metadata unified between collections and blocks
  - Block prefetch values inferred from field definitions

  #### Actions System (NEW)

  Collection-level actions system with both client and server handler modes:

  - **Handler types**: `navigate` (routing), `api` (HTTP call), `form` (dialog with field inputs), `dialog` (custom component), `custom` (arbitrary code), `server` (server-side execution with full app context)
  - **Scopes**: `header` (list view toolbar — primary buttons + secondary dropdown), `bulk` (selected items toolbar), `single`/`row` (per-item)
  - **Server actions** run handler on the server with access to `app`, `db`, `session`; return typed results (`success`, `error`, `redirect`, `download`) with side-effects (`invalidate`, `toast`, `navigate`)
  - **Form actions** accept field definitions from the field registry (`f.text()`, `f.select()`, etc.) for type-safe input collection in a dialog
  - **Confirmation dialogs** configurable per action with destructive styling support
  - Built-in action presets: `create`, `save`, `delete`, `deleteMany`, `duplicate`

  #### Realtime Multiplexor

  Migrated from example code into core admin package for SSE-based live updates.

  #### Test Migration

  All admin tests migrated from vitest to bun:test; vitest dependency removed.

  ***

  ### `@questpie/tanstack-query`

  #### RPC Query Options (NEW)

  Full type-safe query/mutation option builders for RPC procedures with nested router support. The `createQuestpieQueryOptions` factory now accepts a `TRPC` generic for RPC router types, producing `.rpc.*` namespaced option builders.

  #### Realtime Streaming (NEW)

  - Re-exports `buildCollectionTopic`, `buildGlobalTopic`, `TopicConfig`, `RealtimeAPI` from core client
  - Collection `.find`, `.findOne`, `.count` option builders produce `streamedQuery`-based options for SSE real-time updates

  #### Batch Operations (NEW)

  - `updateMany` and `deleteMany` mutation option builders for collections
  - `key` builders for all collection/global operations

  ***

  ### `@questpie/openapi` (NEW PACKAGE)

  OpenAPI 3.1 spec generator for QUESTPIE instances. Generates schemas for collections (CRUD + search), globals, auth, and RPC endpoints. Includes a Scalar-powered API reference UI mountable via the adapter.

  ***

  ### `@questpie/elysia` / `@questpie/hono` / `@questpie/next`

  - All adapters accept `rpc` config to mount standalone RPC router trees alongside CRUD routes
  - Formatting standardized (tabs → spaces alignment)
  - `@questpie/hono`: `questpieHono` now correctly forwards RPC router to fetch handler

  ***

  ### `create-questpie` (NEW PACKAGE)

  Interactive CLI (`bunx create-questpie`) for scaffolding new QUESTPIE projects. Ships with a TanStack Start template including pre-configured collections, globals, admin setup, migrations, and dev tooling.
