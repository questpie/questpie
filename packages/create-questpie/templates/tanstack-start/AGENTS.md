# AGENTS.md

Source-of-truth guidance for AI agents working in this QUESTPIE CMS project.

> **Docs for LLMs**: https://questpie.com/llms.txt (sitemap), https://questpie.com/llms-full.txt (full content)

## Project Overview

- **Framework**: TanStack Start (React) + Vite + Nitro (Bun preset)
- **CMS**: QUESTPIE — headless CMS framework with config-driven admin UI
- **Database**: PostgreSQL (via Drizzle ORM)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Auth**: Better Auth (email/password)
- **Package manager**: Bun
- **Validation**: Zod v4 (NOT v3)

## Documentation & Resources

When you need more context about QUESTPIE APIs, consult these resources in order:

1. **LLMs full docs**: https://questpie.com/llms-full.txt — complete documentation in a single LLM-optimized file
2. **Online docs**: https://questpie.com/docs — browsable documentation
3. **Local API docs**: http://localhost:3000/api/cms/docs — Scalar UI (available when dev server is running)

Key documentation pages:

| Topic                      | URL                                                              |
| -------------------------- | ---------------------------------------------------------------- |
| Getting Started            | https://questpie.com/docs/getting-started                        |
| Project Structure          | https://questpie.com/docs/getting-started/project-structure      |
| Your First CMS             | https://questpie.com/docs/getting-started/your-first-cms         |
| Architecture Principles    | https://questpie.com/docs/mentality                              |
| Field Builder              | https://questpie.com/docs/server/field-builder                   |
| Field Types Reference      | https://questpie.com/docs/server/field-types                     |
| Collections                | https://questpie.com/docs/server/collections                     |
| Globals                    | https://questpie.com/docs/server/globals                         |
| Relations                  | https://questpie.com/docs/server/relations                       |
| RPC (Server Functions)     | https://questpie.com/docs/server/rpc                             |
| Hooks & Lifecycle          | https://questpie.com/docs/server/hooks-and-lifecycle             |
| Access Control             | https://questpie.com/docs/server/access-control                  |
| Reactive Fields            | https://questpie.com/docs/server/reactive-fields                 |
| Validation                 | https://questpie.com/docs/server/validation                      |
| Localization               | https://questpie.com/docs/server/localization                    |
| Modules & Extensions       | https://questpie.com/docs/server/modules-and-extensions          |
| Admin Architecture         | https://questpie.com/docs/admin                                  |
| Client Builder (qa)        | https://questpie.com/docs/admin/client-builder-qa                |
| Component Registry         | https://questpie.com/docs/admin/component-registry               |
| View Registry              | https://questpie.com/docs/admin/view-registry-list-and-form      |
| Actions System             | https://questpie.com/docs/admin/actions-system                   |
| Blocks System              | https://questpie.com/docs/admin/blocks-system                    |
| Dashboard & Sidebar        | https://questpie.com/docs/admin/dashboard-sidebar-branding       |
| TanStack Query Integration | https://questpie.com/docs/client/tanstack-query                  |
| OpenAPI                    | https://questpie.com/docs/client/openapi                         |
| Authentication             | https://questpie.com/docs/infrastructure/authentication          |
| Database & Migrations      | https://questpie.com/docs/infrastructure/database-and-migrations |
| Queue & Jobs               | https://questpie.com/docs/infrastructure/queue-and-jobs          |
| Storage                    | https://questpie.com/docs/infrastructure/storage                 |
| Email                      | https://questpie.com/docs/infrastructure/email                   |
| Realtime                   | https://questpie.com/docs/infrastructure/realtime                |

## Project Structure

