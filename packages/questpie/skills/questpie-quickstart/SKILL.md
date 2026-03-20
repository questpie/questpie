---
name: questpie-quickstart
type: lifecycle
description: >
  End-to-end getting started with QUESTPIE — from scaffolding to production.
  Load when starting a new project, onboarding, or following the happy path
  from zero to a running app with collections, admin panel, and migrations.
---

# QUESTPIE Quickstart

Complete lifecycle guide: scaffold, define data, generate, migrate, serve, deploy.

---

## 1. Scaffold a New Project

```bash
bun create questpie my-app
cd my-app
```

Options:

- `-t, --template <name>` — template to use (default: `tanstack-start`)
- `--no-install` — skip `bun install`
- `--no-git` — skip git init

After scaffolding:

```bash
cp .env.example .env   # Set DATABASE_URL, APP_URL, APP_SECRET
```

### Required Environment Variables

| Variable       | Required | Description                  |
| -------------- | -------- | ---------------------------- |
| `DATABASE_URL` | Yes      | PostgreSQL connection string |
| `APP_URL`      | Yes      | Public URL of the app        |
| `APP_SECRET`   | Yes      | Secret for auth sessions     |
| `SMTP_HOST`    | No       | Email SMTP host              |
| `SMTP_PORT`    | No       | Email SMTP port              |

---

## 2. Project Structure

```text
my-app/
├── questpie.config.ts                    # CLI config (re-exports server config)
├── src/
│   ├── questpie/
│   │   ├── server/
│   │   │   ├── questpie.config.ts        # Runtime config (DB, plugins, secret)
│   │   │   ├── modules.ts                # Module dependencies
│   │   │   ├── config/                   # Typed configuration files
│   │   │   │   ├── auth.ts              # authConfig({...}) — Better Auth options
│   │   │   │   ├── app.ts               # appConfig({ locale, access, hooks, context })
│   │   │   │   ├── admin.ts             # adminConfig({ sidebar, dashboard, branding, locale })
│   │   │   │   └── openapi.ts           # openApiConfig({ info, scalar })
│   │   │   ├── collections/              # One file per collection
│   │   │   ├── globals/                  # One file per global
│   │   │   ├── routes/                   # App routes (JSON or raw)
│   │   │   ├── jobs/                     # Background tasks
│   │   │   ├── services/                 # Singleton services
│   │   │   ├── blocks/                   # Content blocks (admin plugin)
│   │   │   ├── emails/                   # Email templates
│   │   │   └── .generated/              # Codegen output (NEVER edit)
│   │   └── admin/                        # Admin client customizations
│   │       ├── .generated/              # Codegen output (NEVER edit)
│   │       └── blocks/                  # Block renderers (React)
│   ├── lib/
│   │   └── client.ts                    # Typed client SDK
│   └── routes/
│       └── api/
│           └── $.ts                     # API catch-all handler
```

### Discovery Rules

Codegen discovers files by **directory name** and **default export**:

| Directory       | Key derivation             | Example                                |
| --------------- | -------------------------- | -------------------------------------- |
| `collections/`  | Filename to camelCase      | `blog-posts.ts` -> `blogPosts`         |
| `globals/`      | Filename to camelCase      | `site-settings.ts` -> `siteSettings`   |
| `routes/`       | Filename to camelCase/path | `create-booking.ts` -> `createBooking` |
| `jobs/`         | Filename to camelCase      | `send-email.ts` -> `sendEmail`         |
| `routes/` (raw) | Filename to path           | `webhook.ts` -> `webhook`              |
| `services/`     | Filename to camelCase      | `blog.ts` -> `blog`                    |
| `blocks/`       | Named exports              | `export const hero` -> `hero`          |
| `emails/`       | Filename to camelCase      | `welcome.ts` -> `welcome`              |

Routes support nested directories for namespacing (`routes/booking/create.ts` -> `client.routes.booking.create()`).

---

## 3. Runtime Config

```ts
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: process.env.DATABASE_URL || "postgres://localhost/myapp",
	},
	secret: process.env.APP_SECRET || "change-me-in-production",
});
```

The CLI config at the project root re-exports the server config:

