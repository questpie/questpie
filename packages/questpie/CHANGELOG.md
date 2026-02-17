# questpie

## 2.0.0

### Major Changes

- [#16](https://github.com/questpie/questpie-cms/pull/16) [`dd3ea44`](https://github.com/questpie/questpie-cms/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - ## Ship field builder platform, server-driven admin, and standalone RPC API

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

- [`7172275`](https://github.com/questpie/questpie-cms/commit/71722757a95e1f30521ac1eeca1080a8691bb9fc) Thanks [@drepkovsky](https://github.com/drepkovsky)! - fix: public uploads set visibility flag

## 1.1.0

### Minor Changes

- [`a7efd1e`](https://github.com/questpie/questpie-cms/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add defaultAccess for global access control defaults

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
      const { session, app, db } = getContext<AppCMS>(ctx);
      return session?.user.role === "admin";
    }
  })
  ```

  **Implicit pattern** (via AsyncLocalStorage):

  ```typescript
  async function logActivity() {
    const { db, session } = getContext<AppCMS>(); // From storage
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
    ctx,
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
    ctx,
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

- [`a043841`](https://github.com/questpie/questpie-cms/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - refactor: use cms.api.collections for CRUD operations

## 1.0.4

### Patch Changes

- [`01562df`](https://github.com/questpie/questpie-cms/commit/01562dfb6771a47eddcb797f36f951ae434f29c8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add Prettify to admin builder types and improve DX
  - Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
  - Add default `ConsoleAdapter` for email in development mode (no config needed)
  - Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps

## 1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie-cms/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions
  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie-cms/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie-cms/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

## 0.0.2

### Patch Changes

- chore: include files in package.json

## 0.0.1

### Patch Changes

- feat: initial release
