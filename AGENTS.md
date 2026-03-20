# AGENTS.md

Source-of-truth guidance for AI agents working in this monorepo.

## Project Snapshot

- **Monorepo**: Turborepo with **Bun** as the only package manager (`packageManager: bun@1.3.0`).
- **Language**: TypeScript + ESM across all packages.
- **Product**: QUESTPIE — application framework (core engine + adapters + config-driven admin UI).

## Workspace Layout

| Path                                                | Purpose                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/questpie`                                 | Core engine — field builders, CRUD, routes, introspection, CLI. Exports: `questpie`, `questpie/client`, `questpie/shared`. |
| `packages/admin`                                    | Config-driven admin UI (React + Tailwind v4 + shadcn). Exports: `@questpie/admin/server`, `@questpie/admin/client`.        |
| `packages/tanstack-query`                           | TanStack Query option builders, `streamedQuery`, batch helpers.                                                            |
| `packages/openapi`                                  | OpenAPI spec generation + Scalar UI module (`openApiModule()`).                                                            |
| `packages/elysia`, `packages/hono`, `packages/next` | Framework adapters — thin wrappers around `createFetchHandler`.                                                            |
| `packages/create-questpie`                          | CLI scaffolder (`bunx create-questpie`). Templates live in `templates/`.                                                   |
| `apps/docs`                                         | Documentation site (TanStack Start + Vite + Fumadocs). Content in `content/docs/`.                                         |
| `examples/*`                                        | Full reference implementations (tanstack-barbershop, city-portal).                                                         |

## Key Architecture

### Package Internals (questpie)

`packages/questpie/src/` is split into:

- `server/` — Collections, globals, fields, routes, adapters, integrated services (auth, storage, queue, mailer, realtime), migration.
- `client/` — Client-side client, typed hooks.
- `shared/` — Shared types and utilities used by both sides.
- `exports/` — Public entry points (`index.ts`, `client.ts`, `shared.ts`, `cli.ts`).
- `cli/` — CLI commands (`questpie migrate`, `questpie migrate:create`).

Internal imports use the `#questpie/*` subpath alias (e.g. `#questpie/server/fields/field`).

### Server-First Split

All QUESTPIE projects follow this split:

| Layer      | Directory          | Defines                                                                  |
| ---------- | ------------------ | ------------------------------------------------------------------------ |
| **Server** | `questpie/server/` | Schema, fields, access control, hooks, routes, jobs — WHAT the data does |
| **Admin**  | `questpie/admin/`  | Branding, custom renderers, client builder — HOW it renders              |
| **Routes** | `routes/`          | HTTP mounting only — no business logic                                   |

### Standalone Factories + File Convention

New projects use **standalone factories** and **file convention** with codegen:

```ts
// collections/posts.collection.ts
import { collection } from "#questpie/factories";

export const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).label("Title").required(),
	content: f.richText().label("Content"),
}));

// routes/healthcheck.ts
import { route } from "#questpie/factories";

export default route()
	.get()
	.handler(async () => ({ status: "ok" }));

// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});

// modules.ts
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	openApiModule({ info: { title: "My API", version: "1.0.0" } }),
] as const;
```

Codegen discovers files and generates `.generated/index.ts` with the `app` instance and `App` type. User code imports via the `#questpie` subpath:

```ts
import { app } from "#questpie";
import { createFetchHandler } from "questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
```

The `#questpie` alias is configured in both `package.json` (`imports` field) and `tsconfig.json` (`paths`) — it resolves to `./src/questpie/server/.generated/index.ts`.

### Field Builder System

Fields are defined via a proxy-based `f` factory inside `.fields()`. Fields use a **fluent builder** pattern (NOT options objects):

```ts
const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).label("Title").required(),
	content: f.richText().label("Content"),
	published: f.boolean().label("Published").default(false),
	category: f.select().label("Category").options(["news", "blog"]),
	author: f.relation().label("Author").to("users"),
	image: f.upload().label("Cover Image"),
}));
```

Key builder methods: `.label()`, `.required()`, `.default()`, `.localized()`, `.inputOptional()`, `.admin()`, `.access()`, `.hooks()`, `.meta()`, `.operators()`.

**Built-in field types (core):** `text`, `number`, `boolean`, `date`, `datetime`, `time`, `select`, `relation`, `upload`, `object`, `json`, `from`, `email`, `url`, `textarea`.
**Admin module fields:** `richText`, `blocks` (provided by `@questpie/admin`).

**Custom fields** via `field<TConfig, TValue>()` factory — see `packages/questpie/src/server/fields/field.ts`.
**Custom operators** via `operator<TValue>()` — see `packages/questpie/src/server/fields/common-operators.ts`.

### Standalone Routes

Type-safe server routes via file convention:

```ts
// routes/get-stats.ts
import { route } from "#questpie/factories";
import { z } from "zod";

export default route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week", "month"]) }))
	.handler(async ({ input, collections }) => {
		// handler receives AppContext & { input } — destructure what you need
		const count = await collections.posts.count({});
		return { posts: count, period: input.period };
	});
```

Routes are auto-discovered by codegen and available at `/api/<name>`.

### Introspection & Component References

Server emits serializable references that the client resolves via registries:

- **Component references**: `c.icon("ph:article")`, `c.badge({ ... })` — `ComponentReference<TType, TProps>`.
- **View references**: `v.collectionTable({})`, `v.collectionForm({ sidebar, fields })`, `v.globalForm({ fields })` — resolved from `state.views`.
- **Field metadata**: Introspection API at `packages/questpie/src/server/collection/introspection.ts` emits `CollectionSchema` / `FieldSchema`.

## Registry-First Philosophy (Critical)

- **Never** hardcode admin/view/component/type names in server runtime — always derive from builder state and registered maps.
- **Fields**: resolve from builder state fields registry.
- **Views**: resolve from `state.views`.
- **Components**: resolve `c.*` from `state.components`.
- **Entities**: collections/globals/jobs/queues flow from builder state, not literal names.
- Defaults are provided by module registration (`runtimeConfig({ plugins: [adminPlugin()] })` + `modules.ts` on server / `qa.use(adminModule)` on client), not hardcoded.
- Client resolves server-emitted `{ type, props }` references using its own registry — never assume server-only types.
- When extending builders, prefer lazy type extraction (`FieldsOf<this>`, `QuestpieStateOf<this>`) over giant mapped types.

## Plugin System (Codegen)

The codegen pipeline is fully plugin-driven. Nothing is hardcoded in the CLI — all categories, discovery patterns, builder extensions, callback proxies, and type registries come from plugins.

### Core Plugin (`coreCodegenPlugin()`)

Lives in `packages/questpie/src/cli/codegen/index.ts`. Always auto-prepended by `runCodegen()`. Declares:

- **10 category declarations**: collections, globals, jobs, routes, messages, services, emails, migrations, seeds, and admin/plugin declarations — each with full `CategoryDeclaration` metadata (dirs, prefix, emit strategy, type emission, registry key).
- **2 config/ discover patterns**: `config/auth.ts` (authConfig), `config/app.ts` (appConfig with `destructure` mapping locale, access, hooks, context to createApp keys).
- **2 singleton factories**: appConfig (`AppConfigInput`), authConfig (`AuthConfig`).
- **1 callback param**: `f` (field ref proxy: `f.title` → `"title"`).

### Config Directory Convention

All project configuration lives in `config/` inside the server directory:

| File | Factory | Contains |
|------|---------|----------|
| `config/auth.ts` | `authConfig()` from `"questpie"` | Better Auth options (email/password, social providers, plugins) |
| `config/app.ts` | `appConfig()` from `"questpie"` | `locale`, `access` (defaultAccess), `hooks`, `context` (contextResolver) |
| `config/admin.ts` | `adminConfig()` from `"@questpie/admin/server"` | `sidebar`, `dashboard`, `branding`, `locale` (adminLocale) |
| `config/openapi.ts` | `openApiConfig()` from `"@questpie/openapi"` | OpenAPI spec info, Scalar UI options |

The `appConfig` pattern uses `destructure` on `DiscoverPattern` — a single file maps its properties to multiple createApp keys. Context resolver return type is auto-propagated to `Questpie.QuestpieContextExtension`.

### Module Plugin Auto-Extraction

Modules can declare `plugin` on `ModuleDefinition`. Codegen pre-pass imports `modules.ts`, traverses depth-first, and extracts all plugins. This means `openApiModule` and other module packages contribute their codegen plugins automatically — no manual `plugins: [openApiPlugin()]` in `questpie.config.ts` needed.

### Admin Plugin (`adminPlugin()`)

Lives in `packages/admin/src/server/plugin.ts`. User registers in `questpie.config.ts` via `plugins: [adminPlugin()]`. Declares:

- **4 discover patterns**: views, components, blocks, `config/admin.ts` (adminConfig with `destructure` mapping sidebar, dashboard, branding, adminLocale).
- **2 module registries**: views, components — with placeholder tokens for type extraction.
- **5 collection extensions**: admin, list, form, preview, actions.
- **2 global extensions**: admin, form.
- **2 field extensions**: admin (per-field admin meta), form (layout for object fields).
- **1 singleton factory**: adminConfig (`AdminConfigInput`).
- **3 callback params**: `v` (view proxy), `c` (component proxy), `a` (action proxy).
- **1 type registry**: `ComponentTypeRegistry` in `@questpie/admin/server`.

### Plugin-Extensible Discriminants

Three augmentation interfaces allow plugins to extend discriminant types:

| Interface               | Package                  | Purpose                                          | Fallback      |
| ----------------------- | ------------------------ | ------------------------------------------------ | ------------- |
| `FieldTypeRegistry`     | `questpie`               | Field type names (`"text"`, `"number"`, etc.)    | `string`      |
| `ComponentTypeRegistry` | `@questpie/admin/server` | Component type names (`"icon"`, `"badge"`, etc.) | `string`      |
| `ViewKindRegistry`      | `@questpie/admin/server` | View kind names (`"list"`, `"edit"`)             | literal union |

Codegen generates `declare module` augmentations that extend these interfaces with the actual keys extracted from modules. The companion type aliases (`FieldType`, `ComponentType`, `ViewKind`) use the `[keyof Registry] extends [never] ? string : keyof Registry` pattern to fall back to `string` when the registry is empty.

### Key Codegen Types

- **`CategoryDeclaration`** (`cli/codegen/types.ts`): Declares how a category is discovered and emitted (dirs, prefix, emit strategy, type generation, registry key, app state inclusion).
- **`CodegenPlugin`** (`cli/codegen/types.ts`): Top-level plugin interface — categories, discover, transform, registries, callbackParams.
- **`ModuleRegistryConfig`** (`cli/codegen/types.ts`): Module-level type registries with placeholder tokens, registry keys, and optional `typeRegistry` for interface augmentation.
- **`CallbackParamDefinition`** (`cli/codegen/types.ts`): Inline JS proxy code for callback context parameters.

### Codegen Key Derivation — How Entity Keys Are Determined

Every discovered entity (collection, view, block, component, route, etc.) gets a **key** that becomes:
- The import variable name: `_view_{key}`, `_coll_{key}`, `_bloc_{key}`
- The object key in module/app state: `{ [key]: entity }`
- The type key in registry interfaces: `interface Views { [key]: typeof entity }`
- The callback proxy key: `v.{key}(...)`, `f.{key}`

**Key derivation rules** (in `discover.ts`, function `processFile`):

| Scenario | Key source | Example |
|---|---|---|
| Category with `factoryFunctions`, **named exports** (multi-export), single match | Filename (camelCase) | `blocks/hero.ts` exports `heroBlock = block("hero")` → key: `hero` |
| Category with `factoryFunctions`, **named exports**, multiple matches | Export name | Two exports in one file → keys: export names |
| Category with `factoryFunctions`, **default export**, factory has string arg | **Factory string arg** (kebab→camelCase) | `views/table.ts` exports `default view("collection-table", ...)` → key: `collectionTable` |
| Category with `factoryFunctions`, **default export**, no string arg | Filename (camelCase) | `views/custom.ts` exports `default view(config)` → key: `custom` |
| Category **without** `factoryFunctions` | Filename (camelCase) | `fields/boolean.ts` → key: `boolean` |
| Recursive category (routes) | Path segments (camelCase, joined by keySeparator) | `routes/webhooks/stripe.ts` → key: `webhooks/stripe` |

**Why factory arg, not filename?** The factory string arg is the entity's **identity** — it's used at runtime for lookup, serialization, and API contracts. The filename is just file organization. A view named `"collection-table"` could live in `views/table.ts`, `views/default-list.ts`, or any file — the identity is the string passed to `view()`.

**Consistency guarantee**: `collection("posts")` → `posts`, `block("hero")` → `hero`, `view("collection-table")` → `collectionTable`, `component("icon")` → `icon`. The factory arg is always the source of truth for the key when available.

**`keyFromProperty`** (`CategoryDeclaration.keyFromProperty`): Some categories (admin-client views) use a runtime property (e.g. `.name`) as the object key at runtime: `[_view.name]: _view`. This is separate from the discover key — the discover key drives types and imports, `keyFromProperty` drives the runtime object emission in `module.ts`. When `keyFromProperty` is set, types for that category are skipped in module-template (the file-derived key would mismatch the runtime key).

### Runtime Merging (`create-app.ts`)

- **`MERGE_FNS`**: `Map<string, MergeFn>` — per-key merge functions (e.g., `["auth", mergeAuthOptions]`). No string strategies, no switch statements.
- **`CONFIG_CONSUMED_KEYS`**: Derived from `MERGE_FNS.keys()`. Keys NOT in this set flow to `instance.state` for plugins.
- **`mergeRecord`, `mergeConcat`, `lastWins`**: Exported reusable merge helpers for plugins.

## Codegen Output & Exports

Running `questpie generate` produces `.generated/index.ts` which exports:

| Export           | Type     | Purpose                                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `app`            | `App`    | The runtime app instance — use in server functions, scripts, API handlers                       |
| `App`            | type     | Fully-typed `Questpie<...>` alias — use for type references (`typeof app`)                      |
| `AppConfig`      | type     | Flat config for client APIs — `createClient<AppConfig>()`, `createAdminAuthClient<AppConfig>()` |
| `AppCollections` | type     | Map of all collection definitions                                                               |
| `AppGlobals`     | type     | Map of all global definitions                                                                   |
| `AppRoutes`      | type     | Map of all route definitions                                                                    |
| `createContext`  | function | Creates a rich `AppContext` for scripts/tests/standalone code                                   |

### The `#questpie` Subpath Import

All user code should import from `#questpie` — the subpath alias configured in `package.json` (`imports`) and `tsconfig.json` (`paths`):

```ts
import { app, createContext } from "#questpie";
import type { App, AppConfig } from "#questpie";
```

Do NOT import from `.generated/index.ts` directly or create re-export wrapper files.

## Context System

Two distinct context types exist. Understanding when to use which is critical.

### `RequestContext` (lean — for CRUD operations)

Created by `app.createContext({ locale, accessMode })`. Contains only request-scoped data:
`session`, `locale`, `accessMode`, `db`, `stage`.

Used as the **2nd argument** to CRUD methods:

```ts
const ctx = await app.createContext({ accessMode: "system", locale: "en" });
const posts = await app.api.collections.posts.find(
	{ where: { published: true } },
	ctx,
);
```

### `AppContext` (rich — flat services for handlers)

Provided automatically to framework handlers via `declare global { namespace Questpie { interface AppContext } }` augmentation. Contains **everything**: `db`, `collections`, `globals`, `queue`, `storage`, `email`, `kv`, `session`, `services`, `t`, etc.

You get this in:

- **Route handlers**: `route().handler(async ({ collections, db, input }) => ...)`
- **Hooks**: `beforeCreate: [async ({ data, collections, db }) => ...]`
- **Block prefetch**: `.prefetch(async ({ values, ctx }) => ctx.collections.*)`
- **Jobs**: `job().handler(async ({ data, collections }) => ...)`
- **Services**: `service().create(({ db, collections }) => ...)`

For standalone use (scripts, seeds, tests), create one explicitly:

```ts
import { createContext } from "#questpie";
const ctx = await createContext();
const posts = await ctx.collections.posts.find({});
```

### When to Import `app` vs Use Handler Context

| Context                                | Import `app`?                                     | How to access data                         |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Server functions (`createServerFn`)    | Yes — `import { app } from "#questpie"`           | `app.api.collections.*` + `RequestContext` |
| API route mount (`createFetchHandler`) | Yes — `import { app } from "#questpie"`           | Pass to handler                            |
| Worker (`app.queue.listen()`)          | Yes — `import { app } from "#questpie"`           | Direct call                                |
| Scripts, seeds, tests                  | Yes — `import { createContext } from "#questpie"` | Rich `AppContext`                          |
| QUESTPIE route handlers                | **NO** — destructure `{ collections }`            | Provided automatically                     |
| Collection hooks                       | **NO** — destructure from handler args            | Provided automatically                     |
| Block prefetch                         | **NO** — use `ctx.collections.*`                  | Provided automatically                     |
| Access control                         | **NO** — destructure from handler args            | Provided automatically                     |

**Rule:** Files inside `questpie/server/collections/`, `globals/`, `routes/`, `hooks/`, `blocks/`, `jobs/` must NEVER import from `#questpie` or `.generated/index.ts` — this creates circular dependencies because `.generated/index.ts` imports them.

## Development Workflow

### Commands (from repo root)

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `bun install`          | Install all workspace deps                           |
| `bun run dev`          | Start all packages in dev/watch mode (via turbo)     |
| `bun run build`        | Build all packages                                   |
| `bun run check-types`  | TypeScript type checking across the monorepo         |
| `bun test`             | Run tests (Bun test runner, migrations silenced)     |
| `bun run lint`         | Oxlint lint check                                    |
| `bun run lint:fix`     | Oxlint lint with auto-fix                            |
| `bun run format`       | Oxfmt format (writes)                                |
| `bun run format:check` | Oxfmt format check                                   |
| `bun run clean`        | Remove lock files, node_modules, and build artifacts |

### Package-Specific Commands

Inside `packages/questpie`:

- `bun test` — run tests
- `bun test --watch` — watch mode
- `bun run build` — build via tsdown
- `bun run check-types` — type check

### Formatting & Linting

- **Oxlint** (`.oxlintrc.json`): linting with correctness + suspicious categories.
- **Oxfmt** (`.oxfmtrc.json`): tabs for indentation, double quotes for JS/TS, import sorting, Tailwind class sorting.
- Run `bunx oxlint --fix` to fix lint issues, `bunx oxfmt` to format.

### Testing

- Test runner: **Bun's built-in test runner** (`bun test`).
- Tests live in `packages/questpie/test/` organized by feature:
  - `test/collection/` — CRUD, hooks, relations, uploads, field access, localization.
  - `test/fields/` — Field builder, reactive fields, type inference.
  - `test/global/` — Global settings.
  - `test/integration/` — Integration tests.
  - `test/migration/`, `test/seed/`, `test/search/`, `test/openapi/` — Feature-specific.
- Migration output is silenced in tests via `QUESTPIE_MIGRATIONS_SILENT=1`.
- Tests use `@electric-sql/pglite` for in-process PostgreSQL.

### Changesets & Publishing

- **Changesets** for versioning: `bun changeset` to create, `bun run version` to apply.
- All core packages are in a **fixed version group** (questpie, @questpie/admin, @questpie/elysia, @questpie/hono, @questpie/next, @questpie/tanstack-query).
- `@questpie/openapi` and `create-questpie` version independently.
- Examples are **ignored** by changesets.
- Publishing: `bun run release` — builds packages, applies publishConfig overrides, resolves `workspace:*`, runs `changeset publish`.

### Dependencies

- **Check `package.json`** before adding deps — critical packages have pinned versions (zod v4, drizzle-orm beta, better-auth, etc.).
- Internal deps **must** use `workspace:*`.
- Key pinned versions: `zod ^4.2.1`, `drizzle-orm 1.0.0-beta.*`, `react ^19.2.0`, `tailwindcss ^4.0.6`.

### Git Workflow

- Default branch: `main`.
- Feature branches: `feat/*`, `fix/*`, `chore/*`.
- Changesets are committed with PRs — each PR with user-facing changes should include a changeset.

## Admin UI Conventions (packages/admin)

### Component Stack

- **Primitives**: `@base-ui/react` (NOT @radix-ui).
- **Icons**: `@iconify/react` with Phosphor set (`ph:icon-name`). NOT lucide-react, NOT @phosphor-icons/react.
- **Toast**: `sonner` — `toast.error()`, `toast.success()`.
- **Adding components**: `bunx shadcn@latest add <name>` from `packages/admin`.

### API Patterns

base-ui uses `render` prop, NOT `asChild`:

```tsx
// ✅ Correct
<DialogTrigger render={<Button>Open</Button>} />

// ❌ Wrong — asChild is Radix, not base-ui
<DialogTrigger asChild><Button>Open</Button></DialogTrigger>
```

### Responsive

- `ResponsivePopover` — Popover on desktop, Drawer on mobile.
- `ResponsiveDialog` — Dialog on desktop, fullscreen Drawer on mobile.
- Hooks: `useIsMobile()`, `useIsDesktop()`, `useMediaQuery()`.

### Anti-Patterns

- ❌ Custom `<button>`/`<div>` instead of `<Button>`/`<Card>`.
- ❌ `console.error` for user errors — use `toast.error()`.
- ❌ `asChild` prop — use `render` prop.
- ❌ UI-specific fields in the database schema — admin config is UI-only.

## Blocks & Circular Dependencies

Block prefetch handlers receive `ctx` with fully typed `collections` and `globals` via `AppContext` augmentation.
Use `ctx.collections.*` directly — no app import needed:

```ts
// blocks/team.ts
import { block } from "@questpie/admin/server";

export const teamBlock = block("team")
	.fields(({ f }) => ({
		limit: f.number().label("Limit").default(4),
	}))
	.prefetch(async ({ values, ctx }) => {
		const res = await ctx.collections.barbers.find({
			limit: values.limit || 4,
			where: { isActive: true },
			with: { avatar: true },
		});
		return { members: res.docs };
	});
```

Blocks with only declarative prefetch (`{ with: { field: true } }`) don't need a function at all.

**Important:** Do NOT import `app` from `#questpie` inside block/collection/route/hook files — these are imported BY `.generated/index.ts`, so importing from it back creates circular dependencies. Use the `ctx`/handler parameters instead.

## Reactive Field System

Fields support reactive behaviors in `meta.admin`:

- **`hidden`**: Conditionally hide — `({ data }: { data: Record<string, any> }) => !data.isPublished`
- **`readOnly`**: Make read-only based on conditions.
- **`disabled`**: Disable conditionally.
- **`compute`**: Auto-compute values — `{ handler, deps, debounce }`.

All reactive handlers run **server-side** with access to `ctx.db`, `ctx.user`, `ctx.req`.

**Dynamic options** for select/relation:

```ts
city: f.relation().to("cities").label("City").admin({
  options: {
    handler: async ({ data, search, ctx }) => {
      const cities = await ctx.db.query.cities.findMany({
        where: { countryId: data.country },
      });
      return { options: cities.map((c) => ({ value: c.id, label: c.name })) };
    },
    deps: ({ data }) => [data.country],
  },
}),
```

## References

- Core package README: `packages/questpie/README.md`
- Admin package README: `packages/admin/README.md`
- Archived dependencies: `docs/archive/DEPENDENCIES.md`
- Documentation source: `apps/docs/content/docs/`