```
src/
  questpie/
    server/              ← WHAT: data contracts and behavior
      builder.ts         ← Shared builder: qb = q.use(adminModule)
      app.ts             ← Composition root (collections, globals, auth, build)
      rpc.ts             ← RPC router instance: r = rpc()
      sidebar.ts         ← Admin sidebar configuration
      dashboard.ts       ← Admin dashboard configuration
      collections/       ← One file per collection (*.collection.ts)
      globals/           ← One file per global (*.global.ts)
      functions/         ← RPC functions
      jobs/              ← Background job definitions
      blocks.ts          ← Block definitions (if using blocks)
    admin/               ← HOW: UI rendering concerns
      builder.ts         ← Client builder: qa<AppCMS>().use(adminModule)
      hooks.ts           ← Typed hooks via createTypedHooks<AppCMS>()
      blocks/            ← Block renderers (if using blocks)
  lib/
    env.ts               ← Type-safe env vars (@t3-oss/env-core + Zod)
    cms-client.ts        ← CMS client instance
  routes/
    api/cms/$.ts         ← CMS catch-all handler (REST + OpenAPI + auth)
  migrations/            ← Database migrations (generated by CLI)
```

## Architecture Rules

### Server-First Split

| Directory          | Responsibility                    | Defines                            |
| ------------------ | --------------------------------- | ---------------------------------- |
| `questpie/server/` | **WHAT** — contracts and behavior | Schema, access, hooks, RPC, jobs   |
| `questpie/admin/`  | **HOW** — rendering concerns      | Branding, locale, custom renderers |
| `routes/`          | **Mounting** — HTTP wiring        | Route handlers, no business logic  |

### File Naming Conventions

- Collections: `*.collection.ts` (e.g., `posts.collection.ts`)
- Globals: `*.global.ts` (e.g., `site-settings.global.ts`)
- RPC functions: `*.function.ts` or grouped in `functions/` directory
- Background jobs: grouped in `jobs/` directory

### Key Files

- **`src/questpie/server/builder.ts`** — Creates the shared builder `qb = q.use(adminModule)` used by all collections/globals.
- **`src/questpie/server/app.ts`** — Composition root. Registers collections, globals, sidebar, dashboard, auth, and calls `.build()`. Also exports `appRpc`, `AppCMS`, `AppRpc`.
- **`src/questpie/server/rpc.ts`** — Creates the RPC builder `r = rpc()` used by all server functions.
- **`src/questpie/admin/builder.ts`** — Creates the client builder `admin = qa<AppCMS>().use(adminModule)`.
- **`src/lib/env.ts`** — Type-safe env variables via `@t3-oss/env-core`. Add new env vars here with Zod schemas.
- **`questpie.config.ts`** — CLI config (migration directory, app reference).
- **`src/routes/api/cms/$.ts`** — CMS API catch-all handler. Serves REST + OpenAPI docs at `/api/cms/docs`.

## How To Write Code

### Creating a Collection

Keep the entire builder chain in one file — single source of truth per entity:

```ts
// src/questpie/server/collections/posts.collection.ts
import { qb } from "@/questpie/server/builder";

export const posts = qb
  .collection("posts")
  .fields((f) => ({
    title: f.text({ label: "Title", required: true }),
    slug: f.slug({ label: "Slug", from: "title" }),
    content: f.richText({ label: "Content" }),
    published: f.boolean({ label: "Published", default: false }),
    category: f.select({ label: "Category", options: ["news", "blog", "tutorial"] }),
    author: f.relation({ label: "Author", to: "users" }),
    image: f.upload({ label: "Cover Image" }),
  }))
  .title(({ f }) => f.title)
  .admin(({ c }) => ({
    label: "Posts",
    icon: c.icon("ph:article"),
  }))
  .access({
    read: true,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => session?.user?.role === "admin",
  })
  .hooks({
    beforeCreate: [async ({ data, ctx }) => { /* ... */ return data; }],
  })
  .list(({ v }) => v.table({}))
  .form(({ v, f }) =>
    v.form({
      sidebar: { position: "right", fields: [f.slug, f.published, f.category] },
      fields: [f.title, f.content, f.author, f.image],
    })
  );
```

Then register it:
1. Export from `src/questpie/server/collections/index.ts`
2. Add to `.collections({ ..., posts })` in `app.ts`
3. Add to sidebar in `sidebar.ts`
4. Run `bun questpie migrate:create` to generate migration

### Available Field Types

`text`, `number`, `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `relation`, `upload`, `richText`, `json`, `slug`, `email`, `url`, `password`, `color`, `textarea`

### Creating a Global

```ts
// src/questpie/server/globals/site-settings.global.ts
import { qb } from "@/questpie/server/builder";

