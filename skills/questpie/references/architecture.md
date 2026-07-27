---
name: questpie-core/architecture
description:
  QUESTPIE architecture overview tech stack monorepo packages project structure file conventions directory layout codegen discovery export conventions feature-first app bootstrap createApp module merge data flow startup HTTP request admin panel module contribution primitive hierarchy
  - questpie-core
---

This skill builds on questpie-core.

# Architecture & Conventions

## Architecture Overview

QUESTPIE is a **headless CMS framework** for TypeScript. You define your content model declaratively (collections, globals, fields), and the framework gives you:

- A fully typed **REST API** (auto-generated from your schema)
- A pluggable **admin panel** (React, server-driven)
- **Typed client SDK** + TanStack Query hooks
- Background **jobs**, **email**, **storage**, **search**, **realtime**, all pluggable

### Tech Stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Runtime  | **Bun**                                           |
| Database | **PostgreSQL** via **Drizzle ORM**                |
| Auth     | **Better Auth**                                   |
| Storage  | **Files SDK** (local FS, S3, R2, GCS)             |
| Admin UI | **React** + **TanStack Router** + **Tailwind**    |
| HTTP     | Custom trie-based router (no Express/Hono needed) |
| Build    | **tsdown** (Rolldown-based) + **Turbo** monorepo  |

### Monorepo Packages

```
packages/
  questpie/           ← Core framework (server, client, CLI, shared)
  admin/              ← Admin panel (server augmentation + React client)
  elysia/             ← Elysia HTTP adapter
  hono/               ← Hono HTTP adapter
  next/               ← Next.js adapter
  openapi/            ← OpenAPI/Scalar plugin
  mcp/                ← Model Context Protocol integration
  tanstack-query/     ← TanStack Query integration
  create-questpie/    ← Project scaffolder (bunx create-questpie)
```

## Project Structure & File Conventions

A QUESTPIE project follows a **convention-over-configuration** file layout. The codegen system scans these directories and auto-wires everything.

```
<project>/
  questpie.config.ts                ← CLI entry (re-exports server runtime config)
  .env                              ← created from .env.example by create-questpie
  src/
    lib/
      env.ts                        ← @t3-oss/env-core boot validation (scaffold default)
      client.ts                     ← typed QUESTPIE client SDK
      query.ts                      ← TanStack Query option builders
    questpie/
      server/                       ← Server root (all data + behavior)
        questpie.config.ts          ← runtimeConfig({ db, app, storage, ... })
        modules.ts                  ← export default [adminModule, ...] as const
        config/
          auth.ts                   ← authConfig({...})       (from "questpie/app")
          app.ts                    ← appConfig({...})        (from "questpie/app", optional)
          admin.ts                  ← adminConfig({...})      (from "#questpie/factories")
        collections/                ← One file per collection
        globals/                    ← One file per global
        routes/                     ← API routes (recursive, default export)
        jobs/                       ← Background jobs
        services/                   ← Custom services
        emails/                     ← Email templates (.tsx)
        blocks/                     ← Content blocks
        fields/                     ← Custom field types
        migrations/                 ← DB migrations
        seeds/                      ← DB seeds
        messages/                   ← i18n messages
        features/                   ← Feature-first alternative layout
          <feature>/
            collections/
            routes/
            jobs/
            ...
        .generated/                 ← DO NOT EDIT (codegen output)
          index.ts
          factories.ts
          env.client.<consumer>.ts  ← per-consumer typed client env (when env.client.ts exists)
      admin/                        ← Admin client config
        admin.ts
        modules.ts
        blocks/                     ← Block renderer components
        .generated/
          client.ts
    routes/
      api/$.ts                      ← TanStack Start HTTP catch-all → createFetchHandler(app)
```

`create-questpie` ships four runtime templates: `tanstack-start` (default), `next`, `hono`, and `elysia`. `tanstack-start` and `next` default to `admin` + `openapi`; `hono` and `elysia` default to `openapi` only. Optional module id `workflows` is supported. The scaffolder also wires adapter choices: queue `pg-boss` / `bullmq` / `none`, email `console` / `smtp` / `resend` / `plunk`, realtime `none` / `pg-notify` / `redis-streams`, and KV `memory` / `redis`. Env validation: the scaffold default is `@t3-oss/env-core` in `src/lib/env.ts`; the framework-native `questpie/env` helper is the opt-in alternative (see `references/env.md`).

