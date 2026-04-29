# QUESTPIE

**Type-safe, modular backend framework for modern TypeScript applications**

A batteries-optional backend engine built with Drizzle ORM. Opt into authentication, storage, background jobs, email, and realtime as needed.

<p align="center">
  <img src="https://img.shields.io/github/license/questpie/questpie" />
  <img src="https://img.shields.io/github/stars/questpie/questpie?style=social" />
  <img src="https://img.shields.io/npm/v/questpie" />
  <img src="https://img.shields.io/badge/types-TypeScript-blue" />
  <img src="https://img.shields.io/badge/runtime-Bun%20%7C%20Node-black" />
</p>

QUESTPIE is a server-first TypeScript framework where backend architecture becomes executable.

Instead of manually building APIs, admin dashboards, and operational tooling,
QUESTPIE derives them automatically from your backend schema.

## Why QUESTPIE?

- **Type-Safe End-to-End** - Full TypeScript from schema to API
- **Batteries Optional** - Auth, storage, queue, email, realtime - opt in as needed
- **Framework Agnostic** - Adapters for Hono, Elysia, Next.js, TanStack Start
- **Your Code, Your Control** - Runs in your codebase, not a hosted service
- **Modular Architecture** - Compose reusable modules, extend with plugins

## Packages

| Package                                                 | Description                                              |
| ------------------------------------------------------- | -------------------------------------------------------- |
| [`questpie`](./packages/questpie)                       | Core backend engine with collections, globals, and hooks |
| [`@questpie/admin`](./packages/admin)                   | Config-driven admin UI (React + Tailwind v4 + shadcn)    |
| [`@questpie/hono`](./packages/hono)                     | Hono framework adapter with unified client               |
| [`@questpie/elysia`](./packages/elysia)                 | Elysia framework adapter with Eden Treaty support        |
| [`@questpie/next`](./packages/next)                     | Next.js App Router adapter                               |
| [`@questpie/tanstack-query`](./packages/tanstack-query) | TanStack Query integration with query options factory    |

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
// src/questpie/server/collections/posts.ts
import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required().label("Title"),
		slug: f.text(160).inputOptional().label("Slug"),
		content: f.richText().label("Content"),
		isPublished: f.boolean().default(false).label("Published"),
		publishedAt: f.datetime().label("Published At"),
	}))
	.title(({ f }) => f.title);
```

### Configure the App

```typescript
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: process.env.APP_URL! },
	db: { url: process.env.DATABASE_URL! },
	secret: process.env.AUTH_SECRET!,
});
```

Modules are registered in a separate `modules.ts` file:

```typescript
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

Collections, globals, routes, and jobs are auto-discovered via **file convention**. Run `bunx questpie generate` to produce a `.generated/index.ts` with your fully-typed `App` and runtime `app` instance.

### Connect to Your Framework

**Hono:**

```typescript
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono/server";
import { app } from "#questpie";

const server = new Hono();
server.route("/api", questpieHono(app));

export default { port: 3000, fetch: server.fetch };
```

**Elysia:**

```typescript
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia/server";
import { app } from "#questpie";

const server = new Elysia().use(questpieElysia(app)).listen(3000);

export type AppServer = typeof server;
```

**Next.js:**

```typescript
// app/api/[...path]/route.ts
import { questpieNextRouteHandlers } from "@questpie/next";
import { app } from "#questpie";

export const { GET, POST, PUT, PATCH, DELETE } = questpieNextRouteHandlers(
	app,
	{
		basePath: "/api",
	},
);

export const dynamic = "force-dynamic";
```

### Run Migrations

```bash
bun questpie migrate:generate  # Generate migrations from schema
bun questpie migrate:up        # Apply pending migrations
```

## Modules

The `adminModule` includes the starter module (auth collections, assets, file uploads) plus the full admin UI. Modules go in `modules.ts`:

```typescript
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: process.env.APP_URL! },
	db: { url: process.env.DATABASE_URL! },
	secret: process.env.AUTH_SECRET!,
});
```

```typescript
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

The `adminModule` automatically provides:

- Auth collections (users, sessions, accounts, verifications, apikeys)
- Assets collection with file upload support
- Admin UI functions, views, and components
- Better Auth integration

## Core Concepts

### CRUD Operations

```typescript
// Create
const post = await app.collections.posts.create({
	title: "Hello World",
	slug: "hello-world",
});