export const siteSettings = qb
  .global("site_settings")
  .fields((f) => ({
    siteName: f.text({ label: "Site Name", required: true }),
    description: f.textarea({ label: "Description" }),
    logo: f.upload({ label: "Logo" }),
    maintenanceMode: f.boolean({ label: "Maintenance Mode", default: false }),
  }))
  .admin(({ c }) => ({ label: "Site Settings", icon: c.icon("ph:gear") }))
  .form(({ v, f }) => v.form({
    fields: [f.siteName, f.description, f.logo, f.maintenanceMode],
  }));
```

Then register it:
1. Export from `src/questpie/server/globals/index.ts`
2. Add to `.globals({ ..., siteSettings })` in `app.ts`
3. Add to sidebar in `sidebar.ts`
4. Run `bun questpie migrate:create`

### Creating an RPC Function (End-to-End Type-Safe)

QUESTPIE provides standalone RPC — `cms` and `appRpc` are two independent instances, no circular dependency.

**How typing works:**
```ts
// rpc.ts — standalone RPC builder
import { rpc } from "questpie";
export const r = rpc();
```

```ts
// app.ts — imports r (runtime), exports cms and appRpc separately
import { r } from "./rpc.js";

export const cms = qb.collections({...}).build({...});
export const appRpc = r.router({ ...adminRpc, myFn });

export type AppCMS = typeof cms;
export type AppRpc = typeof appRpc;
```

**Step 1 — Define a function:**

```ts
// src/questpie/server/functions/get-stats.function.ts
import { r } from "@/questpie/server/rpc";
import { z } from "zod";

export const getStats = r.fn({
  schema: z.object({
    period: z.enum(["day", "week", "month"]),
  }),
  handler: async ({ input, app }) => {
    // input: { period: "day" | "week" | "month" } — typed from Zod schema
    // app: fully typed CMS instance with autocomplete
    const count = await app.api.collections.posts.count({});
    return { totalPosts: count, period: input.period };
  },
});
```

**Step 2 — Register in `app.ts`:**

```ts
import { getStats } from "./functions/get-stats.function.js";

export const appRpc = r.router({
  ...adminRpc,
  getStats,
});
```

**Step 3 — Call from client (fully typed):**

```ts
import { client } from "@/lib/cms-client";

const result = await client.rpc.getStats({ period: "week" });
// result: { totalPosts: number, period: string }
```

**With access control:**

```ts
export const adminOnlyFn = r.fn({
  access: ({ session }) => session?.user?.role === "admin",
  schema: z.object({ ... }),
  handler: async ({ input, app }) => { ... },
});
```

**With TanStack Query:**

```ts
import { useQuery, useMutation } from "@tanstack/react-query";

const { data } = useQuery({
  queryKey: ["stats", period],
  queryFn: () => client.rpc.getStats({ period }),
});

const mutation = useMutation({
  mutationFn: (input) => client.rpc.createSomething(input),
});
```

**Type flow:**

```
rpc()                                → r.fn() handlers get typed `app`
  ↓
r.fn({ schema, handler })           → RpcProcedureDefinition<TInput, TOutput>
  ↓
r.router({ myFn })                  → AppRpc type (preserves all function types)
  ↓
createClient<AppCMS, AppRpc>(...)    → client.rpc is fully typed
  ↓
client.rpc.myFn(input)              → Input: compile-time + runtime (Zod) validation
                                     → Output: inferred from handler return type
```

### Blocks (Page Builder)

Blocks are content building units for page builders and rich content areas.

**Simple block (no data fetching):**

```ts
// src/questpie/server/blocks.ts
import { qb } from "./builder";

const heroBlock = qb
  .block("hero")
  .admin(({ c }) => ({
    label: "Hero Section",
    icon: c.icon("ph:image"),
    category: { label: "Sections", icon: c.icon("ph:layout"), order: 1 },
  }))
  .fields((f) => ({
    title: f.text({ label: "Title", required: true }),
    subtitle: f.textarea({ label: "Subtitle" }),
    backgroundImage: f.upload({ label: "Background Image" }),
    ctaText: f.text({ label: "CTA Text" }),
    ctaLink: f.text({ label: "CTA Link" }),
  }))
  .prefetch({ with: { backgroundImage: true } }); // expand upload to full URL

