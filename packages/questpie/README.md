# questpie

**Type-safe, modular backend framework for modern TypeScript applications**

A batteries-optional CMS engine built with Drizzle ORM. Opt into authentication, storage, background jobs, email, and realtime as needed.

## Features

- **Type-Safe End-to-End** - Full TypeScript from schema to API
- **Drizzle ORM** - Native field types, relations, and migrations
- **Better Auth** - Authentication with plugins (admin, organization, 2FA, API keys)
- **Flydrive Storage** - S3, R2, GCS, or local filesystem with streaming uploads
- **pg-boss Queue** - Background jobs with retry and scheduling
- **React Email** - Beautiful email templates with Nodemailer
- **Realtime** - PostgreSQL NOTIFY/LISTEN with SSE
- **Access Control** - Granular permissions at operation and field level

## Installation

```bash
bun add questpie drizzle-orm@beta zod

# Choose your framework adapter
bun add @questpie/hono hono        # Hono
bun add @questpie/elysia elysia    # Elysia
bun add @questpie/next next        # Next.js
```

## Quick Start

### 1. Define Collections

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

### 2. Create App Instance

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

### 3. Create Server (Hono Example)

```typescript
// src/server.ts
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";
import { app } from "./app";

const server = new Hono();
server.route("/api", questpieHono(app));

export default { port: 3000, fetch: server.fetch };
```

### 4. Run Migrations

```bash
bun questpie migrate:generate
bun questpie migrate:up
```

## The starterModule

The `starterModule` provides common functionality out of the box:

```typescript
import { q, starterModule } from "questpie";

const app = q({ name: "my-app" })
  .use(starterModule)  // Includes:
  // - Auth collections (users, sessions, accounts, verifications, apikeys)
  // - Assets collection with file upload support
  // - Scheduled realtime outbox cleanup job (hourly, when queue worker runs)
  // - Core auth options (Better Auth)
  .build({ ... });
```

If queue is configured and worker mode is running (`await app.queue.listen()`),
starter module auto-schedules the `questpie.realtime.cleanup` cron job.

Worker bootstrap example:

```typescript
// worker.ts
import { app } from "./app";

await app.queue.listen();
console.log("[worker] queue workers started");
```

If you don't need auth or file uploads, simply omit `.use(starterModule)` for a minimal setup.

## File Uploads

### Using starterModule (Recommended)

```typescript
import { q, starterModule } from "questpie";

const app = q({ name: "my-app" })
  .use(starterModule)
  .build({
    db: { url: process.env.DATABASE_URL! },
    storage: { location: "./uploads" },
  });

// Upload via API
// POST /cms/assets/upload

// Or programmatically
const asset = await app.api.collections.assets.upload(file, context);
console.log(asset.url); // Typed URL
```

### Custom Upload Collections

Add file upload support to any collection:

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

## Authentication

```typescript
import { q, starterModule } from "questpie";

const app = q({ name: "my-app" })
  .use(starterModule)  // Required for auth collections
  .auth({
    emailAndPassword: { enabled: true },
    // Add plugins
    plugins: [organization(), twoFactor()],
  })
  .build({ ... });

// TypeScript knows available methods
await app.auth.api.signIn.email({ email, password });
await app.auth.api.createOrganization({ name: "Acme" });
```

## Background Jobs

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

// Publish job (use registration key, not internal name)
await app.queue.sendEmail.publish({ userId: "123" });
```

Worker bootstrap with automatic graceful shutdown:

```typescript
// worker.ts
import { app } from "./app";

// Registers workers and auto-handles SIGINT/SIGTERM shutdown
await app.queue.listen();

// Optional tuning:
// await app.queue.listen({
//   shutdownSignals: ["SIGINT", "SIGTERM", "SIGQUIT"],
//   shutdownTimeoutMs: 15000,
// });
```

## Modular Composition

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

## CRUD Operations

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

| Adapter | Package            |
| ------- | ------------------ |
| Hono    | `@questpie/hono`   |
| Elysia  | `@questpie/elysia` |
| Next.js | `@questpie/next`   |

## Documentation

Full documentation: [https://questpie.dev/docs](https://questpie.dev/docs)

## License

MIT
