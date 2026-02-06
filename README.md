# QUESTPIE

**Type-safe, modular backend framework for modern TypeScript applications**

A batteries-optional CMS engine built with Drizzle ORM. Opt into authentication, storage, background jobs, email, and realtime as needed.

## Why QUESTPIE?

- **Type-Safe End-to-End** - Full TypeScript from schema to API
- **Batteries Optional** - Auth, storage, queue, email, realtime - opt in as needed
- **Framework Agnostic** - Adapters for Hono, Elysia, Next.js, TanStack Start
- **Your Code, Your Control** - Runs in your codebase, not a hosted service
- **Modular Architecture** - Compose reusable modules, extend with plugins

## Packages

| Package                                                 | Description                                           |
| ------------------------------------------------------- | ----------------------------------------------------- |
| [`questpie`](./packages/questpie)                       | Core CMS engine with collections, globals, and hooks  |
| [`@questpie/admin`](./packages/admin)                   | Config-driven admin UI (React + Tailwind v4 + shadcn) |
| [`@questpie/hono`](./packages/hono)                     | Hono framework adapter with unified client            |
| [`@questpie/elysia`](./packages/elysia)                 | Elysia framework adapter with Eden Treaty support     |
| [`@questpie/next`](./packages/next)                     | Next.js App Router adapter                            |
| [`@questpie/tanstack-query`](./packages/tanstack-query) | TanStack Query integration with query options factory |

## Quick Start

### Requirements