// Find many (paginated)
const { docs, totalDocs } = await app.collections.posts.find({
	where: { isPublished: true },
	orderBy: { publishedAt: "desc" },
	limit: 10,
});

// Find one
const post = await app.collections.posts.findOne({
	where: { slug: "hello-world" },
	with: { author: true },
});

// Update
await app.collections.posts.updateById({
	id: post.id,
	data: { title: "Updated Title" },
});

// Delete
await app.collections.posts.deleteById({ id: post.id });
```

### File Uploads

File uploads work automatically when `adminModule` is included (it provides the `assets` collection). Configure storage in your config:

```typescript
export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	storage: { basePath: "/api" },
});

// Upload via API: POST /api/assets/upload
// Or programmatically:
const asset = await app.collections.assets.upload(file, context);
```

### Custom Upload Collections

```typescript
// src/questpie/server/collections/media.ts
import { collection } from "#questpie/factories";

export const media = collection("media")
	.fields(({ f }) => ({
		alt: f.text().label("Alt Text"),
		folder: f.text().label("Folder"),
	}))
	.upload({
		visibility: "public",
		maxSize: 10_000_000, // 10MB
		allowedTypes: ["image/*", "application/pdf"],
	});

// Upload via API: POST /api/media/upload
// Serve files: GET /api/media/files/:key
```

### Authentication

Auth is configured via a standalone `auth.ts` file using the file convention:

```typescript
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: { enabled: true, requireEmailVerification: false },
});
```

```typescript
// TypeScript knows available methods
await app.auth.api.signIn.email({ email, password });
```

### Background Jobs

```typescript
// src/questpie/server/jobs/send-email.ts
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-email",
	schema: z.object({ userId: z.string() }),
	handler: async ({ payload }) => {
		console.log(`Sending email to ${payload.userId}`);
	},
});
```

Configure the queue adapter in your config:

```typescript
import { pgBossAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	queue: {
		adapter: pgBossAdapter({ connectionString: process.env.DATABASE_URL! }),
	},
});

// Publish job (via the generated app instance)
await app.queue.sendEmail.publish({ userId: "123" });
```

### Modular Composition

Create reusable modules:

```typescript
// blog-module.ts
import { module, collection } from "questpie";

export const blogModule = module({
	name: "blog",
	collections: {
		posts: collection("posts").fields(({ f }) => ({
			title: f.text(255).required().label("Title"),
		})),
		categories: collection("categories").fields(({ f }) => ({
			name: f.text(255).required().label("Name"),
		})),
	},
});

// modules.ts
import { adminModule } from "@questpie/admin/server";
import { blogModule } from "./blog-module";

export default [adminModule, blogModule] as const;
```

## Admin UI

The `@questpie/admin` package provides a config-driven admin interface. Admin metadata, list views, and form views are defined on the collection itself:

```typescript
// src/questpie/server/collections/posts.ts
import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(200).required().label("Title"),
		content: f.richText().label("Content"),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
			])
			.label("Status"),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Blog Posts" },
		icon: c.icon("ph:file-text"),
	}))
	.list(({ v, f }) => v.collectionTable({ columns: [f.title, f.status] }))
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{ type: "section", label: "Content", fields: [f.title, f.content] },
				{ type: "section", label: "Publishing", fields: [f.status] },
			],
		}),
	);
```

Codegen creates a typed admin config from the client module registry:

```typescript
// src/questpie/admin/modules.ts
export { default } from "@questpie/admin/client-module";
```

```typescript
// src/questpie/admin/admin.ts
export { admin } from "./.generated/client";
```

```tsx
// Mount in React
import { Admin, AdminLayoutProvider } from "@questpie/admin/client";

const adminInstance = Admin.normalize(admin);

function AdminLayout() {
	return (
		<AdminLayoutProvider
			admin={adminInstance}
			client={client}
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

| Adapter | Package            | Client                                      |
| ------- | ------------------ | ------------------------------------------- |
| Hono    | `@questpie/hono`   | `createClientFromHono` (CRUD + Hono RPC)    |
| Elysia  | `@questpie/elysia` | `createClientFromEden` (CRUD + Eden Treaty) |
| Next.js | `@questpie/next`   | `createClient` from `questpie/client`       |

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
