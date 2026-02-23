# AGENTS.md

Source-of-truth guidance for AI agents working in this QUESTPIE project.

> **Docs for LLMs**: https://questpie.com/llms.txt (sitemap), https://questpie.com/llms-full.txt (full content)

## Project Overview

- **Framework**: TanStack Start (React) + Vite + Nitro (Bun preset)
- **QuestPie**: QUESTPIE — application framework framework with config-driven admin UI
- **Database**: PostgreSQL (via Drizzle ORM)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Auth**: Better Auth (email/password)
- **Package manager**: Bun
- **Validation**: Zod v4 (NOT v3)

## Documentation & Resources

When you need more context about QUESTPIE APIs, consult these resources in order:

1. **LLMs full docs**: https://questpie.com/llms-full.txt — complete documentation in a single LLM-optimized file
2. **Online docs**: https://questpie.com/docs — browsable documentation
3. **Local API docs**: http://localhost:3000/api/docs — Scalar UI (available when dev server is running)

Key documentation pages:

| Topic                      | URL                                                              |
| -------------------------- | ---------------------------------------------------------------- |
| Getting Started            | https://questpie.com/docs/getting-started                        |
| Project Structure          | https://questpie.com/docs/getting-started/project-structure      |
| Your First QuestPie             | https://questpie.com/docs/getting-started/your-first-app         |
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
      questpie.config.ts ← App config: config({ modules: [admin()], ... })
      auth.ts            ← Auth config (satisfies AuthConfig)
      .generated/        ← Codegen output (app instance + App type)
        index.ts
      collections/       ← One file per collection (auto-discovered)
      globals/           ← One file per global (auto-discovered)
      functions/         ← Server functions via fn() (auto-discovered)
      jobs/              ← Background job definitions (auto-discovered)
      blocks/            ← Block definitions (auto-discovered)
    admin/               ← HOW: UI rendering concerns
      builder.ts         ← Client builder: qa<App>().use(adminModule)
      hooks.ts           ← Typed hooks via createTypedHooks<App>()
      blocks/            ← Block renderers (if using blocks)
  lib/
    env.ts               ← Type-safe env vars (@t3-oss/env-core + Zod)
    client.ts            ← client instance
  routes/
    api/$.ts             ← QuestPie catch-all handler (REST + OpenAPI + auth)
  migrations/            ← Database migrations (generated by CLI)
```

## Architecture Rules

### Server-First Split

| Directory          | Responsibility                    | Defines                            |
| ------------------ | --------------------------------- | ---------------------------------- |
| `questpie/server/` | **WHAT** — contracts and behavior | Schema, access, hooks, functions, jobs |
| `questpie/admin/`  | **HOW** — rendering concerns      | Branding, locale, custom renderers |
| `routes/`          | **Mounting** — HTTP wiring        | Route handlers, no business logic  |

### File Naming Conventions

- Collections: `*.ts` in `collections/` (e.g., `posts.ts`) — named exports
- Globals: `*.ts` in `globals/` (e.g., `site-settings.ts`) — named exports
- Functions: `*.ts` in `functions/` (e.g., `get-stats.ts`) — default exports
- Jobs: `*.ts` in `jobs/` (e.g., `send-email.ts`) — default exports
- Blocks: `*.ts` in `blocks/` (e.g., `hero.ts`) — named exports

### Key Files

- **`src/questpie/server/questpie.config.ts`** — App config: `config({ modules: [admin()], db, app, ... })`. Sidebar, dashboard, branding are options to `admin()`.
- **`src/questpie/server/auth.ts`** — Auth config (`export default { ... } satisfies AuthConfig`).
- **`src/questpie/server/.generated/index.ts`** — Codegen output. Exports typed `app` instance and `App` type. Run `bunx questpie generate` to regenerate.
- **`src/questpie/admin/builder.ts`** — Creates the client builder `admin = qa<App>().use(adminModule)`.
- **`src/lib/env.ts`** — Type-safe env variables via `@t3-oss/env-core`. Add new env vars here with Zod schemas.
- **`questpie.config.ts`** — CLI config (migration directory, app reference).
- **`src/routes/api/$.ts`** — API catch-all handler. Serves REST + OpenAPI docs at `/api/docs`.

## How To Write Code

### Creating a Collection

Keep the entire builder chain in one file — single source of truth per entity:

```ts
// src/questpie/server/collections/posts.ts
import { collection } from "questpie";