```ts
// questpie.config.ts (project root)
export { default } from "./src/questpie/server/questpie.config";
```

---

## 4. Define a Collection

```ts
// src/questpie/server/collections/tasks.ts
import { collection } from "#questpie";

export default collection("tasks").fields(({ f }) => ({
	title: f.text({ required: true, maxLength: 255 }),
	description: f.textarea(),
	priority: f.select({
		options: ["low", "medium", "high"],
		default: "medium",
		required: true,
	}),
	dueDate: f.date(),
	completed: f.boolean({ default: false, required: true }),
}));
```

This creates:

- A `tasks` database table with typed columns
- CRUD API endpoints at `/api/tasks`
- Zod validation for create/update
- Type-safe query operators for `where`, `orderBy`

### Built-in Field Types

`text`, `number`, `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `relation`, `upload`, `richText`, `json`, `slug`, `email`, `url`, `password`, `color`, `textarea`.

---

## 5. Add a Route

```ts
// src/questpie/server/routes/get-overdue-tasks.ts
import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(z.object({}))
	.handler(async ({ collections }) => {
		return await collections.tasks.find({
			where: {
				completed: false,
				dueDate: { lt: new Date() },
			},
			orderBy: { dueDate: "asc" },
		});
	});
```

Typed JSON routes are exposed as flat endpoints at `/api/<route-path>`.

---

## 6. Run Codegen

```bash
bunx questpie generate
```

This scans your file convention directories and generates:

- `src/questpie/server/.generated/index.ts` — `app` instance, `AppConfig` type
- `src/questpie/server/.generated/module.ts` — merged module with all discovered entities
- Module augmentation for `AppContext` (typed `collections`, `queue`, `email` in every handler)

The `#questpie` import in collection files resolves to the generated app instance.

**Run codegen again every time you add, rename, or remove a file in a convention directory.**

---

## 7. Push Schema / Run Migrations

### Development (quick iteration)

```bash
bunx questpie push
```

Syncs your Drizzle schema directly to the database. No migration files created. Use this during development only.

### Production (migration files)

```bash
# Generate a migration from schema diff
bunx questpie migrate:generate

# Run pending migrations
bunx questpie migrate:up

# Rollback last migration
bunx questpie migrate:down

# Reset all migrations
bunx questpie migrate:reset

# Reset + run all (fresh start)
bunx questpie migrate:fresh
```

---

## 8. Wire Up the HTTP Handler

### TanStack Start (default template)

```ts
// src/routes/api/$.ts
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { createFetchHandler } from "questpie";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });

export const Route = createAPIFileRoute("/api/$")({
	GET: ({ request }) => handler(request),
	POST: ({ request }) => handler(request),
	PATCH: ({ request }) => handler(request),
	DELETE: ({ request }) => handler(request),
});
```

### Hono

```ts
import { createFetchHandler } from "questpie/adapters/hono";
import { app } from "#questpie";

export default createFetchHandler(app, { basePath: "/api" });
```

### Available Adapters

| Adapter        | Package            | Use case              |
| -------------- | ------------------ | --------------------- |
| Hono           | `@questpie/hono`   | General purpose, fast |
| Elysia         | `@questpie/elysia` | Bun-native            |
| Next.js        | `@questpie/nextjs` | Next.js API routes    |
| TanStack Start | (built-in)         | Generic fetch handler |

---

## 9. Add the Admin Panel

### Install

```bash
bun add @questpie/admin
```

### Register the plugin

```ts
// src/questpie/server/questpie.config.ts
import { adminPlugin } from "@questpie/admin/plugin";
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	plugins: [adminPlugin()],
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: process.env.DATABASE_URL,
	},
	secret: process.env.APP_SECRET,
});
```

### Register the admin module

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

### Re-run codegen

```bash
bunx questpie generate
```

This picks up admin conventions (sidebar, dashboard, branding) and generates `admin/.generated/client.ts`.

Navigate to `/admin` to see the admin panel with your collections.

---

## 10. Typed Client SDK

```ts
// src/lib/client.ts
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

export const client = createClient<AppConfig>({
	baseURL: "http://localhost:3000",
	basePath: "/api",
});
```