- [Bun](https://bun.sh) 1.0+ (recommended) or Node.js 18+
- PostgreSQL 15+

### Installation

```bash
# Core package
bun add questpie drizzle-orm@beta zod

# Choose your framework adapter
bun add @questpie/hono hono        # Hono
bun add @questpie/elysia elysia    # Elysia
bun add @questpie/next next        # Next.js

# Optional: Admin UI
bun add @questpie/admin @questpie/tanstack-query @tanstack/react-query
```

### Define Your First Collection

```typescript
// src/collections/posts.ts
import { q } from "questpie";
import { varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const posts = q
  .collection("posts")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    content: text("content"),
    isPublished: boolean("is_published").default(false).notNull(),
    publishedAt: timestamp("published_at", { mode: "date" }),
  })
  .title(({ table }) => table.title);
```

### Configure the CMS

```typescript
// src/app.ts
import { q, starterModule } from "questpie";
import { posts } from "./collections/posts";

export const app = q({ name: "my-app" })
  // Include starter module for auth collections and file uploads
  .use(starterModule)
  // Add your collections
  .collections({ posts })
  // Build with runtime config
  .build({
    db: { url: process.env.DATABASE_URL! },
  });

export type App = typeof app;
```

### Connect to Your Framework

**Hono:**

```typescript
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";
import { app } from "./app";

const server = new Hono();
server.route("/api", questpieHono(app));

export default { port: 3000, fetch: server.fetch };
```

**Elysia:**

```typescript
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia";
import { app } from "./app";

const server = new Elysia().use(questpieElysia(app)).listen(3000);

export type AppServer = typeof server;
```

**Next.js:**

```typescript
// app/api/cms/[...path]/route.ts
import { questpieNextRouteHandlers } from "@questpie/next";
import { app } from "@/app";

export const { GET, POST, PUT, PATCH, DELETE } = questpieNextRouteHandlers(
  app,
  {
    basePath: "/api/cms",
  },
);

export const dynamic = "force-dynamic";
```

### Run Migrations

```bash
bun questpie migrate:generate  # Generate migrations from schema
bun questpie migrate:up        # Apply pending migrations
```

## The starterModule

The `starterModule` provides common functionality out of the box:

```typescript
import { q, starterModule } from "questpie";

const app = q({ name: "my-app" })
  .use(starterModule)  // Includes:
  // - Auth collections (users, sessions, accounts, verifications, apikeys)
  // - Assets collection with file upload support
  // - Core auth options (Better Auth)
  .build({ ... });
```

If you don't need auth or file uploads, simply omit `.use(starterModule)` for a minimal setup.

## Core Concepts

### CRUD Operations

```typescript
// Create
const post = await app.api.collections.posts.create({
  title: "Hello World",
  slug: "hello-world",
});

// Find many (paginated)
const { docs, totalDocs } = await app.api.collections.posts.find({
  where: { isPublished: true },
  orderBy: { publishedAt: "desc" },
  limit: 10,
});

// Find one
const post = await app.api.collections.posts.findOne({
  where: { slug: "hello-world" },
  with: { author: true },
});

// Update
await app.api.collections.posts.updateById({
  id: post.id,
  data: { title: "Updated Title" },
});

// Delete
await app.api.collections.posts.deleteById({ id: post.id });
```

### File Uploads

```typescript
import { q, starterModule } from "questpie";

const app = q({ name: "my-app" })
  .use(starterModule)
  .build({
    db: { url: process.env.DATABASE_URL! },
    storage: { location: "./uploads" },
  });

// Upload via API: POST /cms/assets/upload
// Or programmatically:
const asset = await app.api.collections.assets.upload(file, context);
```

### Custom Upload Collections

```typescript
import { q } from "questpie";
import { varchar } from "drizzle-orm/pg-core";

const media = q
  .collection("media")
  .fields({
    alt: varchar("alt", { length: 500 }),
    folder: varchar("folder", { length: 255 }),
  })
  .upload({
    visibility: "public",
    maxSize: 10_000_000, // 10MB
    allowedTypes: ["image/*", "application/pdf"],
  });

// Upload via API: POST /cms/media/upload
// Serve files: GET /cms/media/files/:key
```

### Authentication

```typescript
import { q, starterModule } from "questpie";
import { organization, twoFactor } from "better-auth/plugins";

const app = q({ name: "my-app" })
  .use(starterModule)  // Required for auth collections
  .auth({
    emailAndPassword: { enabled: true },
    plugins: [organization(), twoFactor()],
  })
  .build({ ... });

// TypeScript knows available methods
await app.auth.api.signIn.email({ email, password });
await app.auth.api.createOrganization({ name: "Acme" });
```

### Background Jobs

```typescript
import { q, starterModule, pgBossAdapter } from "questpie";
import { z } from "zod";

const sendEmail = q.job({
  name: "send-email",
  schema: z.object({ userId: z.string() }),
  handler: async ({ data }) => {
    console.log(`Sending email to ${data.userId}`);
  },
});

const app = q({ name: "my-app" })
  .use(starterModule)
  .jobs({ sendEmail })
  .build({
    db: { url: process.env.DATABASE_URL! },
    queue: {
      adapter: pgBossAdapter({ connectionString: process.env.DATABASE_URL! }),
    },
  });

// Publish job
await app.queue.sendEmail.publish({ userId: "123" });
```

### Modular Composition

Create reusable modules:

```typescript
// blog-module.ts
import { q } from "questpie";

export const blogModule = q({ name: "blog" })
  .collections({
    posts: q.collection("posts").fields({ ... }),
    categories: q.collection("categories").fields({ ... }),
  });

// app.ts
import { q, starterModule } from "questpie";
import { blogModule } from "./blog-module";

const app = q({ name: "my-app" })
  .use(starterModule)
  .use(blogModule)
  .build({ ... });
```

## Admin UI

The `@questpie/admin` package provides a config-driven admin interface using the `qa()` builder pattern:

```typescript
// src/admin/builder.ts
import { qa, adminModule } from "@questpie/admin/client";
import type { App } from "./server/app";

export const qab = qa<App>().use(adminModule).toNamespace();
```

```typescript
// src/admin/collections/posts.ts
import { qab } from "../builder";

export const postsAdmin = qab
  .collection("posts")
  .meta({ label: "Blog Posts", icon: FileTextIcon })
  .fields(({ r }) => ({
    title: r.text({ label: "Title", maxLength: 200 }),
    content: r.richText({ label: "Content" }),
    status: r.select({
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
  }))
  .list(({ v, f }) => v.table({ columns: [f.title, f.status] }))
  .form(({ v, f }) =>
    v.form({
      sections: [
        { title: "Content", fields: [f.title, f.content] },
        { title: "Publishing", fields: [f.status] },
      ],
    }),
  );
```

```tsx
// Mount in React
import { Admin, AdminLayoutProvider } from "@questpie/admin/client";

const adminInstance = Admin.from(admin);

function AdminLayout() {
  return (
    <AdminLayoutProvider
      admin={adminInstance}
      client={cmsClient}
      queryClient={queryClient}
      LinkComponent={Link}
      basePath="/admin"
    >
      <Outlet />
    </AdminLayoutProvider>
  );
}
```

## CLI Reference

```bash
bun questpie migrate:generate  # Generate migrations from schema
bun questpie migrate:up        # Apply pending migrations
bun questpie migrate:down      # Rollback last batch
bun questpie migrate:status    # Show migration status
bun questpie migrate:reset     # Rollback all migrations
bun questpie migrate:fresh     # Reset + run all migrations
```

## Framework Adapters

| Adapter | Package            | Client                                          |
| ------- | ------------------ | ----------------------------------------------- |
| Hono    | `@questpie/hono`   | `createClientFromHono` (CMS CRUD + Hono RPC)    |
| Elysia  | `@questpie/elysia` | `createClientFromEden` (CMS CRUD + Eden Treaty) |
| Next.js | `@questpie/next`   | `createClient` from `questpie/client`           |

## Examples

See the [`examples/`](./examples) directory for complete implementations:

- [`examples/tanstack-barbershop`](./examples/tanstack-barbershop) - TanStack Start + Admin UI

## Development

This is a Turborepo monorepo using Bun as the package manager.

```bash
# Install dependencies
bun install

# Run all packages in dev mode
bun run dev

# Build all packages
bun run build

# Run tests
bun test

# Type check
bun run check-types

# Lint
bun run lint

# Format
bun run format
```

## Documentation

Full documentation is available at the [docs site](./apps/docs) or run locally:

```bash
bun run dev --filter=docs
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) / Node.js
- **Database**: PostgreSQL + [Drizzle ORM](https://orm.drizzle.team)
- **Validation**: [Zod v4](https://zod.dev)
- **Authentication**: [Better Auth](https://better-auth.com)
- **Storage**: [Flydrive](https://flydrive.dev)
- **Queue**: [pg-boss](https://github.com/timgit/pg-boss)
- **Email**: [Nodemailer](https://nodemailer.com) + [React Email](https://react.email)
- **Logging**: [Pino](https://getpino.io)
- **Admin UI**: React + [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)

## License

MIT