export const blocks = { hero: heroBlock };
```

**Block with dynamic data fetching (prefetch):**

```ts
const teamBlock = qb
  .block("team")
  .admin(({ c }) => ({
    label: "Team",
    icon: c.icon("ph:users"),
    category: { label: "Sections", icon: c.icon("ph:layout"), order: 1 },
  }))
  .fields((f) => ({
    title: f.text({ label: "Title" }),
    limit: f.number({ label: "Number to Show", default: 4 }),
  }))
  .prefetch(async ({ values, ctx }) => {
    const res = await ctx.app.api.collections.members.find({
      limit: values.limit || 4,
      where: { isActive: true },
      with: { avatar: true },
    });
    return { members: res.docs };
  });
```

**Register blocks in `app.ts`:**

```ts
import { blocks } from "./blocks";

export const cms = qb
  .collections({ ... })
  .blocks(blocks) // ← register blocks
  .build({ ... });
```

**Use blocks in a collection's richText field:**

```ts
content: f.richText({
  label: "Content",
  blocks: [heroBlock, teamBlock],
})
```

#### Blocks & Circular Dependencies (BaseCMS Pattern)

When blocks use `.prefetch()` with functional handlers that need typed access to `ctx.app` (e.g., `ctx.app.api.collections.posts.find(...)`), you hit a circular dependency:

- `app.ts` imports `blocks.ts` (to register blocks)
- `blocks.ts` wants to import `AppCMS` from `app.ts` (for typed prefetch)
- **Circular!**

**The workaround: split into `baseCms` and final `cms`:**

```ts
// app.ts
import { blocks } from "./blocks";

// Step 1: Build everything EXCEPT blocks
export const baseCms = qb
  .collections({ posts, pages })
  .globals({ siteSettings })
  .auth({ ... });

// Step 2: Export the base type — blocks import THIS (not AppCMS)
export type BaseCMS = (typeof baseCms)["$inferCms"];

// Step 3: Add blocks and build
export const cms = baseCms.blocks(blocks).build({ ... });

export type AppCMS = typeof cms;
```

```ts
// blocks.ts — imports BaseCMS (not AppCMS) to avoid circular dependency
import { typedApp, type Where } from "questpie";
import type { BaseCMS } from "./app";

const latestPostsBlock = qb
  .block("latest-posts")
  .fields((f) => ({
    count: f.number({ label: "Number of Posts", default: 3 }),
  }))
  .prefetch(async ({ values, ctx }) => {
    // Use typedApp<BaseCMS> for typed access without circular import
    const cms = typedApp<BaseCMS>(ctx.app);
    const res = await cms.api.collections.posts.find({
      limit: values.count || 3,
      where: { published: true },
      orderBy: { createdAt: "desc" },
    });
    return { posts: res.docs };
  });