Usage with full type inference:

```ts
// Typed collection queries — autocomplete on field names and operators
const tasks = await client.collections.tasks.find({
	where: { completed: false },
	orderBy: { priority: "desc" },
});

// Call route
const overdue = await client.routes.getOverdueTasks({});
```

---

## 11. Start Development

```bash
bun dev
```

Test: `curl http://localhost:3000/api/tasks` for collection CRUD, `curl -X POST http://localhost:3000/api/get-overdue-tasks -H "Content-Type: application/json" -d '{}'` for typed route calls.

---

## Common Mistakes

### CRITICAL: Using npm/yarn/pnpm instead of Bun

QUESTPIE requires **Bun** as the package manager and runtime. All commands use `bun` or `bunx`:

```bash
# WRONG
npm install questpie
npx questpie generate
yarn add questpie

# CORRECT
bun add questpie
bunx questpie generate
bun dev
```

### HIGH: Forgetting to run `questpie generate` after changes

Every time you add, rename, or remove a file in a convention directory (`collections/`, `routes/`, `globals/`, `jobs/`, etc.), you must re-run:

```bash
bunx questpie generate
```

Without this, the `app` instance and types will be stale. New collections will not appear in CRUD endpoints or admin.

### HIGH: Not setting DATABASE_URL

QUESTPIE requires PostgreSQL. Set `DATABASE_URL` in `.env` before running `push` or `migrate`:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
```

### MEDIUM: Missing `export default` on convention files

Codegen discovers files by their **default export**. Files without `export default` are silently ignored:

```ts
// WRONG — codegen will not discover this
export const tasks = collection("tasks").fields(/* ... */);

// CORRECT
export default collection("tasks").fields(/* ... */);
```

### MEDIUM: Putting business logic in route handlers

Framework route handlers should only mount the QUESTPIE fetch handler. Business logic belongs in `routes/`, `jobs/`, or collection hooks:

```ts
// WRONG — business logic in route file
export const Route = createAPIFileRoute("/api/custom")({
	POST: async ({ request }) => {
		const db = getDB();
		// ... manual queries
	},
});

// CORRECT — use a typed route
// src/questpie/server/routes/my-logic.ts
export default route()
	.post()
	.schema(
		z.object({
			/* ... */
		}),
	)
	.handler(async ({ input, collections }) => {
		return await collections.tasks.create({ data: input });
	});
```

---

## Quick Reference: CLI Commands

| Command                          | Purpose                                     |
| -------------------------------- | ------------------------------------------- |
| `bun create questpie my-app`     | Scaffold a new project                      |
| `bunx questpie generate`         | Scan conventions, generate types and app    |
| `bunx questpie push`             | Push schema to DB (dev only, no migrations) |
| `bunx questpie migrate:generate` | Generate migration from schema diff         |
| `bunx questpie migrate:up`       | Run pending migrations                      |
| `bunx questpie migrate:down`     | Rollback last migration                     |
| `bunx questpie migrate:fresh`    | Reset + run all migrations                  |
| `bun dev`                        | Start development server                    |

---

## Minimal Complete Example

Starting from zero — every file needed for a working app:

```ts
// questpie.config.ts (project root)
export { default } from "./src/questpie/server/questpie.config";
```

```ts
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: process.env.APP_URL || "http://localhost:3000" },
	db: { url: process.env.DATABASE_URL! },
	secret: process.env.APP_SECRET || "dev-secret",
});
```

```ts
// src/questpie/server/collections/posts.ts
import { collection } from "#questpie";

export default collection("posts").fields(({ f }) => ({
	title: f.text({ required: true }),
	body: f.richText(),
	status: f.select({ options: ["draft", "published"] }),
}));
```

```ts
// src/routes/api/$.ts
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { createFetchHandler } from "questpie";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });

export const Route = createAPIFileRoute("/api/$")({
	GET: ({ request }) => handler(request),
	POST: ({ request }) => handler(request),
	PATCH: ({ request }) => handler(request),
	DELETE: ({ request }) => handler(request),
});
```

Then run:

```bash
bunx questpie generate
bunx questpie push
bun dev
```
