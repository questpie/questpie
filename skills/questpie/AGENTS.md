# QuestPie Framework 101

Everything a developer needs to understand and work with QuestPie CMS.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure & File Conventions](#2-project-structure--file-conventions)
3. [App Bootstrap](#3-app-bootstrap)
4. [Modules](#4-modules)
5. [Collections](#5-collections)
6. [Globals](#6-globals)
7. [Fields](#7-fields)
8. [Relations](#8-relations)
9. [Hooks](#9-hooks)
10. [Access Control](#10-access-control)
11. [Routes](#11-routes)
12. [Services](#12-services)
13. [Jobs](#13-jobs)
14. [Email Templates](#14-email-templates)
15. [Migrations & Seeds](#15-migrations--seeds)
16. [Uploads & Storage](#16-uploads--storage)
17. [Versioning & Workflow](#17-versioning--workflow)
18. [Search](#18-search)
19. [Realtime](#19-realtime)
20. [i18n / Localization](#20-i18n--localization)
21. [AppContext — What's Available Everywhere](#21-appcontext--whats-available-everywhere)
22. [Server-Side CRUD API](#22-server-side-crud-api)
23. [Client SDK](#23-client-sdk)
24. [TanStack Query Integration](#24-tanstack-query-integration)
25. [Admin Panel](#25-admin-panel)
26. [Admin Builder Extensions](#26-admin-builder-extensions)
27. [Admin Fields, Views, Widgets, Blocks, Components](#27-admin-fields-views-widgets-blocks-components)
28. [Codegen & the .generated/ Directory](#28-codegen--the-generated-directory)
29. [Adapters & Infrastructure](#29-adapters--infrastructure)
30. [TypeScript Type Augmentation](#30-typescript-type-augmentation)
31. [CLI Reference](#31-cli-reference)
32. [How It All Connects — The Big Picture](#32-how-it-all-connects--the-big-picture)

---

## 1. Architecture Overview

QuestPie is a **headless CMS framework** for TypeScript. You define your content model declaratively (collections, globals, fields), and the framework gives you:

- A fully typed **REST API** (auto-generated from your schema)
- A pluggable **admin panel** (React, server-driven)
- **Typed client SDK** + TanStack Query hooks
- Background **jobs**, **email**, **storage**, **search**, **realtime** — all pluggable

### Tech Stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Runtime  | **Bun**                                           |
| Database | **PostgreSQL** via **Drizzle ORM**                |
| Auth     | **Better Auth**                                   |
| Storage  | **FlyDrive** (local FS, S3, R2, GCS)              |
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
  tanstack-query/     ← TanStack Query integration
  create-questpie/    ← Project scaffolder (bunx create-questpie)
```

---

## 2. Project Structure & File Conventions

A QuestPie project follows a **convention-over-configuration** file layout. The codegen system scans these directories and auto-wires everything.

```
<project>/
  questpie.config.ts                ← CLI entry (wraps app + cli config)
  src/
    questpie/
      server/                       ← Server root (all data + behavior)
        questpie.config.ts          ← runtimeConfig({ db, app, storage, ... })
        modules.ts                  ← export default [adminModule, ...] as const
        app.ts                      ← re-export of .generated/index (stable import)
        config/
          auth.ts                   ← authConfig({...})       (from "questpie")
          app.ts                    ← appConfig({...})        (from "questpie", optional)
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
      admin/                        ← Admin client config
        admin.ts
        modules.ts
        blocks/                     ← Block renderer components
        .generated/
          client.ts
    routes/
      api/$.ts                      ← HTTP catch-all → createFetchHandler(app)
```

### Key Rules

- **Files starting with `_`** are private/utility — skipped by discovery.
- **`index.ts`** files are always ignored by the scanner (use them as barrel re-exports if needed).
- **File names become keys**: `site-settings.ts` → `siteSettings` (kebab → camelCase). Underscores are preserved (`my_table.ts` → `my_table`) for PostgreSQL naming.
- **`features/`** mirrors the same directory structure — entities from both flat and feature layouts are merged.

### Export Conventions Per Directory

| Directory      | Export Style              | Factory              |
| -------------- | ------------------------- | -------------------- |
| `collections/` | **named** export          | `collection("name")` |
| `globals/`     | **named** export          | `global("name")`     |
| `routes/`      | **default** export        | `route()`            |
| `jobs/`        | **default** export        | `job({...})`         |
| `services/`    | **named** export          | `service()`          |
| `emails/`      | **default** export (.tsx) | `email({...})`       |
| `blocks/`      | **named** export          | `block("name")`      |
| `migrations/`  | **default** export        | `migration({...})`   |
| `seeds/`       | **default** export        | `seed({...})`        |

---

## 3. App Bootstrap

### How It Starts

```
questpie.config.ts  →  modules.ts  →  codegen  →  .generated/index.ts  →  createApp()
```

**Step 1** — `questpie.config.ts` declares infrastructure (DB, storage, email, etc.):

```ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: process.env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: { adapter: new ConsoleAdapter() },
});
```

**Step 2** — `modules.ts` declares which module packages to use:

```ts
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [adminModule, openApiModule] as const;
```

**Step 3** — `questpie generate` scans everything and writes `.generated/index.ts` which calls:

```ts
export const app = await createApp(
  { modules, collections, globals, routes, jobs, seeds, migrations, ... },
  runtime
);
```

**Step 4** — Inside `createApp()`:

1. Auto-prepends `coreModule` (built-in routes, services, field types)
2. Flattens all modules **depth-first** (sub-modules first, parent last)
3. **Merges** contributions per key — later modules override earlier ones
4. Wraps user-level entities as `__user` module (appended **last** = user always wins)
5. Creates the `Questpie` instance with merged config
6. Initializes all services (`db`, `auth`, `storage`, `queue`, `email`, `kv`, `logger`, `search`, `realtime`)

**Step 5** — The HTTP handler connects it all:

```ts
// src/routes/api/$.ts (TanStack Start example)
import { createFetchHandler } from "questpie";
import { app } from "@/questpie/server/app";
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

This single handler serves all collection CRUD, auth, search, realtime, storage, and custom routes via a **trie-based dispatcher**. The exact wiring depends on your framework — TanStack Start uses `createAPIFileRoute`, Hono uses middleware, Next.js uses route handlers.

---

## 4. Modules

Modules are the **packaging unit** of the framework. They are plain static objects — no class instances, no runtime instantiation.

```ts
import { module } from "questpie";

export const billingModule = module({
	name: "billing",
	modules: [stripeModule], // sub-dependencies
	collections: { invoices, subscriptions },
	globals: { billingSettings },
	routes: { "create-checkout": createCheckoutRoute },
	jobs: { retryPayment },
	services: { stripe: stripeService },
	migrations: [billingMigration001],
	seeds: [billingSeeds],
	messages: { en: { "billing.title": "Billing" } },
	config: { app: billingAppConfig },
});
```

### What Modules Can Contribute

| Key           | Type                                  | Merge Strategy              |
| ------------- | ------------------------------------- | --------------------------- |
| `collections` | `Record<string, CollectionBuilder>`   | spread (later wins per key) |
| `globals`     | `Record<string, GlobalBuilder>`       | spread                      |
| `routes`      | `Record<string, RouteDefinition>`     | spread                      |
| `jobs`        | `Record<string, JobDefinition>`       | spread                      |
| `services`    | `Record<string, ServiceBuilder>`      | spread                      |
| `fields`      | `Record<string, FieldTypeDefinition>` | spread                      |
| `migrations`  | `Migration[]`                         | array concat                |
| `seeds`       | `Seed[]`                              | array concat                |
| `messages`    | `Record<locale, Record<key, string>>` | deep merge per locale       |
| `config`      | `{ app?, auth?, admin?, ... }`        | per-key strategy            |

### Built-in Modules

| Module          | Package                     | Provides                                                                                    |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `coreModule`    | `questpie` (auto-prepended) | All REST routes, all services, built-in field types                                         |
| `starterModule` | `questpie`                  | Auth collections (user, session, account, verification, apikey, assets), Better Auth config |
| `adminModule`   | `@questpie/admin`           | Admin panel routes, views, components, admin-specific collections                           |
| `auditModule`   | `@questpie/admin`           | Audit log collection + cleanup job                                                          |
| `openApiModule` | `@questpie/openapi`         | OpenAPI schema + Scalar docs UI                                                             |

### Module Resolution

Modules are resolved **depth-first**: sub-modules are processed before their parent. If two modules share the same `name`, the **last** occurrence wins (deduplication by name). This allows overriding.

---

## 5. Collections

Collections are the **primary data primitive** — each one maps to a PostgreSQL table with auto-generated CRUD, hooks, access control, and admin UI.

```ts
import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.options({
		timestamps: true, // adds createdAt, updatedAt
		softDelete: true, // adds deletedAt (records are "trashed", not deleted)
		versioning: {
			// creates a _versions table
			workflow: true, // enables draft → published stages
		},
	})
	.fields(({ f }) => ({
		title: f.text(255).required().label("Title"),
		slug: f.text(255).required(),
		content: f.richText().localized(),
		status: f.select(["draft", "published"]).default("draft"),
		author: f.relation("users"),
		tags: f.relation("tags").manyToMany({ through: "post_tags" }),
		cover: f.upload(),
	}))
	.title(({ f }) => f.title)
	.indexes(({ table }) => [uniqueIndex("posts_slug_unique").on(table.slug)])
	.access({
		read: true, // public
		create: ({ session }) => !!session, // authenticated only
		update: ({ session, data }) => data.authorId === session?.user.id, // own records
		delete: ({ session }) => session?.user.role === "admin",
	})
	.hooks({
		beforeChange: async ({ data, operation }) => {
			if (operation === "create") {
				data.slug = slugify(data.title);
			}
			return data;
		},
		afterChange: async ({ data, queue }) => {
			await queue.indexRecords.publish({ collection: "posts", ids: [data.id] });
		},
	})
	.searchable({ content: (r) => r.title })
	.admin(({ c }) => ({
		label: "Blog Posts",
		icon: c.icon({ name: "ph:article" }),
		group: "content",
	}))
	.list(({ v, f, a }) =>
		v.collectionTable({
			columns: [f.title, f.status, f.author, f.createdAt],
			defaultSort: { field: f.createdAt, direction: "desc" },
			filterable: [f.status, f.author],
			actions: {
				header: { primary: [a.create()] },
				row: [a.delete()],
				bulk: [a.deleteMany()],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				f.title,
				f.slug,
				{ type: "section", label: "Content", fields: [f.content] },
				{
					type: "tabs",
					tabs: [
						{ id: "media", label: "Media", fields: [f.cover] },
						{
							id: "seo",
							label: "SEO",
							fields: [f.metaTitle, f.metaDescription],
						},
					],
				},
			],
			sidebar: {
				fields: [f.status, f.author, f.tags],
			},
		}),
	)
	.preview({
		enabled: true,
		url: ({ record, locale }) => `/blog/${record.slug}?locale=${locale}`,
		position: "right",
	})
	.actions(({ a, c }) => ({
		custom: [
			a.action({
				id: "publish",
				label: "Publish Now",
				icon: c.icon({ name: "ph:rocket" }),
				confirmation: {
					title: "Publish this post?",
					description: "It will become visible to all readers.",
				},
				handler: async ({ record, collections }) => {
					await collections.posts.updateById({
						id: record.id,
						data: { status: "published" },
					});
					return { type: "success", toast: { message: "Published!" } };
				},
			}),
		],
	}));
```

### CollectionBuilder Methods

| Method                           | Purpose                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `.fields(({ f }) => {...})`      | Define fields (see [Fields](#7-fields))                           |
| `.options({...})`                | timestamps, softDelete, versioning                                |
| `.title(({ f }) => f.name)`      | Which field is the display title                                  |
| `.indexes(({ table }) => [...])` | Drizzle indexes/constraints                                       |
| `.access({...})`                 | Permission rules (see [Access Control](#10-access-control))       |
| `.hooks({...})`                  | Lifecycle hooks (see [Hooks](#9-hooks))                           |
| `.searchable({...})`             | Full-text search config                                           |
| `.validation({...})`             | Zod validation overrides                                          |
| `.upload({...})`                 | Turn into upload collection (see [Uploads](#16-uploads--storage)) |
| `.set(key, value)`               | Plugin extension point                                            |
| `.merge(other)`                  | Combine two builders                                              |
| `.admin({...})`                  | Admin panel metadata (label, icon, group)                         |
| `.list({...})`                   | List view config                                                  |
| `.form({...})`                   | Form view config                                                  |
| `.preview({...})`                | Live preview config                                               |
| `.actions({...})`                | Custom server actions                                             |

> `.admin()`, `.list()`, `.form()`, `.preview()`, `.actions()` are added by the admin plugin — they're not available without `@questpie/admin`.

---

## 6. Globals

Globals are **singleton documents** — one row per global (or one per tenant if `scoped`). Think "site settings", "homepage config", "footer links".

```ts
import { global } from "#questpie/factories";

export const siteSettings = global("site_settings")
	.fields(({ f }) => ({
		siteName: f.text(255).required().default("My Site"),
		description: f.textarea(),
		logo: f.upload(),
		socialLinks: f.object({
			twitter: f.url(),
			github: f.url(),
			linkedin: f.url(),
		}),
	}))
	.options({
		timestamps: true,
		scoped: ({ session }) => session?.user.tenantId, // multi-tenant scoping
	})
	.access({
		read: true,
		update: ({ session }) => session?.user.role === "admin",
	})
	.admin(({ c }) => ({
		label: "Site Settings",
		icon: c.icon({ name: "ph:gear" }),
	}))
	.form(({ v, f }) =>
		v.globalForm({
			fields: [f.siteName, f.description, f.logo, f.socialLinks],
		}),
	);
```

### GlobalBuilder Methods

Same as CollectionBuilder but without `.list()`, `.preview()`, `.actions()`, `.indexes()`, `.searchable()`, `.upload()`. Globals have `get` + `update` instead of full CRUD.

---

## 7. Fields

Fields define the shape of your data. Every field starts from a **field type factory** and can be customized with chained methods.

### Built-in Field Types

All accessed via `f` in the `.fields()` callback:

| Factory                | DB Column                            | JS Type        | Key Options                                                                      |
| ---------------------- | ------------------------------------ | -------------- | -------------------------------------------------------------------------------- |
| `f.text(maxLength?)`   | `varchar(n)` / `text`                | `string`       | `.pattern(re)`, `.trim()`, `.lowercase()`, `.uppercase()`, `.min(n)`, `.max(n)`  |
| `f.textarea()`         | `text`                               | `string`       | `.min(n)`, `.max(n)`                                                             |
| `f.email(maxLength?)`  | `varchar(255)`                       | `string`       | `.min(n)`, `.max(n)`                                                             |
| `f.url(maxLength?)`    | `varchar(2048)`                      | `string`       | `.min(n)`, `.max(n)`                                                             |
| `f.number(mode?)`      | `integer` / `real` / `numeric` / ... | `number`       | `.min(n)`, `.max(n)`, `.positive()`, `.int()`, `.step(n)`                        |
| `f.boolean()`          | `boolean`                            | `boolean`      | —                                                                                |
| `f.date()`             | `date`                               | `string` (ISO) | `.autoNow()`, `.autoNowUpdate()`                                                 |
| `f.datetime()`         | `timestamp`                          | `Date`         | `.autoNow()`, `.autoNowUpdate()`                                                 |
| `f.time()`             | `time`                               | `string`       | —                                                                                |
| `f.select(options[])`  | `varchar`                            | `string`       | `.enum(name)`                                                                    |
| `f.relation(target)`   | `varchar(36)` FK                     | `string`       | See [Relations](#8-relations)                                                    |
| `f.upload(config?)`    | `varchar(36)` FK                     | `string`       | `.multiple()`                                                                    |
| `f.object(fields)`     | `jsonb`                              | `{...}`        | Nested field definitions                                                         |
| `f.json(config?)`      | `jsonb` / `json`                     | `JsonValue`    | `{ mode: "jsonb" \| "json" }`                                                    |
| `f.richText()`         | `jsonb`                              | TipTap doc     | _Admin plugin only_                                                              |
| `f.blocks()`           | `jsonb`                              | Block tree     | _Admin plugin only_                                                              |
| `f.from(column, zod?)` | custom                               | `unknown`      | `.type(name)` — escape hatch (PostGIS, etc.). Internal type string is `"custom"` |

### Common Field Methods (Available on All Types)

```ts
f.text(255)
	.required() // NOT NULL
	.default("untitled") // default value (or function)
	.label("Post Title") // display label (I18nText)
	.description("The main title") // help text
	.localized() // stored in i18n table, per-locale
	.virtual(sql`...`) // computed column, no DB storage
	.array() // wrap as JSONB array
	.minItems(1)
	.maxItems(10)
	.inputFalse() // exclude from create/update input (read-only)
	.inputOptional() // always optional in input
	.inputTrue() // force into input even if virtual
	.outputFalse() // exclude from output (write-only, e.g. password)
	.hooks({
		// field-level hooks
		beforeChange: (value, ctx) => value.trim(),
		afterRead: (value, ctx) => value,
		validate: (value, ctx) => {
			if (!value) throw new Error("Required");
		},
	})
	.access({
		// field-level access
		read: true,
		create: ({ session }) => !!session,
		update: ({ session }) => session?.user.role === "admin",
	})
	.operators(ops) // override WHERE operator set for queries
	.drizzle((col) => col) // escape hatch: modify Drizzle column
	.zod((schema) => schema) // escape hatch: modify Zod schema
	.fromDb((value) => value) // transform after reading from DB
	.toDb((value) => value) // transform before writing to DB
	.set(key, value) // plugin extension point (e.g. admin, form config)
	.derive(extra); // derive additional runtime state
```

### Custom Field Types

Define reusable field types with `fieldType()`:

```ts
import { fieldType } from "questpie";

export const colorField = fieldType("color", {
	create: () => ({
		type: "color",
		drizzleType: "varchar",
		drizzleArgs: [7],
	}),
	methods: {
		palette: (field, colors: string[]) => field.set("palette", colors),
	},
});

// Usage: f.color().palette(["#ff0000", "#00ff00"])
```

---

## 8. Relations

All relationships are expressed via `f.relation(target)` with chain methods:

### Relationship Types

```ts
// belongsTo (default) — FK on this table
f.relation("users");
// Column: authorId varchar(36) → FK to users.id

// hasMany — virtual, FK lives on the target table
f.relation("comments").hasMany({
	foreignKey: "postId",
	onDelete: "cascade",
});

// manyToMany — virtual, uses a junction table
f.relation("tags").manyToMany({
	through: "post_tags",
	sourceField: "postId", // optional, inferred
	targetField: "tagId", // optional, inferred
});

// multiple — stores array of IDs as JSONB
f.relation("assets").multiple();
// Column: imageIds jsonb (["uuid1", "uuid2", ...])

// polymorphic (morphTo) — two columns: type + id
f.relation({ users: "users", teams: "teams" });
// Columns: assigneeType varchar, assigneeId varchar
```

### Relation Targets

```ts
f.relation("users"); // string (collection name)
f.relation(() => users); // lazy reference (avoids circular imports)
f.relation({ users: "users", teams: "teams" }); // polymorphic map
```

### Additional Config

```ts
f.relation("users")
  .onDelete("cascade" | "set null" | "restrict" | "no action")
  .onUpdate("cascade" | ...)
  .relationName("postAuthor")  // disambiguate multiple relations to same target
```

---

## 9. Hooks

Hooks are lifecycle callbacks that run at specific points during CRUD operations.

### Execution Order

```
CREATE:  beforeOperation → beforeValidate → beforeChange → [DB INSERT] → afterChange → afterRead
UPDATE:  beforeOperation → beforeValidate → beforeChange → [DB UPDATE] → afterChange → afterRead
DELETE:  beforeOperation → beforeDelete   → [DB DELETE]  → afterDelete  → afterRead
READ:    beforeOperation → beforeRead     → [DB SELECT]  → afterRead
```

### Collection Hooks

```ts
collection("posts").hooks({
  // Runs before ANY operation — logging, rate limiting
  beforeOperation: async (ctx) => { ... },

  // Runs before validation on create/update — normalize input
  beforeValidate: async (ctx) => {
    ctx.data.email = ctx.data.email?.toLowerCase();
    return ctx.data;
  },

  // Runs after validation, before DB write — business logic, derived fields
  beforeChange: async (ctx) => {
    if (ctx.operation === "create") {
      ctx.data.slug = slugify(ctx.data.title);
    }
    return ctx.data;
  },

  // Runs after create/update — notifications, webhooks, side effects
  afterChange: async (ctx) => {
    // ctx.original is available on update (the record before changes)
    ctx.onAfterCommit(async () => {
      await ctx.email.send("post-updated", { to: ctx.data.authorEmail });
    });
  },

  // Runs before DB SELECT — modify query
  beforeRead: async (ctx) => { ... },

  // Runs after any operation that returns data
  afterRead: async (ctx) => {
    ctx.data.displayName = `${ctx.data.firstName} ${ctx.data.lastName}`;
    return ctx.data;
  },

  // Delete-specific
  beforeDelete: async (ctx) => { ... },
  afterDelete: async (ctx) => { ... },

  // Workflow transitions
  beforeTransition: async (ctx) => { ... },
  afterTransition: async (ctx) => { ... },
})
```

### Hook Context

Every hook receives `HookContext` which includes:

```ts
{
  // AppContext (always available)
  db, session, collections, globals, queue, email, storage,
  kv, logger, search, realtime, t,

  // Hook-specific
  data,                    // the record being processed
  original,                // previous version (update only)
  operation,               // "create" | "update" | "delete" | "read"
  locale,
  accessMode,              // "system" | "user"
  onAfterCommit(callback), // run after DB transaction commits

  // Batch operations
  isBatch, recordIds, records, count,
}
```

### Important Rules

- **`before*` hooks** — errors abort the operation (throw to reject)
- **`afterDelete`** (single) and **`afterChange`** (batch update) — errors are caught and logged (non-fatal)
- **`afterRead`** — errors **propagate** (fatal) — keep `afterRead` hooks safe
- **`afterChange`** (single create/update) — collection-level errors propagate; use `onAfterCommit` for risky side effects
- **Hooks can be arrays**: `.hooks({ afterChange: [hook1, hook2] })` — executed sequentially
- Use **`onAfterCommit`** for side effects (emails, jobs) that should only fire if the DB write succeeds
- **`deleteMany`** does NOT trigger `afterRead` — it returns `{ success, count }` directly

### Global Hooks

Apply hooks to **all** collections at once via `config/app.ts`. Available hook names for global hooks: `beforeChange`, `afterChange`, `beforeDelete`, `afterDelete`, `beforeTransition`, `afterTransition`.

```ts
appConfig({
	hooks: {
		collections: [
			{
				hook: "afterChange",
				include: ["posts", "pages"], // optional filter
				handler: async (ctx) => {
					/* audit log */
				},
			},
		],
	},
});
```

---

## 10. Access Control

Access control determines **who can do what**. It's evaluated automatically on every API request.

### Collection-Level Access

```ts
collection("posts").access({
  read:       true,                              // public
  create:     ({ session }) => !!session,         // any authenticated user
  update:     ({ session, data }) => ...,         // function → boolean or filter
  delete:     false,                              // nobody
  transition: ({ session }) => ...,               // workflow transitions
})
```

### Access Rule Types

```ts
true                          // allow everyone
false                         // deny everyone
undefined                     // require authenticated session (DEFAULT)
(ctx) => boolean              // function returning allow/deny
(ctx) => AccessWhere           // function returning a WHERE filter
```

**`AccessWhere`** is a SQL-like filter that gets merged into the query automatically:

```ts
// "Users can only read their own posts"
access: {
  read: ({ session }) => ({
    authorId: session.user.id,   // simple equality
  }),
  // Complex filters:
  read: ({ session }) => ({
    OR: [
      { status: "published" },
      { authorId: session.user.id },
    ],
  }),
}
```

### Field-Level Access

Control individual fields:

```ts
f.text(255).access({
	read: true,
	create: ({ session }) => session?.user.role === "admin",
	update: false, // immutable after creation
});

// Or at collection level:
collection("users").access({
	fields: {
		email: { update: ({ session }) => session?.user.role === "admin" },
		password: { read: false },
	},
});
```

### Default Behavior

When no access rule is set, the default is **`!!session`** — require an authenticated session. This is secure-by-default.

### System Mode

Server-side code (hooks, jobs, seeds) runs in **system mode** (`accessMode: "system"`) by default, which **bypasses all access control**. HTTP requests run in **user mode** (`accessMode: "user"`).

```ts
// Force user mode in server code:
await collections.posts.find({}, { accessMode: "user", session });

// Force system mode explicitly (the default for server code):
await collections.posts.find({}, { accessMode: "system" });
```

---

## 11. Routes

Custom HTTP routes for APIs that don't fit the collection CRUD pattern.

```ts
import { route } from "questpie";

// JSON route with schema validation
export default route()
	.post()
	.schema(
		z.object({
			name: z.string(),
			email: z.string().email(),
		}),
	)
	.outputSchema(
		z.object({
			success: z.boolean(),
			id: z.string(),
		}),
	)
	.access(({ session }) => !!session)
	.handler(async ({ input, db, collections, session }) => {
		const user = await collections.users.create({ ...input });
		return { success: true, id: user.id };
	});
```

### Route Methods

```ts
route()
	.get() // HTTP method
	.post()
	.put()
	.delete()
	.patch()
	.raw() // raw Request/Response (no JSON parsing)
	.schema(zodSchema) // input validation
	.outputSchema(zodSchema) // response type (for OpenAPI)
	.access(rule) // access control
	.handler(fn); // terminal — returns RouteDefinition
```

### File-Path Routing

Route file paths map to URL paths:

```
routes/get-stats.ts           → GET  /api/get-stats
routes/webhooks/stripe.ts     → POST /api/webhooks/stripe
routes/[collection].ts        → /api/:collection (parameterized)
routes/[...path].ts           → /api/* (wildcard)
```

### Raw Routes

For webhooks, file downloads, or custom responses:

```ts
export default route()
	.post()
	.raw()
	.handler(async ({ request }) => {
		const body = await request.text();
		// ... verify webhook signature
		return new Response("OK", { status: 200 });
	});
```

### Built-in Routes (Auto-registered by Core Module)

**Collection routes:**

| Path                           | Method | Purpose                     |
| ------------------------------ | ------ | --------------------------- |
| `[collection]`                 | GET    | Find (list with pagination) |
| `[collection]`                 | POST   | Create                      |
| `[collection]`                 | PATCH  | Update many                 |
| `[collection]/[id]`            | GET    | Find one                    |
| `[collection]/[id]`            | PATCH  | Update                      |
| `[collection]/[id]`            | DELETE | Delete                      |
| `[collection]/count`           | GET    | Count                       |
| `[collection]/delete-many`     | POST   | Delete many                 |
| `[collection]/[id]/versions`   | GET    | List versions               |
| `[collection]/[id]/revert`     | POST   | Revert to version           |
| `[collection]/[id]/transition` | POST   | Workflow transition         |
| `[collection]/[id]/restore`    | POST   | Restore soft-deleted        |
| `[collection]/[id]/audit`      | GET    | Audit log                   |
| `[collection]/upload`          | POST   | File upload                 |
| `[collection]/files/[...key]`  | GET    | Serve file                  |
| `[collection]/schema`          | GET    | Introspected schema         |
| `[collection]/meta`            | GET    | Collection metadata         |

**Global routes:**

| Path                        | Method | Purpose             |
| --------------------------- | ------ | ------------------- |
| `globals/[name]`            | GET    | Get global          |
| `globals/[name]`            | PATCH  | Update global       |
| `globals/[name]/versions`   | GET    | List versions       |
| `globals/[name]/revert`     | POST   | Revert to version   |
| `globals/[name]/transition` | POST   | Workflow transition |
| `globals/[name]/schema`     | GET    | Introspected schema |
| `globals/[name]/meta`       | GET    | Global metadata     |
| `globals/[name]/audit`      | GET    | Audit log           |

**System routes:**

| Path                          | Method | Purpose             |
| ----------------------------- | ------ | ------------------- |
| `auth/[...path]`              | \*     | Better Auth handler |
| `search`                      | POST   | Full-text search    |
| `search/reindex/[collection]` | POST   | Reindex collection  |
| `realtime`                    | POST   | SSE subscriptions   |
| `storage/files/[...key]`      | GET    | Legacy file serving |
| `health`                      | GET    | Health check        |

---

## 12. Services

Services are **injectable singletons or request-scoped factories** available in `AppContext`.

```ts
import { service } from "questpie";

export const analyticsService = service()
	.lifecycle("singleton") // created once at startup
	.create(({ app }) => {
		return new AnalyticsClient(app.config.analytics);
	})
	.dispose((client) => {
		client.close();
	});
```

### Namespaces

```ts
// Top-level (ctx.analytics)
service().namespace(null).create(...)

// Nested (ctx.services.analytics)
service().create(...)  // default namespace: "services"

// Custom namespace (ctx.myNamespace.analytics)
service().namespace("myNamespace").create(...)
```

### Lifecycle

| Lifecycle     | When Created              | When Disposed           |
| ------------- | ------------------------- | ----------------------- |
| `"singleton"` | Once at app startup       | At `app.destroy()`      |
| `"request"`   | Per incoming HTTP request | After request completes |

### Using Services in Hooks/Routes

Services in the default namespace are on `ctx.services.*`. Top-level services (e.g., `db`, `auth`, `storage`) are directly on `ctx`:

```ts
// In a hook or route handler:
async ({ db, session, services }) => {
	await services.analytics.track("page_view", { userId: session.user.id });
};
```

---

## 13. Jobs

Background jobs for async processing — retries, scheduling, and queuing.

```ts
import { job } from "questpie";

export default job({
	name: "sendWelcomeEmail",
	schema: z.object({
		userId: z.string(),
		locale: z.string().optional(),
	}),
	options: {
		retryLimit: 3,
		retryDelay: 5, // seconds (not ms!)
		retryBackoff: true, // exponential
	},
	handler: async ({ payload, email, collections }) => {
		const user = await collections.users.findOne({
			where: { id: payload.userId },
		});
		await email.send("welcome", { to: user.email, data: { name: user.name } });
	},
});
```

> **Note:** Job handlers receive `payload` (not `input`). Email handlers receive `input`.

### Dispatching Jobs

```ts
// In any hook, route, or service:
await ctx.queue.sendWelcomeEmail.publish({
	userId: "abc-123",
	locale: "en",
});
```

The queue client exposes jobs as typed properties: `queue[jobName].publish(payload, options?)`. This gives you full type safety on the payload.

### Queue Adapters

| Adapter                   | Use Case                                         |
| ------------------------- | ------------------------------------------------ |
| `pgBossAdapter()`         | PostgreSQL-based (default, great for most cases) |
| `CloudflareQueuesAdapter` | Cloudflare Workers                               |

---

## 14. Email Templates

Email templates define how emails look and what data they accept.

```tsx
import { email } from "questpie";

export default email({
	name: "welcome",
	schema: z.object({
		name: z.string(),
		verifyUrl: z.string().url(),
	}),
	handler: ({ input }) => ({
		subject: `Welcome, ${input.name}!`,
		html: `
      <h1>Welcome to our platform</h1>
      <p>Hi ${input.name}, please verify your email:</p>
      <a href="${input.verifyUrl}">Verify Email</a>
    `,
		text: `Welcome ${input.name}! Verify: ${input.verifyUrl}`,
	}),
});
```

### Sending Emails

```ts
await ctx.email.send("welcome", {
	to: user.email,
	data: { name: user.name, verifyUrl: "https://..." },
});
```

### Email Adapters

| Adapter                       | Description                      |
| ----------------------------- | -------------------------------- |
| `ConsoleAdapter`              | Logs to console (dev)            |
| `SmtpAdapter`                 | SMTP via Nodemailer              |
| `createEtherealSmtpAdapter()` | Auto-generated test SMTP account |

---

## 15. Migrations & Seeds

### Migrations

```ts
import { migration } from "questpie";

export default migration({
	id: "0001_create_categories_table",
	up: async ({ db }) => {
		await db.execute(sql`
      CREATE TABLE categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL
      )
    `);
	},
	down: async ({ db }) => {
		await db.execute(sql`DROP TABLE categories`);
	},
});
```

### Seeds

```ts
import { seed } from "questpie";

export default seed({
	id: "seed-default-categories",
	category: "required", // "required" | "dev" | "test"
	run: async ({ collections, log }) => {
		log("Creating default categories...");
		await collections.categories.create({ name: "Uncategorized" });
		await collections.categories.create({ name: "News" });
	},
	undo: async ({ collections }) => {
		await collections.categories.delete({
			where: { name: { in: ["Uncategorized", "News"] } },
		});
	},
});
```

### CLI Commands

```bash
bun questpie migrate              # Run pending migrations
bun questpie migrate:generate     # Generate migration from schema diff
bun questpie migrate:status       # Show status
bun questpie migrate:down         # Rollback
bun questpie migrate:reset        # Rollback all
bun questpie migrate:fresh        # Reset + re-run all

bun questpie seed                 # Run pending seeds
bun questpie seed:status          # Show status
bun questpie seed:undo            # Undo seeds
bun questpie seed:reset           # Reset tracking

bun questpie push                 # Push schema directly (dev only, like drizzle-kit push)
```

### Auto-Migration/Seed

In `questpie.config.ts`:

```ts
runtimeConfig({
	autoMigrate: true, // run migrations on app startup
	autoSeed: true, // run seeds on startup
	// autoSeed: "required",        // or only specific categories ("required" | "dev" | "test")
});
```

---

## 16. Uploads & Storage

### Upload Collections

Any collection can become a file storage collection:

```ts
collection("assets")
	.upload({
		visibility: "public", // "public" | "private"
		maxSize: 10_000_000, // 10MB
		allowedTypes: ["image/*", "application/pdf"],
	})
	.fields(({ f }) => ({
		alt: f.text(255),
		caption: f.textarea(),
	}));
```

`.upload()` automatically adds system fields: `key`, `filename`, `mimeType`, `size`, `visibility`, plus HTTP routes for upload and file serving.

### Upload Field

Reference files from other collections:

```ts
f.upload(); // single file → FK to "assets"
f.upload({ to: "documents" }); // custom upload collection
f.upload().multiple(); // multiple files (JSONB array)
f.upload({
	// many-to-many via junction
	through: "post_images",
	mimeTypes: ["image/*"],
	maxSize: 5_000_000,
});
```

### Storage Adapters

```ts
// Local filesystem (default)
runtimeConfig({
	storage: { location: "./uploads", basePath: "/api" },
});

// S3-compatible (R2, Minio, etc.)
runtimeConfig({
	storage: { driver: myS3Driver },
});

// Auto-detected from env vars:
// QUESTPIE_STORAGE_ENDPOINT, QUESTPIE_STORAGE_BUCKET, QUESTPIE_STORAGE_REGION,
// QUESTPIE_STORAGE_ACCESS_KEY, QUESTPIE_STORAGE_SECRET_KEY
```

### Programmatic Upload

```ts
const file = await collections.assets.upload(
	{ stream: readableStream, filename: "photo.jpg", mimeType: "image/jpeg" },
	{ accessMode: "system" },
	{ alt: "A nice photo" }, // additional field data
);
```

---

## 17. Versioning & Workflow

### Enabling Versioning

```ts
collection("pages").options({
	versioning: true, // basic versioning (max 50 versions)
	// or:
	versioning: {
		maxVersions: 100,
		workflow: true, // enables stage transitions
	},
	// or with custom stages:
	versioning: {
		workflow: {
			initialStage: "draft",
			stages: {
				draft: { transitions: ["review"] },
				review: { transitions: ["published", "draft"] },
				published: { transitions: ["draft"] },
			},
		},
	},
});
```

### What Versioning Gives You

- A `{collection}_versions` table stores every change
- `findVersions({ id })` → list all versions of a record
- `revertToVersion({ id, version: 3 })` → restore a previous version
- `transitionStage({ id, stage: "published" })` → move between workflow stages
- `beforeTransition` / `afterTransition` hooks

### API Usage

```ts
// Server-side
const versions = await collections.pages.findVersions({ id: "abc" });
await collections.pages.revertToVersion({ id: "abc", version: 5 });
await collections.pages.transitionStage({ id: "abc", stage: "published" });

// Client-side
const versions = await client.collections.pages.findVersions({ id: "abc" });
await client.collections.pages.transitionStage({
	id: "abc",
	stage: "published",
});
```

---

## 18. Search

Full-text search across collections.

### Configuring Search

```ts
collection("posts").searchable({
	content: (record) => record.title,
	// or multiple fields:
	content: (record) => `${record.title} ${record.excerpt}`,
});
```

### Search Adapters

| Adapter                 | Description                          |
| ----------------------- | ------------------------------------ |
| `PostgresSearchAdapter` | pg_trgm + FTS (default, zero-config) |
| `PgVectorSearchAdapter` | Hybrid semantic search with pgvector |

### API Usage

```ts
// Client-side
const results = await client.search.search({
	query: "typescript guide",
	collections: ["posts", "pages"],
	limit: 10,
});

// Server-side
const results = await ctx.search.search({
	query: "typescript guide",
	collections: ["posts"],
});
```

### Reindexing

```ts
// Via API
await client.collections.posts.reindex();

// Via job
await ctx.queue.indexRecords.publish({ collection: "posts" });
```

---

## 19. Realtime

Server-sent events for live data updates.

### How It Works

1. Every create/update/delete writes a change event to `questpie_realtime_log` (outbox pattern)
2. An adapter (pg_notify or Redis Streams) notifies connected clients
3. Clients subscribe via SSE to specific resources

### Client-Side Usage

```ts
// With TanStack Query (automatic)
const { data } = useQuery(qp.collections.posts.find({}, { realtime: true }));

// Manual subscription
const unsub = client.realtime.subscribe(
	{ resourceType: "collection", resource: "posts" },
	(event) => {
		console.log("Change:", event.operation, event.recordId);
	},
);
```

### Realtime Adapters

```ts
import { pgNotifyAdapter } from "questpie";

runtimeConfig({
	realtime: {
		adapter: pgNotifyAdapter({ connectionString: process.env.DATABASE_URL }),
	},
});
```

| Adapter                 | Description                  |
| ----------------------- | ---------------------------- |
| _None_ (default)        | Polling-based (every 2s)     |
| `pgNotifyAdapter()`     | PostgreSQL LISTEN/NOTIFY     |
| `redisStreamsAdapter()` | Redis Streams consumer group |

---

## 20. i18n / Localization

### Content Localization

Mark fields as localized — stored per-locale in a separate i18n table:

```ts
f.text(255).localized(); // stored in {collection}_i18n table
```

### Configuring Locales

```ts
// config/app.ts
appConfig({
	locale: {
		locales: ["en", "sk", "de"],
		defaultLocale: "en",
		fallback: { sk: "en", de: "en" },
	},
});
```

### Querying Localized Content

```ts
// Server
const post = await collections.posts.findOne({
	where: { id: "abc" },
	locale: "sk",
	localeFallback: true, // fall back to "en" if "sk" not available
});

// Client
const post = await client.collections.posts.findOne({
	where: { id: "abc" },
	locale: "sk",
});
```

### Admin UI Translations

```ts
// config/admin.ts
adminConfig({
	locale: {
		locales: ["en", "sk"],
		defaultLocale: "en",
	},
});

// messages/en.ts — admin UI string translations
export default {
	"admin.posts.title": "Blog Posts",
	"admin.posts.description": "Manage blog posts",
};
```

### Translation Function

Available in all hooks, routes, and services as `ctx.t(key, params?, locale?)`:

```ts
const msg = ctx.t("billing.invoice_sent", { amount: 100 }, "en");
```

---

## 21. AppContext — What's Available Everywhere

Every hook, route handler, job handler, and service receives `AppContext`. This is the **core runtime interface** — learn it once, use it everywhere.

```ts
interface AppContext {
	app: Questpie; // the app instance
	db: DrizzleClient; // Drizzle ORM (may be a transaction in hooks)
	session: { user; session } | null; // current auth session
	collections: { [name]: CollectionAPI }; // typed CRUD for all collections
	globals: { [name]: GlobalAPI }; // typed CRUD for all globals
	queue: QueueClient; // dispatch background jobs
	email: MailerService; // send emails
	storage: DriveManager; // file storage operations
	kv: KVService; // key-value store
	logger: LoggerService; // structured logging
	search: SearchService; // full-text search
	realtime: RealtimeService; // publish realtime events
	t: (key, params?, locale?) => string; // i18n translator
	services: Record<string, unknown>; // user-defined services
}
```

### Where AppContext Is Available

| Context          | How to Access                                                    |
| ---------------- | ---------------------------------------------------------------- |
| Collection hooks | First argument: `async (ctx) => { ... }`                         |
| Route handlers   | Destructure: `async ({ db, session, collections }) => { ... }`   |
| Job handlers     | Destructure: `async ({ payload, queue, email }) => { ... }`      |
| Email templates  | Destructure: `async ({ input, collections }) => { ... }`         |
| Access rules     | Destructure: `({ session, data }) => boolean`                    |
| Seeds            | `async ({ collections, log }) => { ... }`                        |
| Services         | `create: ({ app }) => ...` (app instance only, not full context) |

### Getting Context Programmatically

```ts
import { getContext, tryGetContext } from "questpie";

const ctx = getContext(); // throws if outside a request scope
const ctx = tryGetContext(); // returns null if outside scope

// Create a fresh context manually:
const ctx = await app.createContext({
	session: null,
	locale: "en",
	accessMode: "system",
});
```

---

## 22. Server-Side CRUD API

Access collections and globals programmatically from anywhere in server code.

### Collections

```ts
// via AppContext (in hooks, routes, jobs)
const posts = await ctx.collections.posts.find({
	where: { status: "published" },
	orderBy: { createdAt: "desc" },
	limit: 10,
	with: { author: true, tags: true },
});

// via app instance (in startup scripts, CLI)
const post = await app.collections.posts.findOne({
	where: { slug: "hello-world" },
	columns: { title: true, content: true },
});
```

### Collection Methods

```ts
// READ
.find(options?)                    → PaginatedResult<T>
.findOne(options?)                 → T | null
.count(options?)                   → number

// WRITE
.create(data)                      → T
.updateById({ id, data })          → T
.update({ where, data })           → T[]       (batch)
.deleteById({ id })                → { success }
.delete({ where })                 → { success, count }  (batch)
.restoreById({ id })               → T          (soft-delete)

// VERSIONING
.findVersions({ id })              → VersionRecord[]
.revertToVersion({ id, version })  → T
.transitionStage({ id, stage })    → T

// UPLOAD (when .upload() is configured)
.upload(file, ctx?, additionalData?)     → T
.uploadMany(files, ctx?, additionalData?) → T[]
```

### FindOptions

```ts
{
  where: {
    status: "published",             // equality
    title: { like: "%guide%" },      // LIKE
    createdAt: { gte: new Date() },  // comparison operators
    OR: [{ a: 1 }, { b: 2 }],       // logical
    AND: [...],
    NOT: { ... },
  },
  columns: { title: true, content: true },   // select specific fields
  with: {                                     // include relations
    author: true,
    tags: { columns: { name: true } },
  },
  orderBy: { createdAt: "desc" },
  limit: 10,
  offset: 0,
  search: "keyword",                          // full-text ILIKE on title
  locale: "en",
  localeFallback: true,
  includeDeleted: false,                      // include soft-deleted
  stage: "published",                         // versioning stage filter
  extras: { wordCount: sql`...` },            // computed columns
}
```

### PaginatedResult

```ts
{
  docs: T[],
  totalDocs: number,
  limit: number,
  totalPages: number,
  page: number,
  pagingCounter: number,
  hasPrevPage: boolean,
  hasNextPage: boolean,
  prevPage: number | null,
  nextPage: number | null,
}
```

### Globals

```ts
const settings = await ctx.globals.siteSettings.get({
	with: { logo: true },
	locale: "en",
});

await ctx.globals.siteSettings.update({
	siteName: "New Name",
	description: "Updated description",
});
```

### Global Methods

```ts
.get(options?)                       → T | null
.update(data, ctx?, options?)        → T
.findVersions(options?)              → VersionRecord[]
.revertToVersion({ version })        → T
.transitionStage({ stage })          → T
```

### Request Context

All CRUD methods accept an optional second argument for context:

```ts
await collections.posts.find(
	{ where: { status: "published" } },
	{
		session: mySession, // override session
		locale: "sk", // override locale
		accessMode: "user", // force access checks (default: "system")
		stage: "published", // version stage filter
		db: transactionClient, // run inside a transaction
	},
);
```

---

## 23. Client SDK

The typed client for calling the QuestPie API from frontend or external code.

### Setup

```ts
import { createClient } from "questpie/client";
import type { App } from "@/questpie/server/app";

export const client = createClient<App>({
	baseURL: "http://localhost:3000",
	basePath: "/api", // matches your catch-all route
});
```

### Collections

```ts
// Read
const posts = await client.collections.posts.find({
	where: { status: "published" },
	limit: 10,
	with: { author: true },
});

const post = await client.collections.posts.findOne({
	where: { id: "abc" },
});

const count = await client.collections.posts.count({
	where: { status: "draft" },
});

// Write
const newPost = await client.collections.posts.create({
	title: "Hello",
	content: "...",
});

const updated = await client.collections.posts.update({
	id: "abc",
	data: { title: "Updated" },
});

await client.collections.posts.delete({ id: "abc" });

// Upload
const asset = await client.collections.assets.upload(fileObject);

// Versioning
const versions = await client.collections.posts.findVersions({ id: "abc" });
await client.collections.posts.revertToVersion({ id: "abc", version: 3 });
await client.collections.posts.transitionStage({
	id: "abc",
	stage: "published",
});

// Schema introspection
const schema = await client.collections.posts.schema();
```

### Globals

```ts
const settings = await client.globals.siteSettings.get();
await client.globals.siteSettings.update({ siteName: "New Name" });
```

### Custom Routes

```ts
// Route: routes/admin/stats.ts → key "admin/stats"
const stats = await client.routes.admin.stats({ period: "week" });
```

### Search

```ts
const results = await client.search.search({
	query: "typescript",
	collections: ["posts"],
	limit: 10,
});
```

### Locale

```ts
client.setLocale("sk"); // set for all subsequent requests
const locale = client.getLocale();
```

### Error Handling

```ts
import { QuestpieClientError } from "questpie/client";

try {
	await client.collections.posts.create({ title: "" });
} catch (err) {
	if (err instanceof QuestpieClientError) {
		err.status; // HTTP status
		err.code; // error code
		err.fieldErrors; // per-field validation errors
		err.getFieldError("title"); // specific field error
		err.isCode("VALIDATION_ERROR"); // check error type
	}
}
```

---

## 24. TanStack Query Integration

Pre-built query/mutation options for `@tanstack/react-query`.

### Setup

```ts
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { client } from "@/lib/client";
import type { App } from "@/questpie/server/app";

export const qp = createQuestpieQueryOptions<App>(client, {
	keyPrefix: ["questpie"],
});
```

### Queries

```ts
import { useQuery, useMutation } from "@tanstack/react-query";

// List
const { data: posts } = useQuery(
	qp.collections.posts.find({
		where: { status: "published" },
		limit: 10,
	}),
);

// Single
const { data: post } = useQuery(
	qp.collections.posts.findOne({ where: { id: postId } }),
);

// Count
const { data: count } = useQuery(
	qp.collections.posts.count({ where: { status: "draft" } }),
);

// Global
const { data: settings } = useQuery(qp.globals.siteSettings.get());

// With realtime (auto-refetches on server changes)
const { data: posts } = useQuery(
	qp.collections.posts.find({}, { realtime: true }),
);
```

### Mutations

```ts
const createPost = useMutation(qp.collections.posts.create());
const updatePost = useMutation(qp.collections.posts.update());
const deletePost = useMutation(qp.collections.posts.delete());

// Usage
createPost.mutate({ title: "New Post", content: "..." });
updatePost.mutate({ id: "abc", data: { title: "Updated" } });
deletePost.mutate({ id: "abc" });
```

### Custom Routes

```ts
// Query (GET routes)
const { data } = useQuery(qp.routes.admin.stats.query({ period: "week" }));

// Mutation (POST/PATCH/DELETE routes)
const action = useMutation(qp.routes.webhooks.stripe.mutation());
```

### Query Keys

Consistent key structure for cache invalidation:

```ts
["questpie", "collections", "posts", "find", locale, stage, options][
	("questpie", "globals", "siteSettings", "get", locale, stage, options)
][("questpie", "routes", "admin", "stats", "query", locale, options)];
```

---

## 25. Admin Panel

The admin panel is a **server-driven React SPA**. The server declares what should be shown (via `.admin()`, `.list()`, `.form()`), and the client renders it.

### Enabling the Admin

```ts
// modules.ts
import { adminModule } from "@questpie/admin/server";
export default [adminModule] as const;

// config/admin.ts
import { adminConfig } from "#questpie/factories";

export default adminConfig({
	branding: {
		name: "My CMS",
	},
	locale: {
		locales: ["en", "sk"],
		defaultLocale: "en",
	},
	sidebar: ({ s, c }) => ({
		sections: [
			s.section({
				id: "content",
				title: "Content",
				icon: c.icon({ name: "ph:article" }),
			}),
			s.section({
				id: "settings",
				title: "Settings",
				icon: c.icon({ name: "ph:gear" }),
			}),
		],
		items: [
			s.item({ sectionId: "content", type: "collection", collection: "posts" }),
			s.item({ sectionId: "content", type: "collection", collection: "pages" }),
			s.item({
				sectionId: "settings",
				type: "global",
				global: "site_settings",
			}),
			s.item({
				sectionId: "settings",
				type: "link",
				label: "API Docs",
				href: "/api/docs",
				external: true,
			}),
			s.item({ sectionId: "settings", type: "divider" }),
		],
	}),
	dashboard: ({ d, c, a }) => ({
		title: "Dashboard",
		sections: [
			d.section({ id: "overview", label: "Overview", columns: 4 }),
			d.section({ id: "recent", label: "Recent Activity", columns: 2 }),
		],
		items: [
			d.stats({
				sectionId: "overview",
				id: "total-posts",
				label: "Total Posts",
				collection: "posts",
				span: 1,
			}),
			d.recentItems({
				sectionId: "recent",
				id: "recent-posts",
				label: "Recent Posts",
				collection: "posts",
				dateField: "createdAt",
				limit: 5,
				span: 1,
			}),
		],
		actions: [a.create({ collection: "posts", label: "New Post" })],
	}),
});
```

### AdminState

The admin client receives a pre-built `AdminState` object containing all registered fields, views, pages, widgets, blocks, components, and translations. This is generated at `.generated/client.ts` by codegen.

### How the Admin Renders a Collection

1. Client navigates to `/admin/collections/posts`
2. Fetches `GET /api/posts/schema` → `CollectionSchema` (fields, access, options, admin config)
3. Looks up the configured **list view** (`collection-table`) from AdminState
4. Renders the view component with schema-driven columns, filters, actions
5. On row click → navigates to `/admin/collections/posts/{id}`
6. Fetches `GET /api/posts/{id}` + schema
7. Looks up the configured **form view** (`collection-form`)
8. Renders form fields using the field registry (each field type maps to a React component)

---

## 26. Admin Builder Extensions

These methods are added to `CollectionBuilder`, `GlobalBuilder`, and `Field` by the admin plugin's codegen.

### `.admin()` — Collection/Global Metadata

```ts
collection("posts").admin(({ c }) => ({
	label: "Blog Posts", // display name
	description: "Manage blog posts", // subtitle
	icon: c.icon({ name: "ph:article" }),
	hidden: false, // hide from sidebar
	group: "content", // sidebar group key
	order: 1, // order within group
	audit: true, // enable audit logging
}));
```

### `.list()` — List View Config

```ts
collection("posts").list(({ v, f, a }) =>
	v.collectionTable({
		columns: [f.title, f.status, f.author, f.createdAt],
		defaultSort: { field: f.createdAt, direction: "desc" },
		searchable: [f.title, f.content],
		filterable: [f.status, f.author],
		actions: {
			header: { primary: [a.create()], secondary: [a.custom("export")] },
			row: [a.delete(), a.duplicate()],
			bulk: [a.deleteMany(), a.custom("bulkPublish")],
		},
	}),
);
```

### `.form()` — Form View Config

```ts
collection("posts").form(({ v, f }) =>
	v.collectionForm({
		fields: [
			f.title,
			f.slug,
			{
				type: "section",
				label: "Content",
				layout: "stack",
				fields: [f.content, f.excerpt],
			},
			{
				type: "tabs",
				tabs: [
					{
						id: "media",
						label: "Media",
						icon: { type: "icon", props: { name: "ph:image" } },
						fields: [f.cover, f.gallery],
					},
					{ id: "seo", label: "SEO", fields: [f.metaTitle, f.metaDescription] },
				],
			},
		],
		sidebar: {
			position: "right",
			fields: [f.status, f.author, f.tags, f.publishedAt],
		},
	}),
);
```

#### Form Layout Primitives

| Type                                                             | Description                              |
| ---------------------------------------------------------------- | ---------------------------------------- |
| `string` (e.g. `f.title`)                                        | Bare field — renders with default config |
| `{ field, hidden?, readOnly?, disabled?, compute?, className? }` | Field with overrides                     |
| `{ type: "section", label?, layout?, columns?, fields: [...] }`  | Visual grouping                          |
| `{ type: "tabs", tabs: [{ id, label, icon?, fields }] }`         | Tabbed layout                            |

#### Reactive Field Config

Fields can be dynamically hidden, read-only, disabled, or computed based on other field values:

```ts
{
  field: f.publishedAt,
  hidden: ({ data }) => data.status !== "published",
  readOnly: { deps: [f.status], handler: ({ data }) => data.status === "archived" },
  compute: {
    deps: [f.firstName, f.lastName],
    handler: ({ data }) => `${data.firstName} ${data.lastName}`,
    debounce: 300,
  },
}
```

### `.preview()` — Live Preview

```ts
collection("posts").preview({
	enabled: true,
	url: ({ record, locale }) => `/blog/${record.slug}?locale=${locale}`,
	position: "right", // "left" | "right" | "bottom"
	defaultWidth: 50, // percentage
});
```

### `.actions()` — Server Actions

```ts
collection("posts").actions(({ a, c, f }) => ({
	builtin: [a.create(), a.save(), a.delete()],
	custom: [
		a.action({
			id: "publish",
			label: "Publish",
			icon: c.icon({ name: "ph:rocket" }),
			scope: "single", // "single" | "bulk" | "header" | "row"
			confirmation: {
				title: "Publish this post?",
				destructive: false,
			},
			handler: async ({ record, collections }) => {
				await collections.posts.updateById({
					id: record.id,
					data: { status: "published" },
				});
				return { type: "success", toast: { message: "Published!" } };
			},
		}),
		a.bulkAction({
			id: "bulkArchive",
			label: "Archive Selected",
			form: {
				title: "Archive Posts",
				fields: {
					reason: f.textarea().label("Reason").required(),
				},
			},
			handler: async ({ records, formData, collections }) => {
				for (const record of records) {
					await collections.posts.updateById({
						id: record.id,
						data: { status: "archived", archiveReason: formData.reason },
					});
				}
				return {
					type: "success",
					toast: { message: `Archived ${records.length} posts` },
				};
			},
		}),
	],
}));
```

#### Action Result Types

```ts
{ type: "success", toast?: { message, title? }, effects?: { closeModal?, invalidate?, redirect? } }
{ type: "error", toast?: { message, title? }, errors?: Record<string, string> }
{ type: "redirect", url: string, external?: boolean }
{ type: "download", file: { name, content, mimeType } }
```

### Field-Level `.admin()` and `.form()`

```ts
f.text().admin({
  type: "password",                   // override the input type
  autoComplete: "new-password",
  placeholder: "Enter password",
})

f.object({ ... }).form(({ f }) => ({
  fields: [
    { type: "section", label: "Address", layout: "grid", columns: 2,
      fields: [f.street, f.city, f.zip, f.country] },
  ],
}))
```

---

## 27. Admin Fields, Views, Widgets, Blocks, Components

### Fields (Client-Side)

Each server field type maps to a React component in the admin:

| Field Type     | Component           | Cell (in tables) |
| -------------- | ------------------- | ---------------- |
| `text`         | `TextField`         | `TextCell`       |
| `textarea`     | `TextareaField`     | `TextCell`       |
| `number`       | `NumberField`       | primitive        |
| `email`        | `EmailField`        | primitive        |
| `url`          | `UrlField`          | primitive        |
| `boolean`      | `BooleanField`      | primitive        |
| `date`         | `DateField`         | primitive        |
| `datetime`     | `DatetimeField`     | primitive        |
| `time`         | `TimeField`         | primitive        |
| `select`       | `SelectField`       | primitive        |
| `relation`     | `RelationField`     | `RelationCell`   |
| `upload`       | `UploadField`       | `UploadCell`     |
| `richText`     | `RichTextField`     | —                |
| `json`         | `JsonField`         | —                |
| `object`       | `ObjectField`       | `ObjectCell`     |
| `array`        | `ArrayField`        | `ArrayCell`      |
| `blocks`       | `BlocksField`       | `BlocksCell`     |
| `assetPreview` | `AssetPreviewField` | —                |

Register custom field types:

```ts
import { field } from "@questpie/admin/client";

export const colorPicker = field("color", {
	component: lazy(() => import("./color-picker-field")),
	cell: lazy(() => import("./color-picker-cell")),
});
```

### Views

| View               | Kind   | Description                              |
| ------------------ | ------ | ---------------------------------------- |
| `collection-table` | `list` | Default table view for collection lists  |
| `collection-form`  | `form` | Default form view for collection editing |
| `global-form`      | `form` | Default form view for globals            |

Register custom views:

```ts
import { view } from "@questpie/admin/client";

export const kanbanView = view("kanban-board", {
	kind: "list",
	component: lazy(() => import("./kanban-view")),
});
```

### Widgets (Dashboard)

8 built-in widget types (use via `d.stats()`, `d.chart()`, etc. in dashboard config):

| Widget Type    | Dashboard Builder       | Description                                     |
| -------------- | ----------------------- | ----------------------------------------------- |
| `stats`        | `d.stats({...})`        | Single number with optional trend indicator     |
| `value`        | `d.value({...})`        | Custom formatted value with subtitle/footer     |
| `chart`        | `d.chart({...})`        | Line, bar, area, or pie chart                   |
| `recentItems`  | `d.recentItems({...})`  | List of recent records from a collection        |
| `quickActions` | `d.quickActions({...})` | Grid of action buttons                          |
| `table`        | `d.table({...})`        | Mini data table                                 |
| `timeline`     | `d.timeline({...})`     | Chronological event list                        |
| `progress`     | `d.progress({...})`     | Progress bar toward a target                    |
| `custom`       | `d.custom({...})`       | Fully custom widget component (user-registered) |

### Blocks (Content Builder)

Blocks are user-defined content components for the page builder (`f.blocks()` field). Defined on the server, rendered on both admin and frontend.

```ts
// Server: blocks/hero.ts
import { block } from "#questpie/factories";

export const hero = block("hero")
	.fields(({ f }) => ({
		heading: f.text(255).required(),
		subheading: f.textarea(),
		image: f.upload(),
		cta: f.object({
			label: f.text(100),
			url: f.url(),
		}),
	}))
	.admin(({ c }) => ({
		label: "Hero Banner",
		icon: c.icon({ name: "ph:image" }),
		category: { label: "Sections" },
	}))
	.form(({ f }) => ({
		fields: [f.heading, f.subheading, f.image, f.cta],
	}))
	.allowChildren(0)
	.prefetch(async ({ values, db }) => {
		// Pre-load data for frontend rendering
		return { imageUrl: values.image ? await getSignedUrl(values.image) : null };
	});
```

```tsx
// Client: admin/blocks/hero.tsx
export default function HeroBlock({ values, data }: BlockRendererProps) {
	return (
		<section className="hero">
			<h1>{values.heading}</h1>
			<p>{values.subheading}</p>
			{data?.imageUrl && <img src={data.imageUrl} />}
		</section>
	);
}
```

Block content is stored as:

```ts
{
  _tree: [{ id: "abc", type: "hero", children: [] }],
  _values: { abc: { heading: "Welcome", subheading: "..." } },
  _data: { abc: { imageUrl: "https://..." } },  // server-prefetched
}
```

### Components (Server-Driven)

Components bridge serializable server config to React rendering. Two built-in:

| Name    | Description                       |
| ------- | --------------------------------- |
| `icon`  | Renders Iconify icons (fast path) |
| `badge` | Renders a styled badge            |

Used everywhere in config via `ComponentReference`:

```ts
// In .admin(), sidebar, dashboard, actions:
{ type: "icon", props: { name: "ph:users" } }
{ type: "badge", props: { label: "New", variant: "success" } }
```

Or via the `c` proxy in callbacks:

```ts
.admin(({ c }) => ({
  icon: c.icon({ name: "ph:users" }),
}))
```

Register custom components:

```ts
import { component } from "@questpie/admin/client";

export const statusIndicator = component("statusIndicator", {
	component: lazy(() => import("./status-indicator")),
});
```

---

## 28. Codegen & the .generated/ Directory

Codegen is the bridge between your file conventions and the runtime. It runs via `questpie generate` (one-shot) or `questpie dev` (watch mode).

### What Gets Generated

| File                             | Contents                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `server/.generated/index.ts`     | `createApp()` call, `App` type, `AppCollections`, `AppGlobals`, module augmentations |
| `server/.generated/factories.ts` | Typed `collection()`, `global()`, `block()`, config factories with plugin extensions |
| `admin/.generated/client.ts`     | Admin client config object for `<AdminLayoutProvider>`                               |

### When to Regenerate

- **File added or removed** in a convention directory → regenerate
- **File content changed** → no regeneration needed (codegen uses `typeof import(...)` which is stable)
- `questpie dev` watches for add/remove only

### The Process

```
1. Read questpie.config.ts → runtime config
2. Read modules.ts → extract codegen plugins from each module
3. Build target graph: core plugin + extracted plugins → merged category declarations
4. Discover files: scan convention directories
5. Generate templates:
   - index.ts (createApp + type augmentation)
   - factories.ts (typed builders with extensions)
   - client.ts (admin config)
```

### For NPM Module Packages

Module packages use `packageConfig()` instead of `runtimeConfig()`:

```ts
// questpie.config.ts in a module package
import { packageConfig } from "questpie/cli";

export default packageConfig({
	modulesDir: "src/server/modules",
	modulePrefix: "questpie",
	plugins: [adminPlugin()],
});
```

This generates `.generated/module.ts` for each module subdirectory (no `createApp`, no runtime config — just a typed module object).

---

## 29. Adapters & Infrastructure

QuestPie uses pluggable adapters for all infrastructure concerns.

### Database

Always **PostgreSQL** via **Drizzle ORM**. Two client options:

- `Bun.SQL` (production — native Bun PostgreSQL driver)
- `PGlite` (testing — in-process SQLite-compatible Postgres)

### HTTP Adapters

The core provides `createFetchHandler()` which works with any framework that supports the `fetch` API:

```ts
// Standalone (Bun.serve)
Bun.serve({ fetch: createFetchHandler(app) });

// TanStack Start / Vinxi
export default createFetchHandler(app, { basePath: "/api" });

// Hono
import { questpieMiddleware } from "@questpie/hono/server";
app.use("/api/*", questpieMiddleware(questpieApp));

// Elysia
import { questpieElysia } from "@questpie/elysia/server";
app.use(questpieElysia(questpieApp));

// Next.js
import { questpieNextRouteHandlers } from "@questpie/next";
export const { GET, POST, PUT, PATCH, DELETE } =
	questpieNextRouteHandlers(questpieApp);
```

### Storage Adapters

| Config                        | Driver                         |
| ----------------------------- | ------------------------------ |
| Default                       | `FSDriver` (local `./uploads`) |
| `QUESTPIE_STORAGE_*` env vars | S3-compatible (auto-detected)  |
| `{ driver: customDriver }`    | Any FlyDrive `DriverContract`  |

### Queue Adapters

| Adapter                   | Description                          |
| ------------------------- | ------------------------------------ |
| `pgBossAdapter()`         | PostgreSQL-based job queue (pg-boss) |
| `CloudflareQueuesAdapter` | Cloudflare Workers Queues            |

### Search Adapters

| Adapter                 | Description                       |
| ----------------------- | --------------------------------- |
| `PostgresSearchAdapter` | pg_trgm + full-text search        |
| `PgVectorSearchAdapter` | Hybrid semantic search (pgvector) |

### Realtime Adapters

| Adapter                 | Description              |
| ----------------------- | ------------------------ |
| Default                 | Polling (2s interval)    |
| `pgNotifyAdapter()`     | PostgreSQL LISTEN/NOTIFY |
| `redisStreamsAdapter()` | Redis Streams            |

### KV Adapters

| Adapter            | Description          |
| ------------------ | -------------------- |
| `MemoryKVAdapter`  | In-process (default) |
| `IORedisKVAdapter` | Redis-backed         |

### Email Adapters

| Adapter                       | Description                 |
| ----------------------------- | --------------------------- |
| `ConsoleAdapter`              | Logs to console             |
| `SmtpAdapter`                 | Nodemailer SMTP             |
| `createEtherealSmtpAdapter()` | Auto-generated test account |

### Logger

| Adapter | Description                         |
| ------- | ----------------------------------- |
| Default | Pino-based structured logging       |
| Custom  | Implement `LoggerAdapter` interface |

---

## 30. TypeScript Type Augmentation

QuestPie uses `declare global { namespace Questpie { ... } }` for type extensions. Codegen fills these in automatically.

### Augmentation Points

```ts
declare global {
	namespace Questpie {
		interface AppContext {} // Add custom context keys
		interface Registry {} // Type catalog (collections, globals, routes, etc.)
		interface ViewsRegistry {} // Admin view autocomplete
		interface ComponentsRegistry {} // Admin component autocomplete
		interface FieldTypesMap {} // Field factory autocomplete (f.*)
	}
}
```

### What Codegen Produces

The generated `index.ts` augments these interfaces so that:

- `ctx.collections.posts` is fully typed with the actual field shapes
- `ctx.globals.siteSettings` is fully typed
- `f.text()`, `f.relation()`, etc. have full autocomplete
- `ctx.queue.jobName.publish(payload)` validates payload types
- `client.collections.posts.find()` returns typed results

### Plugin Config Augmentation

Plugins extend the module config type via `declare module "questpie"`:

```ts
declare module "questpie" {
	interface AppStateConfig {
		admin?: AdminConfigInput;
		openapi?: OpenApiConfig;
	}
}
```

---

## 31. CLI Reference

```bash
bun questpie <command> [options]
```

| Command                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `generate`               | Run codegen (one-shot)                              |
| `dev`                    | Watch mode codegen (re-runs on file add/remove)     |
| `push`                   | Push schema to DB (dev only, like drizzle-kit push) |
| `migrate` / `migrate:up` | Run pending migrations                              |
| `migrate:generate`       | Generate migration from schema diff                 |
| `migrate:down`           | Rollback migrations                                 |
| `migrate:status`         | Show migration status                               |
| `migrate:reset`          | Rollback all                                        |
| `migrate:fresh`          | Reset + re-run all migrations                       |
| `seed`                   | Run pending seeds                                   |
| `seed:undo`              | Undo executed seeds                                 |
| `seed:status`            | Show seed status                                    |
| `seed:reset`             | Reset seed tracking                                 |
| `add <type> <name>`      | Scaffold new entity file                            |
| `add --list`             | Show available entity types                         |

Global options: `-c, --config <path>` (default: `questpie.config.ts`)

### Scaffolding

```bash
bun questpie add collection blog-posts
bun questpie add global site-settings
bun questpie add route get-stats
bun questpie add job send-newsletter
bun questpie add service analytics
bun questpie add email welcome
bun questpie add seed default-data
bun questpie add migration add-categories
bun questpie add block hero            # with admin plugin
```

---

## 32. How It All Connects — The Big Picture

### Data Flow: Server Startup

```
questpie.config.ts          "Infrastructure: here's my DB, storage, email..."
        ↓
modules.ts                  "Packages: use admin, openapi, audit..."
        ↓
codegen                     Scans collections/, globals/, routes/, etc.
        ↓
.generated/index.ts         Bundles everything into createApp() call
        ↓
createApp()
  ├─ resolveModules()       Flatten module tree depth-first
  ├─ mergeModuleIntoState() Merge all contributions (later wins)
  ├─ new Questpie(config)   Create the app instance
  └─ _initServices()        Boot: db, auth, storage, queue, email, kv, logger, search, realtime
        ↓
createFetchHandler(app)     Compile all routes into a trie-based dispatcher
        ↓
Ready to serve requests
```

### Data Flow: HTTP Request

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

### Data Flow: Admin Panel

```
Browser loads /admin
  ↓
AdminLayoutProvider receives pre-built AdminState
  (fields, views, pages, widgets, blocks, components, translations)
  ↓
Sidebar rendered from adminConfig.sidebar
  ↓
User clicks "Posts"
  ↓
Fetch GET /api/posts/schema → CollectionSchema (server-driven UI config)
  ↓
Look up "collection-table" view in AdminState.views
  ↓
Render table with schema-driven columns, filters, sort, actions
  ↓
User clicks a row
  ↓
Fetch GET /api/posts/{id}
  ↓
Look up "collection-form" view in AdminState.views
  ↓
Render form with schema-driven field layout, sections, tabs, sidebar
  ↓
Each field renders via AdminState.fields[fieldType].component
  ↓
Validation via buildZodFromIntrospection() (client-side Zod)
  ↓
Submit PATCH /api/posts/{id}
  ↓
Server hooks + access control + DB write + realtime event
```

### Data Flow: Module Contribution

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
User adds to modules.ts:
  import { billingModule } from "@my-org/billing-module";
  export default [adminModule, billingModule] as const;
        ↓
questpie generate            → merges into .generated/index.ts
        ↓
At runtime: billingModule's collections, routes, jobs are part of the app
```

### The Primitive Hierarchy

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
  ├── appConfig()        App-level config (locale, access, hooks)
  ├── authConfig()       Auth config (Better Auth options)
  └── adminConfig()      Admin config (sidebar, dashboard, branding)  ← admin plugin
```

### Environment Variables

| Variable                      | Purpose               | Default                 |
| ----------------------------- | --------------------- | ----------------------- |
| `DATABASE_URL`                | PostgreSQL connection | (required)              |
| `APP_URL`                     | Application URL       | `http://localhost:3000` |
| `BETTER_AUTH_SECRET`          | Auth signing secret   | —                       |
| `QUESTPIE_DB`                 | Cloud DB override     | —                       |
| `QUESTPIE_APP_URL`            | Cloud URL override    | —                       |
| `QUESTPIE_SECRET`             | Cloud secret override | —                       |
| `QUESTPIE_STORAGE_ENDPOINT`   | S3 endpoint           | —                       |
| `QUESTPIE_STORAGE_BUCKET`     | S3 bucket             | —                       |
| `QUESTPIE_STORAGE_REGION`     | S3 region             | —                       |
| `QUESTPIE_STORAGE_ACCESS_KEY` | S3 access key         | —                       |
| `QUESTPIE_STORAGE_SECRET_KEY` | S3 secret key         | —                       |

---

## Quick Reference: All Primitives

| Primitive      | Factory                              | Import From                | Purpose                      |
| -------------- | ------------------------------------ | -------------------------- | ---------------------------- |
| Collection     | `collection(name)`                   | `#questpie/factories`      | Data table + CRUD            |
| Global         | `global(name)`                       | `#questpie/factories`      | Singleton document           |
| Field          | `f.text()`, `f.number()`, ...        | `.fields()` callback       | Column definition            |
| Field Type     | `fieldType(name, config)`            | `questpie`                 | Custom field type            |
| Route          | `route()`                            | `questpie`                 | HTTP endpoint                |
| Service        | `service()`                          | `questpie`                 | Injectable dependency        |
| Job            | `job({...})`                         | `questpie`                 | Background task              |
| Email          | `email({...})`                       | `questpie`                 | Email template               |
| Block          | `block(name)`                        | `#questpie/factories`      | Content builder block        |
| Migration      | `migration({...})`                   | `questpie`                 | DB schema change             |
| Seed           | `seed({...})`                        | `questpie`                 | DB seed data                 |
| Module         | `module({...})`                      | `questpie`                 | Packaging unit               |
| Runtime Config | `runtimeConfig({...})`               | `questpie`                 | Infrastructure config        |
| App Config     | `appConfig({...})`                   | `questpie`                 | Locale, access, hooks        |
| Auth Config    | `authConfig({...})`                  | `questpie`                 | Better Auth options          |
| Admin Config   | `adminConfig({...})`                 | `#questpie/factories`      | Sidebar, dashboard, branding |
| View           | `view(name, {kind, component})`      | `@questpie/admin/client`   | Admin view component         |
| Widget         | `widget(name, {component})`          | `@questpie/admin/client`   | Dashboard widget             |
| Component      | `component(name, {component})`       | `@questpie/admin/client`   | Server-driven component      |
| Client         | `createClient<App>(config)`          | `questpie/client`          | Frontend API client          |
| Query Options  | `createQuestpieQueryOptions(client)` | `@questpie/tanstack-query` | TanStack Query integration   |

> **Import rule of thumb:** Only `collection()`, `global()`, `block()`, and `adminConfig()` come from `#questpie/factories` (they need codegen-generated types). Everything else comes from `"questpie"` directly.