### Key Rules

- **Files starting with `_`** are private/utility, skipped by discovery.
- **`index.ts`** files are always ignored by the scanner for compatibility. Do not add barrel re-exports in convention directories; define entities directly in named files such as `posts.ts` or `site-settings.ts`.
- **File names become keys**: `site-settings.ts` → `siteSettings` (kebab → camelCase). Underscores are preserved (`my_table.ts` → `my_table`) for PostgreSQL naming.
- **`features/`** mirrors the same directory structure, entities from both flat and feature layouts are merged.

### Feature-First Layout

`features/<feature>/<category>/...` is an organizational layout, not a namespace. Codegen scans both `collections/posts.ts` and `features/blog/collections/articles.ts` into the same `collections` map.

Rules:

- Feature names do not prefix keys: `features/blog/collections/articles.ts` becomes `app.collections.articles`.
- Keys must be unique per category across flat and feature layouts. Duplicates are codegen errors.
- Recursive route keys ignore the feature prefix: `features/blog/routes/webhooks/stripe.post.ts` becomes `webhooks/stripe:POST`.
- Core supported category dirs: `collections`, `globals`, `jobs`, `routes`, `functions`, `messages`, `services`, `emails`, `migrations`, `seeds`, `fields`.
- Plugin category dirs and directory patterns use the same rule, for example `features/admin/blocks/hero.ts` when the admin plugin is enabled.
- Single-file config patterns stay root-level unless a plugin explicitly uses `mergeStrategy: "spread"`. Do not put `config/app.ts`, `config/auth.ts`, `config/admin.ts`, `modules.ts`, `env.ts`, or `fields.ts` under `features/`.
- `features/_internal`, `_helpers.ts`, `index.ts`, tests, and declaration files are skipped.

### Export Conventions Per Directory

| Directory       | Export Style              | Factory              |
| --------------- | ------------------------- | -------------------- |
| `collections/`  | **named** export          | `collection("name")` |
| `globals/`      | **named** export          | `global("name")`     |
| `routes/`       | **default** export        | `route()`            |
| `jobs/`         | **default** export        | `job({...})`         |
| `services/`     | **named** export          | `service()`          |
| `emails/`       | **default** export (.tsx) | `email({...})`       |
| `blocks/`       | **named** export          | `block("name")`      |
| `migrations/`   | **default** export        | `migration({...})`   |
| `seeds/`        | **default** export        | `seed({...})`        |
| `env.ts`        | **default** export        | `env({...})`         |
| `env.client.ts` | **default** export        | `clientEnv({...})`   |

## App Bootstrap

### How It Starts

```
questpie.config.ts  →  src/questpie/server/questpie.config.ts  →  modules.ts  →  codegen  →  .generated/index.ts  →  createApp()
```

**Step 1**, `questpie.config.ts` declares infrastructure (DB, storage, email, etc.); `env.ts` validates environment variables first (see `references/env.md`):

```ts
// questpie.config.ts
import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";

import env from "./env";

export default runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: { adapter: new ConsoleAdapter() },
});
```

A misconfigured environment fails boot before adapters/auth/db init, with every offending var named (values never logged).

**Step 2**, `modules.ts` declares which module packages to use:

```ts
import { adminModule } from "@questpie/admin/modules/admin";
import { openApiModule } from "@questpie/openapi/modules/openapi";

export default [adminModule, openApiModule] as const;
```

**Step 3**, `questpie generate` scans everything and writes `.generated/index.ts` which calls `createApp({ modules, collections, globals, routes, jobs, seeds, migrations, ... }, runtime)`.

**Step 4**, Inside `createApp()`:

1. Auto-prepends `coreModule` (built-in routes, services, field types)
2. Flattens all modules **depth-first** (sub-modules first, parent last)
3. **Merges** contributions per key, later modules override earlier ones
4. Wraps user-level entities as `__user` module (appended **last** = user always wins)
5. Creates the `Questpie` instance with merged config
6. Initializes all services (`db`, `auth`, `storage`, `queue`, `email`, `kv`, `logger`, `search`, `realtime`)

**Step 5**, The HTTP handler connects it all:

