# @questpie/openapi

## 2.1.0

### Minor Changes

- [`f2afc6c`](https://github.com/questpie/questpie/commit/f2afc6c6e83e6ffa72fd464306949a9b00c291a5) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove deprecated collection/global scoped `.functions()` RPC from builders and runtime routes. RPC is now app-level only via `rpc().router(...)` on `/rpc/:path...`.

  Update docs to match current behavior:
  - runtime install baseline is `questpie` (add `zod`/`drizzle-orm` only when imported directly)
  - explicit sidebar items are automatically excluded from the auto-generated section
  - `where.RAW` now documents and supports object args with optional i18n aliases via `({ table, i18nCurrentTable, i18nFallbackTable })`

  Live preview now runs only for existing collection records (edit mode with an id) and resolves preview URLs from persisted DB values instead of unsaved form state, preventing stuck loading when fields like slug are edited before save.

  Relation list cells now support `meta.admin.listCell` options for richer table rendering. Setting `display: "avatarChip"` shows relation chips with avatar thumbnails, with optional `avatarField` and `labelField` dot-paths.

  List view relation auto-expansion now detects nested avatar relation paths (for example `avatar.url`) and requests nested relation data so avatar chips render without manual `with` configuration.

  Add upload/system field introspection (including synthetic `preview`) so assets can render preview + upload metadata reliably from schema.

  Update default assets admin config to show preview in list and form sidebar.

  Add real user admin actions in defaults:
  - header `createUser` (name/email/password/role)
  - single-item `resetPassword` (new + confirm)
  - wired to Better Auth admin API calls with session bearer token

  Polish user form behavior:
  - email becomes read-only on existing records
  - ban reason/expiry only show when banned

  Improve server action client mapping/execution with real form field mapping, RPC execution, and effects handling.

  Fix action form fields missing labels, options, and broken validation. Server introspection now properly serializes `FieldDefinition` objects (from `f.text()`, `f.select()`, etc.) into the flat format the client expects, so action forms render with correct labels, field types, required indicators, and select options. Also fix server-side `isFieldRequired()` to check `state.config.required`.

  Add full versions/revert parity across the stack:
  - new collection/global adapter routes for versions and revert
  - questpie client methods (`findVersions`, `revertToVersion`)
  - tanstack-query option builders for versions/revert queries and mutations
  - OpenAPI generation for versions/revert on collections and globals

  Expand soft-delete and admin action UX:
  - built-in admin actions now include `restore` and `restoreMany`
  - list view supports persisted `includeDeleted` state and passes it to queries
  - bulk toolbar supports restore-many flows

  Add version history UI in admin forms with revert confirmations for collections and globals.

  Panel state is now URL-driven for better shareability and navigation:
  - side panels use `sidebar=...` (`history`, `view-options`, `block-library`)
  - live preview mode uses `preview=true`
  - legacy params remain supported for backward compatibility

  Add integration test coverage for adapter versioning routes and extend package docs for the new endpoints and URL-synced panel behavior.

  Workflow configuration is nested under `versioning` in collection/global options — `.options({ versioning: { workflow: true } })`. This makes the dependency explicit in the type system since workflow uses the versions table for stage snapshots. `CollectionVersioningOptions.enabled` defaults to `true` when the object form is used, so `versioning: { workflow: true }` enables both.

  Add workflow stage transitions:
  - `transitionStage()` CRUD method for collections and globals — validates stage, enforces transition guards, creates version snapshot without data mutation
  - `access.transition` permission rule (falls back to `access.update` when not defined)
  - `beforeTransition` / `afterTransition` hooks with `fromStage` and `toStage` context
  - HTTP routes: `POST /:collection/:id/transition` and `POST /globals/:name/transition` — now accept optional `scheduledAt` (ISO date string) for scheduling future transitions
  - Client SDK `transitionStage()` proxy + TanStack Query `transitionStage` mutation builder
  - OpenAPI `POST` transition endpoints (generated only for workflow-enabled collections/globals)
  - Admin built-in `"transition"` action with workflow metadata exposed in config
  - Scheduled transitions via queue job (`scheduledAt` parameter — future dates enqueue, past dates execute immediately)

  Add audit logging for workflow transitions:
  - `afterTransition` hooks on both collection and global audit modules
  - Transitions appear in the audit timeline with action `"transition"`, recording `fromStage` and `toStage` in changes and metadata

  Add workflow admin UI in collection and global form views:
  - Stage badge in form header showing current workflow stage (reads `versionStage` from latest version)
  - Transition dropdown button listing allowed target stages from current stage's `transitions` config
  - Confirmation dialog with optional "Schedule for later" date/time picker
  - New `useTransitionStage` client hook for executing transitions via direct fetch
  - `findVersions()` now includes `versionStage` in the response (`VersionRecord` type updated)

  **Breaking: remove `RegisteredApp` type and `Register` interface** — The `Register` module augmentation pattern created unavoidable circular type dependencies (TS7022/TS2502) whenever `questpie.gen.ts` augmented `Register.app` with the full app type. All context types (`WidgetFetchContext`, `ServerActionContext`, `BlockPrefetchContext`, `BlocksPrefetchContext`) now use `app: Questpie<any>`. For typed access, use `typedApp<App>(ctx.app)` instead.

  **Admin field meta augmentation** — The admin package now properly augments all questpie field meta interfaces (`TextFieldMeta`, `BooleanFieldMeta`, `SelectFieldMeta`, etc.) with `admin?: *FieldAdminMeta` via `declare module "questpie"`. Previously, using `meta: { admin: { ... } }` in field definitions caused TS2353 errors because no augmentation existed. Rich text and blocks field metas are augmented via `declare module "@questpie/admin/server"`.

  **Unify admin meta types with renderer implementations** — `ObjectFieldAdminMeta`, `ArrayFieldAdminMeta`, and `UploadFieldAdminMeta` now match the properties that admin renderers actually consume:
  - `ObjectFieldAdminMeta`: `wrapper`, `layout`, `columns`, `defaultCollapsed`
  - `ArrayFieldAdminMeta`: `orderable`, `mode`, `layout`, `columns`, `itemLabel`, `minItems`, `maxItems`
  - `UploadFieldAdminMeta`: adds `showPreview`, `editable`, `previewVariant`, `multiple`, `maxItems`, `orderable`, `layout`
  - `ServerChartWidget`: adds optional `field`, `dateField` is now optional
  - `ServerValueWidget`: adds optional `refreshInterval`

  **Audit module is now opt-in** — `auditModule` is no longer auto-included in `adminModule`. Users must explicitly `.use(auditModule)` to enable audit logging. Export `createAuditDashboardWidget()` for wiring audit into dashboard. The audit collection has full admin UI config (`.admin()`, `.list()`, `.form()`) with a read-only table view — use `{ type: "collection", collection: "adminAuditLog" }` in sidebar.

  **New `audit` option on admin config** — Set `audit: false` in `.admin()` to exclude a collection or global from audit logging. All internal admin collections already have this set.

  **Remove `bindCollectionToBuilder`** — Starter module collections (user, assets) now use `.admin()`, `.list()`, `.form()` directly. The `~questpieApp` rebinding was unnecessary since admin methods are monkey-patched on the prototype.

  **Fix `.admin()` / `.list()` / `.form()` crashing on standalone collections** — Component and view proxies now skip validation when no registry is available (standalone builders without `.components()` / `.listViews()` / `.editViews()`). Audit-log collection uses a new `adminCoreBuilder` with admin registries pre-configured, so it resolves `c.icon(...)`, `v.table(...)`, and `v.form(...)` correctly.

  **Breaking: rename `fetchFn` → `loader` on all dashboard widget types.** Server-side interfaces (`ServerStatsWidget`, `ServerTimelineWidget`, etc.) and client-side configs (`ValueWidgetConfig`, `ProgressWidgetConfig`, etc.). The serialized flag is renamed from `hasFetchFn` to `hasLoader`.

  **Secure-by-default access control** — The framework now requires an authenticated session when no access rules are defined. Previously, collections/globals without `.access()` and no `defaultAccess` were open to everyone (including unauthenticated requests).

  New `.defaultAccess()` chainable builder method sets app-wide default access rules. Resolution order: collection's own `.access()` → builder `defaultAccess` → framework fallback (`!!session`).

  The `starterModule` now includes `defaultAccess` requiring authentication for all CRUD operations. To make a collection public, explicitly set `.access({ read: true })` on the collection or override via `.defaultAccess({ read: true, ... })` after `.use(starterModule)`.

  `defaultAccess` moved from runtime config (`.build()`) to builder state (`.defaultAccess()`) — composable via `.use()` with last-wins semantics.

  Fixed introspection, admin-config sidebar filtering, and search routes to properly fall back to `defaultAccess` when collections don't define their own `.access()` rules.

### Patch Changes

- Updated dependencies [[`f2afc6c`](https://github.com/questpie/questpie/commit/f2afc6c6e83e6ffa72fd464306949a9b00c291a5)]:
  - questpie@2.1.0

## 2.0.0

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
  q.collection("posts").fields((f) => ({
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
  collection("pages").fields((f) => ({ slug: f.slug({ required: true }) }));
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

### Patch Changes

- Updated dependencies [[`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4)]:
  - questpie@2.0.0