export const posts = collection("posts")
  .fields(({ f }) => ({
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

Then:
1. Run `bunx questpie generate` to regenerate `.generated/index.ts`
2. Run `bun questpie migrate:create` to generate migration

Collections are auto-discovered by codegen — no manual registration needed.

### Available Field Types

`text`, `number`, `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `relation`, `upload`, `richText`, `json`, `slug`, `email`, `url`, `password`, `color`, `textarea`

### Creating a Global

```ts
// src/questpie/server/globals/site-settings.ts
import { global } from "questpie";

export const siteSettings = global("site_settings")
  .fields(({ f }) => ({
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

Then:
1. Run `bunx questpie generate` to regenerate `.generated/index.ts`
2. Run `bun questpie migrate:create`

Globals are auto-discovered by codegen — no manual registration needed.

### Creating a Server Function (End-to-End Type-Safe)

Functions are defined as standalone files in `functions/` and auto-discovered by codegen.

**Step 1 — Define a function:**

```ts
// src/questpie/server/functions/get-stats.ts
import { fn } from "questpie";
import { z } from "zod";

export default fn({
  schema: z.object({
    period: z.enum(["day", "week", "month"]),
  }),
  handler: async ({ input, app }) => {
    // input: { period: "day" | "week" | "month" } — typed from Zod schema
    // app: fully typed app instance with autocomplete
    const count = await app.api.collections.posts.count({});
    return { totalPosts: count, period: input.period };
  },
});
```

**Step 2 — Run codegen:**

```bash
bunx questpie generate
```

The function is auto-discovered and available at `/api/fn/get-stats`.

**With access control:**

```ts
export default fn({
  access: ({ session }) => session?.user?.role === "admin",
  schema: z.object({ ... }),
  handler: async ({ input, app }) => { ... },
});
```

**With TanStack Query:**

```ts
import { useQuery } from "@tanstack/react-query";

const { data } = useQuery({
  queryKey: ["stats", period],
  queryFn: () => client.fn.getStats({ period }),
});
```

### Blocks (Page Builder)

Blocks are content building units for page builders and rich content areas.

**Simple block (no data fetching):**

```ts
// src/questpie/server/blocks/hero.ts
import { block } from "@questpie/admin/server";

export const heroBlock = block("hero")
  .admin(({ c }) => ({
    label: "Hero Section",
    icon: c.icon("ph:image"),
    category: { label: "Sections", icon: c.icon("ph:layout"), order: 1 },
  }))
  .fields(({ f }) => ({
    title: f.text({ label: "Title", required: true }),
    subtitle: f.textarea({ label: "Subtitle" }),
    backgroundImage: f.upload({ label: "Background Image" }),
    ctaText: f.text({ label: "CTA Text" }),
    ctaLink: f.text({ label: "CTA Link" }),
  }))
  .prefetch({ with: { backgroundImage: true } }); // expand upload to full URL
```

**Block with dynamic data fetching (prefetch):**

```ts
const teamBlock = block("team")
  .admin(({ c }) => ({
    label: "Team",
    icon: c.icon("ph:users"),
    category: { label: "Sections", icon: c.icon("ph:layout"), order: 1 },
  }))
  .fields(({ f }) => ({
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

Blocks in `blocks/` are auto-discovered by codegen. No manual registration needed.

**Use blocks in a collection's richText field:**

```ts
content: f.richText({
  label: "Content",
  blocks: [heroBlock, teamBlock],
})
```

#### Blocks & Circular Dependencies

When blocks use `.prefetch()` with functional handlers that need typed `ctx.app`, import the `App` type from `.generated/index.ts`:

```ts
// blocks/latest-posts.ts
import { block } from "@questpie/admin/server";
import { typedApp } from "questpie";
import type { App } from "~/questpie/server/.generated";

export const latestPostsBlock = block("latest-posts")
  .fields(({ f }) => ({
    count: f.number({ label: "Number of Posts", default: 3 }),
  }))
  .prefetch(async ({ values, ctx }) => {
    const app = typedApp<App>(ctx.app);
    const res = await app.api.collections.posts.find({
      limit: values.count || 3,
      where: { published: true },
      orderBy: { createdAt: "desc" },
    });
    return { posts: res.docs };
  });
```

If your blocks only use declarative prefetch (`{ with: { field: true } }`), you don't need this pattern.

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
import type { App } from "@/questpie/server/.generated";

export const admin = qa<App>().use(adminModule);
```

```ts
// src/questpie/admin/hooks.ts
import { createTypedHooks } from "@questpie/admin/client";
import type { App } from "../server/.generated";

export const {
  useCollectionList, useCollectionCount, useCollectionItem,
  useCollectionCreate, useCollectionUpdate, useCollectionDelete,
  useGlobal, useGlobalUpdate,
} = createTypedHooks<App>();
```

### QuestPie Route Handler

```ts
// src/routes/api/$.ts
import { createFetchHandler } from "questpie";
import { withOpenApi } from "@questpie/openapi";
import { app } from "~/questpie/server/.generated";

const handler = withOpenApi(
  createFetchHandler(app, { basePath: "/api" }),
  { app, basePath: "/api", info: { title: "My API", version: "1.0.0" } },
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
- **Business logic in route handlers** — Routes only mount handlers. Logic goes in server functions, hooks, or jobs.
- **Hardcoding view components** — Use the registry pattern for custom views.
- **Using `process.env` directly** — Use the `env` object from `src/lib/env.ts`.
- **Using Zod v3 API** — This project uses Zod v4. Use `z.object()` etc. from `zod` (v4).
- **Using `asChild` prop** — This project uses `@base-ui/react`, not Radix. Use `render` prop instead.
- **Using Radix UI or Lucide icons** — Use `@base-ui/react` and `@iconify/react` with `ph:` prefix.
- **Adding UI config to database schema** — Admin UI config is UI-only, defined in builder chain.
- **Importing `App` in blocks with functional prefetch** — Import `App` from `.generated/index.ts` and use `typedApp<App>()` (see Blocks section).