```ts
// src/routes/api/$.ts (TanStack Start example)
import { app } from "#questpie";
import { createFetchHandler } from "questpie/http";
import { createAPIFileRoute } from "@tanstack/react-start/api";

const handler = createFetchHandler(app, { basePath: "/api" });

export const APIRoute = createAPIFileRoute("/api/$")({
	GET: ({ request }) => handler(request),
	POST: ({ request }) => handler(request),
	PUT: ({ request }) => handler(request),
	DELETE: ({ request }) => handler(request),
	PATCH: ({ request }) => handler(request),
});

// For standalone Bun.serve:
// Bun.serve({ fetch: createFetchHandler(app) });
```

This single handler serves all collection CRUD, auth, search, realtime, storage, and custom routes via a **trie-based dispatcher**. The exact wiring depends on your framework: TanStack Start uses `createAPIFileRoute`, Hono mounts `questpieMiddleware(app)` (from `@questpie/hono/server`), Next.js uses route handlers.

## Data Flow

### HTTP Request

```
HTTP Request
  ↓
createFetchHandler (trie match)
  ↓
Resolve session (Better Auth)
  ↓
Resolve locale (header / cookie)
  ↓
Build AppContext { db, session, collections, globals, queue, email, ... }
  ↓
Route handler / Collection CRUD
  ↓
Access control check
  ↓
Hooks: beforeOperation → beforeValidate → beforeChange
  ↓
DB operation (Drizzle)
  ↓
Hooks: afterChange → afterRead
  ↓
Realtime event (written to outbox)
  ↓
HTTP Response (JSON / SuperJSON)
```

### Admin Panel

```
Browser loads /admin
  ↓
AdminLayoutProvider receives pre-built AdminState
  (fields, views, pages, widgets, blocks, components, translations)
  ↓
Sidebar rendered from adminConfig.sidebar
  ↓
User clicks "Posts" → Fetch GET /api/posts/schema → CollectionSchema (server-driven UI config)
  ↓
Look up "collection-table" view in AdminState.views → render table (schema-driven columns, filters, sort, actions)
  ↓
User clicks a row → Fetch GET /api/posts/{id}
  ↓
Look up "collection-form" view → render form (schema-driven layout, sections, tabs, sidebar)
  ↓
Each field renders via AdminState.fields[fieldType].component
  ↓
Validation via buildZodFromIntrospection() (client-side Zod)
  ↓
Submit PATCH /api/posts/{id} → server hooks + access control + DB write + realtime event
```

### Module Contribution

```
Module author writes:
  collections/invoices.ts    → collection("invoices").fields(...)
  routes/create-checkout.ts  → route().post().handler(...)
  jobs/retry-payment.ts      → job({ name: "retryPayment", ... })
        ↓
questpie generate --module   → .generated/module.ts
        ↓
Published to npm as @my-org/billing-module
        ↓
User adds to modules.ts and runs questpie generate → merges into .generated/index.ts
        ↓
At runtime: billingModule's collections, routes, jobs are part of the app
```

## The Primitive Hierarchy

```
runtimeConfig()          Infrastructure (DB, storage, email, queue, ...)
  ↓
module()                 Packaging unit (groups related entities)
  ├── collection()       Data table with CRUD, hooks, access, versioning
  │     ├── f.text()     Field definitions (each → DB column + validation + UI)
  │     ├── f.relation() Relationships between collections
  │     ├── .hooks()     Lifecycle callbacks
  │     ├── .access()    Permission rules
  │     ├── .admin()     Admin panel metadata         ← admin plugin
  │     ├── .list()      List view configuration      ← admin plugin
  │     ├── .form()      Form view configuration      ← admin plugin
  │     ├── .preview()   Live preview                 ← admin plugin
  │     └── .actions()   Server actions               ← admin plugin
  ├── global()           Singleton document (settings, config)
  ├── route()            Custom HTTP endpoint
  ├── job()              Background task
  ├── service()          Injectable dependency
  ├── email()            Email template
  ├── block()            Content builder block         ← admin plugin
  ├── migration()        DB schema change
  ├── seed()             DB seed data
  ├── appConfig()        App-level config (locale, access, hooks, context)
  ├── authConfig()       Auth config (Better Auth options)
  └── adminConfig()      Admin config (sidebar, dashboard, branding)  ← admin plugin
```
