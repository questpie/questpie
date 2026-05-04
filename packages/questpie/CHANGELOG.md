# questpie

## 3.2.2

### Patch Changes

- [`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix live preview focus scrolling for block and relation fields, and preserve array metadata during field introspection.

## 3.2.1

### Patch Changes

- [#57](https://github.com/questpie/questpie/pull/57) [`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Enhance the existing Preview flow with visual editing support, draft patch synchronization, inline scalar editing, block preview annotations, and block insertion affordances wired to the existing block editor.

  Update the barbershop example, documentation, scaffolder templates, and bundled QUESTPIE skills to describe and preserve the single Preview system architecture.

  Cache admin auth branding snapshots to avoid React update loops on login pages, translate select option labels consistently across admin tables and related UI, reduce hook recursion noise for legitimate nested read flows, resolve generated app output next to re-exported server configs for CLI commands, and add configurable request logging with request/trace id propagation and scoped application log correlation.

  The observability work provides a foundation without introducing OpenTelemetry tracing or exporter dependencies yet.

  Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to QUESTPIE Cloud.

- [#57](https://github.com/questpie/questpie/pull/57) [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to Questpie Cloud.

## 3.2.0

### Minor Changes

- [#28](https://github.com/questpie/questpie/pull/28) [`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `@questpie/workflows` — durable workflow engine for QUESTPIE.

  **Core Engine**

  - `workflow()` identity factory for type-safe workflow definitions
  - Replay-based execution engine with step caching and non-determinism detection
  - Step primitives: `step.run()`, `step.sleep()`, `step.sleepUntil()`, `step.waitForEvent()`, `step.invoke()`, `step.sendEvent()`
  - Duration parser (s/m/h/d/w), 5 error types, structured workflow logger

  **System Collections**

  - `wf_instance` — workflow instance tracking with status, input/output, timeout
  - `wf_step` — step execution records with replay memoization and match_hash index
  - `wf_event` — event persistence for JSONB-containment matching
  - `wf_log` — structured log entries queryable in admin UI

  **Events & Compensation**

  - Event matching engine with JSONB containment semantics (forward + retroactive)
  - Saga-pattern compensation with reverse LIFO order
  - Child workflow invocation with cascading timeouts
  - `onFailure` handler with `completedSteps` inspection

  **Cron Triggers & Retention**

  - `cron` field on workflow definitions for recurring execution
  - `cronOverlap` policy: `skip` (default), `allow`, `cancel-previous`
  - `RetentionPolicy` for automatic cleanup of old instances/steps/events/logs
  - `match_hash` optimization for O(1) event matching via FNV-1a indexed column

  **Workflow Client**

  - `trigger()`, `cancel()`, `getInstance()`, `getHistory()`, `sendEvent()`
  - `cancelAll()`, `retryAll()` batch operations
  - Idempotency key support, delayed start, parent-child relationships
  - Typed collection/global `transitionStage()` client calls now accept `scheduledAt`

  **Admin UI**

  - Workflow list page with status filters, auto-refresh, trigger dialog
  - Workflow detail page with step timeline, action buttons, log viewer
  - Dashboard stats widget showing active/completed/failed counts
  - Sidebar contribution for navigation

  **Docs & Type Safety**

  - Full durable workflow documentation with typed route, event, cron, admin, and client examples
  - Documented durable workflow instance and step lifecycle transitions with Mermaid diagrams
  - Expanded versioning workflow transition references across CRUD, global, hooks, and HTTP route docs
  - Mermaid architecture diagrams for workflow and docs architecture pages
  - Runtime workflow helpers and admin client routes are strongly typed without unsafe casts

  **Integration**

  - `workflowsPlugin()` codegen plugin for file-convention discovery
  - `workflowsModule` server module with collections, jobs, service, functions
  - `workflowsClientModule` for admin UI pages and widgets
  - Service at `ctx.workflows` via `namespace(null)`
  - `@questpie/admin/client` now exports `page()` and `PageDefinition` for module-provided admin pages

## 3.1.0

### Minor Changes

- [`6186dfb`](https://github.com/questpie/questpie/commit/6186dfbb7fd4423f4ee0c5b1af78f3690f433dfb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix save hanging on collections with blocks that use `.prefetch()`, fix custom actions disappearing after `CollectionBuilder.merge()`, and make form-state-dependent admin config (relation `filter`, etc.) actually work end-to-end.

  **merge() losing extension keys** — `CollectionBuilder.merge()` constructed its merged state from an explicit key list, silently dropping any keys added via `.set()` (e.g. `admin`, `adminList`, `adminForm`, `adminActions`, `adminPreview`). Custom actions defined on the source builder vanished after merge. Fixed by spreading both states before the explicit overrides.

  **Save deadlock with blocks prefetch** — `_executeUpdate` re-fetched updated records inside the open transaction, which triggered field output hooks (blocks `afterRead` → `prefetch()` functions). Those prefetch functions issued inner CRUD calls that inherited the tx connection via AsyncLocalStorage context propagation (`normalizeContext` resolves `db: context.db ?? stored?.db`). Under parallel load, all queries serialized through the single tx connection and Bun SQL deadlocked with the connection stuck `idle in transaction`. Fixed with a `skipOutputHooks` flag on `_executeFind` used for the in-tx refetch — output hooks already re-run after the tx commits.

  ***

  **Reactive admin props** — function-valued admin config (e.g. `f.relation("users").admin({ filter: ({ data }) => ({ team: data.team }) })` or layout `props.filter`) was silently dropped by introspection's `JSON.stringify` / `superjson.stringify`, the field component received `undefined`, and consumers like `relation-select`'s `if (filter) options.where = filter({})` short-circuited — making it look like the filter "worked" while returning every record.

  Function values now follow the same pattern as `hidden` / `readOnly` / `compute`: the function stays on the server, introspection emits a small placeholder, and the client resolves the value on demand against current form state.

  **Wire-level contract:**

  ```ts
  export type ReactivePropPlaceholder = {
    "~reactive": "prop";
    watch: string[]; // form paths the handler reads
    debounce?: number;
  };
  ```

  **Server.** `serializeFormLayoutProps` walks `state.adminForm.fields` (sidebar/tabs/sections too) and `serializeFieldMetaProps` walks every field's `metadata.meta`, replacing function or `{ handler, deps?, debounce? }` values with a `ReactivePropPlaceholder`. Static JSON passes through unchanged. Hooked into `introspectCollection` and `introspectGlobal`.

  **Server: `/admin/reactive` `prop` type.** `batchReactiveInputSchema.requests[].type` now accepts `"prop"` with a required `propPath`. The dispatcher resolves the original handler from layout `state.adminForm.fields[*].props[propPath]` first; if not found there, falls back to field-level `state.fieldDefinitions[fieldPath]._state.extensions.admin[propPath]`. So layout-level overrides field-level when both exist.

  **Client: `useReactiveProps` hook.** `FieldRenderer` calls a new `useReactiveProps({ entity, entityType, field, props })` hook over the merged `componentProps` — both field-level admin meta and layout-level `extraProps` go through it. The hook:

  - Returns static entries synchronously — no network.
  - Batches all placeholder entries into one `batchReactive` call.
  - Watches the union of `watch` deps via `react-hook-form` `useWatch`; refetches only when a tracked dep changes.
  - Debounces using `max(placeholder.debounce)` (default 100ms).
  - Caches under TanStack Query key `["questpie", "reactive-props", entityType, entity, field, propKeys, depHash]` with `placeholderData: prev` so consumers don't flicker on dep changes.

  **Type augmentation.** `RelationFieldAdminMeta.filter?: ReactivePropValue<Record<string, unknown>>` plus the same option key on every admin meta where it makes sense (object/array/etc.). `FormFieldLayoutItem.props?: Record<string, FormReactivePropValue<TData>>`. Removed dead `FieldLayoutItemWithReactive` from client builder — replaced with `FieldLayoutItemRef` mirroring the server post-serialization wire shape.

  **Recommended usage.** Field-level `.admin({ filter })` is the primary location — define once on the field, get the filter wherever the field renders. Layout-level `props.filter` is the per-instance override:

  ```ts
  // Field-level — primary
  counselorId: f.relation("users")
    .admin({
      filter: ({ data }) => ({ role: "admin", team: data.team }),
    })

    // Layout-level — per-instance override (wins over field-level)
    .form(({ v, f }) =>
      v.collectionForm({
        fields: [
          f.counselorId, // gets field-level filter
          {
            field: f.counselorId,
            props: {
              // overrides for THIS form
              filter: { role: "super-admin" },
            },
          },
        ],
      })
    );
  ```

## 3.0.9

## 3.0.8

## 3.0.7

### Patch Changes

- [#47](https://github.com/questpie/questpie/pull/47) [`5d7639b`](https://github.com/questpie/questpie/commit/5d7639b28d4625c5d587ad256cbac98ba14ff886) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix three independent bugs in the CRUD + queue layer.

  **Race in `globals.<name>.get` auto-create.** Two concurrent `get(...)` calls against a fresh global both saw zero rows under READ COMMITTED and each inserted a "default-valued" auto-created row, leaving the database with two singletons. Auto-create now takes a transaction-scoped `pg_advisory_xact_lock(hashtext('questpie:global:<name>'))` and re-checks existence inside the locked transaction before inserting. Applied to both the workflow-versions branch and the plain branch. Schema-free — no migration. Backends without `pg_advisory_xact_lock` log a warning and fall back to the existence re-check.

  **Pre-stringified jsonb values stored as jsonb strings.** When upstream code (legacy seeds, RPC layers, custom hooks) handed an already-`JSON.stringify`'d array or object to `globals.<name>.update(...)` or `collections.<name>.create/update(...)`, Drizzle's jsonb `mapToDriverValue` stringified it a second time and Postgres stored a jsonb string instead of the intended array/object. The framework now normalizes input for jsonb-backed fields (`f.json()`, `f.object()`, `f.<x>().array()`, `f.blocks()`) before validation, hooks, and write — pre-stringified arrays/objects are decoded back to their plain JS values. Field input hooks always observe decoded values.

  **`pgBossAdapter` ignored pg-boss v10+ array callback shape.** pg-boss v10+ calls `work()` callbacks with `Job<T>[]` regardless of `batchSize`. The adapter destructured `job.id` / `job.data` straight off the array → both `undefined` → registered handlers received `payload: undefined` and every job failed Zod validation upstream. `listen()` now iterates the array, dispatches each job to the handler, and reports per-item failures via `boss.fail(jobName, id, …)` so siblings in the same batch still complete and the failed job retries independently. `runOnce()` already handled the array shape correctly via `fetch()` and is unchanged.

  All three fixes are backwards-compatible. No public API changes, no schema migrations.

## 3.0.6

### Patch Changes

- [#45](https://github.com/questpie/questpie/pull/45) [`ea2ff8d`](https://github.com/questpie/questpie/commit/ea2ff8dea8ad7b20946ed91906374e25a2bb9ba5) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Access functions receive `request`, no-op field writes are allowed, global forms auto-expand M:N, and form layout gains a `props` escape hatch.

  **`questpie` — access control:**

  - `AccessContext` now carries `request?: Request`. The HTTP adapter pipes the incoming `Request` through `app.createContext` into both collection and global CRUD evaluation, so collection/global `.access()` rules can branch on URL or headers (e.g. distinguish admin panel calls at `/admin/api/...` from public frontend calls at `/api/...`). Bound automatically — opt-in by destructuring `request` in your access function:

    ```ts
    read: ({ session, request }) => {
      const fromAdmin = request?.url.includes("/admin/api/");
      if (fromAdmin && isAdmin(session?.user)) return true;
      return { createdById: session?.user?.id };
    };
    ```

  - `validateFieldsWriteAccess` now skips fields whose value is unchanged on update. Forms (especially the admin's auto-generated form) re-submit `readOnly` fields with their original value; previously every save failed with `Cannot write field 'X': access denied` even though nothing changed. The check runs only when `existingRow` is available and uses `Object.is` for identity comparison.

  **`@questpie/admin`:**

  - `GlobalFormView` now auto-detects M:N relations via `detectManyToManyRelations` (parity with `CollectionFormView`) and requests them via `useGlobal(name, { with: ... })`. Upload-through and `relation().multiple()` fields on globals are now visible in the form instead of silently empty. Loaded relation arrays of objects are normalized to arrays of ids before the form resets, matching collection-form behavior.

  - New `createAdminClient<TApp>()` factory exported from `@questpie/admin/client` — wraps `createClient` and auto-injects an `X-Questpie-Admin: 1` request header on every outbound call. Use this for the client passed to `<AdminLayoutProvider client={...}>`; keep the public/frontend client as plain `createClient` (it must not inject the admin header).

    ```ts
    import { createAdminClient } from "@questpie/admin/client";
    import type { AppConfig } from "#questpie";

    export const adminCmsClient = createAdminClient<AppConfig>({
      baseURL:
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.APP_URL!,
      basePath: "/api",
    });
    ```

  - New shared exports `isAdminRequest(request)`, `ADMIN_REQUEST_HEADER`, `ADMIN_API_PREFIX`, and `withAdminRequestHeader(fetch?)` from `@questpie/admin/shared`. `isAdminRequest` is the canonical access-rule guard — it checks the `X-Questpie-Admin` header first (set by `createAdminClient`), then falls back to the legacy `/admin/api/` URL prefix for back-compat:

    ```ts
    import { isAdminRequest } from "@questpie/admin/shared";

    read: ({ session, request }) => {
      if (isAdminRequest(request) && isAdmin(session?.user)) return true;
      return { createdById: session?.user?.id };
    };
    ```

  - `FormFieldLayoutItem` (server augmentation) and `FieldLayoutItemWithReactive` (client builder) gain `props?: Record<string, any>` — an escape hatch for component-specific configuration that doesn't have a dedicated layout key. Forwarded as extra props to the field component via the new `extraProps` slot on `FieldRenderer`. Use it for things like the relation field's `filter`:

    ```ts
    { field: f.counselorId, props: { filter: () => ({ role: "admin" }) } }
    ```

  No breaking changes: existing access functions ignore the new `request` field; layout items without `props` behave exactly as before.

  **Config-driven branding (name, logo, tagline, favicon) and admin.css-driven theming.**

  - `ServerBrandingConfig` now declares typed `logo` (`string | { src, srcDark, alt, width, height } | ComponentReference`), `tagline`, and `favicon` alongside the existing `name`. The DTO and Zod schema match — the previous `z.record(z.string(), z.any())` hole is closed and `branding.logo: any` becomes a real type.
  - `BrandingSync` hydrates all four fields into the admin store and applies the configured favicon to a managed `<link rel="icon">`. New `useBrand()` / `useBrandSnapshotRef()` hooks read the snapshot (safe outside `<AdminProvider>`).
  - New `<BrandLogoMark>` renders any of the three logo shapes with `.dark`-aware source switching. Sidebar and auth-page built-in fallbacks now render the configured logo, falling back to the legacy mark only when nothing is configured.
  - Auth pages: removed the hardcoded `brandName="QUESTPIE"` and the two `Built with QUESTPIE` strings; the auth tagline now renders the configured `tagline` (or nothing). Deduped the `logo={logo ?? <AuthDefaultLogo .../>}` fallback across 8 auth pages — `AuthLayout` resolves the default from the store.
  - New `--font-heading` CSS token (defaults to `var(--font-sans)`) applied to `h1`–`h6`, so apps can restyle headings without touching body type.
  - README: new "Whitelabeling" section with the two-layer model (config for content, `admin.css` for theme), OKLCH-first guidance, and the SSR-clean favicon recipe for TanStack Start.

  Backward-compat: file-convention overrides (`adminSidebarBrand`, `adminAuthLayout`) keep precedence over the new config-aware defaults; `AuthDefaultLogo`, `QuestpieSymbol`, and `selectBrandName` stay exported. Zero-config admin renders identically to before.

## 3.0.5

### Patch Changes

- [`325599e`](https://github.com/questpie/questpie/commit/325599e70089bcdeb632d0e389614e6738a514cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Expand bundled localization coverage across core and admin.

  - Add bundled validation translations for `cs`, `de`, `es`, `fr`, `pl`, and `pt`.
  - Extract backend/runtime errors, upload/storage, search, realtime, versioning, and database field errors into translatable messages.
  - Complete admin UI, server action, setup, preview, table, widget, and layout message catalogs for all bundled locales.

## 3.0.4

### Patch Changes

- [#41](https://github.com/questpie/questpie/pull/41) [`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Prepare the next patch release across admin, core, scaffolding, and the Iconify Vite plugin.

  - Improve admin browser titles, metadata, dashboard widget sizing, form sidebar responsiveness, upload previews, localized validation messages, and file-first chrome/theme customization paths.
  - Add an admin-managed user avatar upload field backed by the assets collection while keeping Better Auth's `image` URL field compatible.
  - Expose a media upload sheet from upload-enabled collection list views.
  - Route admin server Drizzle imports through the `questpie` Drizzle re-exports so admin tests and published package consumers do not require a duplicate direct Drizzle resolution.
  - Improve migration and seed validation robustness, route/context propagation, and stricter CLI path/category/integer option parsing.
  - Harden project scaffolding with `.env` creation, non-interactive database/codegen/skills options, generated-project QUESTPIE agent skills, and fresh-app verification scripts.
  - Fix `@questpie/vite-plugin-iconify` package exports so the published package resolves to the built `dist/index.mjs` entrypoint with bundled declarations.

## 3.0.3

### Patch Changes

- [`e40fc20`](https://github.com/questpie/questpie/commit/e40fc200dbd604e2ad8147b4dd1711d11b968b91) Thanks [@drepkovsky](https://github.com/drepkovsky)! - `.drizzle()` escape hatch now propagates the column's `$type<T>()` to the field's inferred `data` type. If the returned column has a narrower typed data, the field picks it up; columns still typed as `unknown` leave the existing field `data` in place.

- [`acfc1c0`](https://github.com/questpie/questpie/commit/acfc1c0b94a2cde684d17ae50b2c4c2278d8705c) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `schema?: string` option to collections and globals for placing tables under a named Postgres schema instead of `public`. Applies to all four table variants (main, i18n, versions, i18n_versions). `migrate:generate` emits `CREATE SCHEMA IF NOT EXISTS "<name>";` for new schemas and cross-schema relations render as `REFERENCES "other_schema"."table"("id")`. Unset (default) stays on `public` — fully backward-compatible.

## 3.0.2

### Patch Changes

- [`25b85ec`](https://github.com/questpie/questpie/commit/25b85ec54cfa7fdf38ee15548377d01191f0667a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Improve generated app context inference from `config/app.ts` and add typed route params helpers for custom routes.

## 3.0.1

### Patch Changes

- [`fca6096`](https://github.com/questpie/questpie/commit/fca60967ee1c2b6b8fb439230e663daea60b0465) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Align v3 docs, generated app types, and the create-questpie starter template with the current file-convention and app API behavior.

- [`3e8e7e1`](https://github.com/questpie/questpie/commit/3e8e7e1f1b5b7fe05c58fd582d0ee6ced05c6411) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix codegen discovery and generated app typing so typed collection exports, auth-backed session inference, and module tuples work without app-side hacks or manual generated-file edits.

## 3.0.0

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
  - **Route system** — file-path conventions, method chaining (`.get().post()`), priority matcher
  - **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
  - **Version history** — full versions/revert parity across stack with admin UI
  - **Server actions** — real form field mapping, RPC execution, effects handling
  - **Admin field meta augmentation** — all field types properly augmented with admin meta

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

## 1.1.1

### Patch Changes

- [`7172275`](https://github.com/questpie/questpie/commit/71722757a95e1f30521ac1eeca1080a8691bb9fc) Thanks [@drepkovsky](https://github.com/drepkovsky)! - fix: public uploads set visibility flag

## 1.1.0

### Minor Changes

- [`a7efd1e`](https://github.com/questpie/questpie/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add defaultAccess for global access control defaults

  New `defaultAccess` option in CMS config sets default access rules for all collections and globals:

  ```typescript
  const cms = q({ name: "app" }).build({
    defaultAccess: {
      read: ({ session }) => !!session,
      create: ({ session }) => !!session,
      update: ({ session }) => !!session,
      delete: ({ session }) => !!session,
    },
  });
  ```

  - Collections/globals without explicit `.access()` inherit from `defaultAccess`
  - Explicit access rules override defaults
  - System access mode bypasses all checks

  ***

  feat: add getContext<TApp>() helper with AsyncLocalStorage support

  New typed context helper for accessing `app`, `session`, `db`, `locale`, and `accessMode`:

  **Explicit pattern** (recommended for hooks/access control):

  ```typescript
  .access({
    read: (ctx) => {
      const { session, app, db } = getContext<App>(ctx);
      return session?.user.role === "admin";
    }
  })
  ```

  **Implicit pattern** (via AsyncLocalStorage):

  ```typescript
  async function logActivity() {
    const { db, session } = getContext<App>(); // From storage
  }

  await runWithContext({ app: cms, session, db }, async () => {
    await logActivity(); // Works without passing context
  });
  ```

  CRUD operations automatically run within `runWithContext` scope, enabling implicit access in hooks.

  ***

  fix: properly handle access control returning false

  Fixed critical bug where access rules returning `false` were not properly enforced:

  - Added explicit `accessWhere === false` checks before query execution
  - Now throws `ApiError.forbidden()` with clear error messages
  - Applied to all CRUD operations (find, count, create, update, delete)
  - Realtime subscriptions now emit error events for access denied

  Previously, `false` was treated as "no restriction", potentially exposing data.

  ***

  feat: add many-to-many mutation support for globals

  Globals now support full many-to-many relation operations:

  - `connect` - Link existing records
  - `create` - Create and link new records
  - `connectOrCreate` - Connect if exists, create if not
  - `set` - Replace entire relation set
  - Plain array support `[id1, id2]` for admin forms

  Example usage:

  ```typescript
  // Connect existing services
  await cms.api.globals.homepage.update(
    {
      featuredServices: { connect: [{ id: service1.id }, { id: service2.id }] },
    },
    ctx
  );

  // Create new services and link them
  await cms.api.globals.homepage.update(
    {
      featuredServices: {
        create: [
          { name: "Consulting", description: "Expert advice", price: 100 },
        ],
      },
    },
    ctx
  );
  ```

  Also includes new test coverage for:

  - Junction table extra fields preservation
  - Empty relation handling
  - Cascade delete cleanup

  ***

  feat: add transaction utilities with `onAfterCommit` hook

  New AsyncLocalStorage-based transaction wrapper that solves deadlock issues and enables safe side-effect handling:

  ```typescript
  import { withTransaction, onAfterCommit } from "questpie";

  // In hooks - queue side effects for after commit
  .hooks({
    afterChange: async ({ data, context }) => {
      onAfterCommit(async () => {
        await context.app.queue.sendEmail.publish({ to: data.email });
        await context.app.mailer.send({ ... });
      });
    },
  })

  // In custom functions
  await withTransaction(db, async (tx) => {
    const order = await createOrder(tx);

    onAfterCommit(async () => {
      await sendConfirmationEmail(order);
    });

    return order;
  });
  ```

  Key features:

  - Callbacks only run after outermost transaction commits
  - Nested transactions automatically reuse parent tx
  - Safe for PGLite (single-connection) and production PostgreSQL
  - Ideal for job dispatching, emails, webhooks, search indexing

  ***

  fix: resolve PGLite test deadlocks in nested CRUD operations

  Fixed deadlock issues when CRUD operations with search indexing were called inside transactions (e.g., many-to-many nested mutations). Search indexing now uses `onAfterCommit` to run after transaction completion.

  ***

  refactor: remove jobs control plane (job_runs tracking)

  Removed the experimental `jobsModule` and `job_runs` collection tracking:

  - Simplified queue service and worker code (~400 lines removed)
  - Jobs now rely purely on queue adapter (PgBoss or other) for monitoring
  - Removed `jobsModule` export from package

  The jobs system remains fully functional:

  ```typescript
  const sendEmail = q.job("send-email", {
    schema: z.object({ to: z.string() }),
    handler: async ({ payload }) => { ... }
  });

  await app.queue.sendEmail.publish({ to: "user@example.com" });
  await app.listenToJobs();
  ```

  Control plane with admin UI visibility may be re-added in the future with a cleaner design.

  ***

  feat: add 6 new language translations

  Added i18n support for additional languages:

  **New locales:**

  - `cs` - Czech (Čeština)
  - `de` - German (Deutsch)
  - `es` - Spanish (Español)
  - `fr` - French (Français)
  - `pl` - Polish (Polski)
  - `pt` - Portuguese (Português)

  **Usage:**

  ```typescript
  const cms = q({ name: "app" }).build({
    locale: {
      default: "en",
      available: ["en", "sk", "cs", "de", "es", "fr", "pl", "pt"],
    },
  });
  ```

  All error messages, validation messages, and UI strings are now available in these languages.

## 1.0.5

### Patch Changes

- [`a043841`](https://github.com/questpie/questpie/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - refactor: use cms.api.collections for CRUD operations

## 1.0.4

### Patch Changes

- [`01562df`](https://github.com/questpie/questpie/commit/01562dfb6771a47eddcb797f36f951ae434f29c8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add Prettify to admin builder types and improve DX
  - Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
  - Add default `ConsoleAdapter` for email in development mode (no config needed)
  - Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps

## 1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions
  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

## 0.0.2

### Patch Changes

- chore: include files in package.json

## 0.0.1

### Patch Changes

- feat: initial release