```

**Key points:**
- `BaseCMS` has the same collections/globals as `AppCMS` — blocks just aren't part of the type yet
- `typedApp<BaseCMS>(ctx.app)` casts the untyped `ctx.app` to the typed CMS API
- This is a known limitation; we're working on a more ergonomic solution
- If your blocks only use declarative prefetch (`{ with: { field: true } }`), you don't need this pattern at all — it's only needed for functional prefetch that calls `ctx.app.api.*`

### Reactive Fields

Fields support reactive behaviors in `meta.admin`:

- **`hidden`**: Conditionally hide — `({ data }: { data: Record<string, any> }) => !data.isPublished`
- **`readOnly`**: Make read-only based on conditions
- **`disabled`**: Disable conditionally
- **`compute`**: Auto-compute values — `{ handler, deps, debounce }`

All reactive handlers run **server-side** with access to `ctx.db`, `ctx.user`, `ctx.req`.

```ts
fields: (f) => ({
  country: f.relation({ to: "countries", label: "Country" }),
  city: f.relation({
    to: "cities",
    label: "City",
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
  status: f.select({
    label: "Status",
    options: ["draft", "published", "archived"],
  }),
  publishedAt: f.dateTime({
    label: "Published At",
    meta: {
      admin: {
        hidden: ({ data }: { data: Record<string, any> }) => data.status !== "published",
      },
    },
  }),
})
```

### Admin Configuration (Client-Side)

```ts
// src/questpie/admin/builder.ts
import { adminModule, qa } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export const admin = qa<AppCMS>().use(adminModule);
```

```ts
// src/questpie/admin/hooks.ts
import { createTypedHooks } from "@questpie/admin/client";
import type { AppCMS } from "../server/cms";

export const {
  useCollectionList, useCollectionCount, useCollectionItem,
  useCollectionCreate, useCollectionUpdate, useCollectionDelete,
  useGlobal, useGlobalUpdate,
} = createTypedHooks<AppCMS>();
```

### CMS Route Handler

```ts
// src/routes/api/cms/$.ts
import { createFetchHandler } from "questpie";
import { withOpenApi } from "@questpie/openapi";
import { appRpc, cms } from "~/questpie/server/cms";

const handler = withOpenApi(
  createFetchHandler(cms, { basePath: "/api/cms", rpc: appRpc }),
  { cms, rpc: appRpc, basePath: "/api/cms", info: { title: "My API", version: "1.0.0" } },
);
```

### Icons

Use `@iconify/react` with Phosphor icon set:
- Prefix: `ph:` (e.g., `ph:house`, `ph:article`, `ph:gear`)
- Weight variants: `-bold`, `-fill`, `-duotone`, `-light`, `-thin`
- Regular weight = no suffix (default)
- Naming: PascalCase → kebab-case (e.g., `CaretDown` → `ph:caret-down`)
- In server/admin config, use `c.icon("ph:icon-name")`

## Environment Variables

Type-safe via `@t3-oss/env-core` in `src/lib/env.ts`. All env vars must be:
1. Declared with Zod schema in `env.ts`
2. Accessed via `env.VAR_NAME` (not `process.env.VAR_NAME`)

Required:
- `DATABASE_URL` — PostgreSQL connection string

Optional (with defaults):
- `APP_URL` — Application URL (default: `http://localhost:3000`)
- `BETTER_AUTH_SECRET` — Auth secret key
- `MAIL_ADAPTER` — `console` or `smtp`

## Commands

```bash
bun dev                     # Start dev server
bun build                   # Build for production
bun start                   # Start production server
bun questpie migrate        # Run database migrations
bun questpie migrate:create # Create new migration
docker compose up -d        # Start PostgreSQL
```

## Critical Dependencies

Always use these exact versions — check `package.json` before upgrading:

| Package          | Version | Notes                |
| ---------------- | ------- | -------------------- |
| `zod`            | `^4.x`  | **v4 ONLY** — not v3 |
| `drizzle-orm`    | `beta`  | Specific beta build  |
| `react`          | `^19.x` | React 19             |
| `tailwindcss`    | `^4.x`  | Tailwind CSS v4      |
| `@base-ui/react` | `^1.x`  | NOT @radix-ui        |

## Anti-Patterns

- **Schema rules in client code** — Validation, access control, and hooks belong on the server.
- **Splitting a collection across files** — Keep the full `.collection().fields().admin().list().form()` chain in one file.
- **Business logic in route handlers** — Routes only mount handlers. Logic goes in RPC functions, hooks, or jobs.
- **Hardcoding view components** — Use the registry pattern for custom views.
- **Using `process.env` directly** — Use the `env` object from `src/lib/env.ts`.
- **Using Zod v3 API** — This project uses Zod v4. Use `z.object()` etc. from `zod` (v4).
- **Using `asChild` prop** — This project uses `@base-ui/react`, not Radix. Use `render` prop instead.
- **Using Radix UI or Lucide icons** — Use `@base-ui/react` and `@iconify/react` with `ph:` prefix.
- **Adding UI config to database schema** — Admin UI config is UI-only, defined in builder chain.
- **Importing `AppCMS` in `blocks.ts`** — Use `BaseCMS` pattern to avoid circular dependencies (see Blocks section).
