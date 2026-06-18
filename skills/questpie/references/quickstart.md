---
name: questpie-quickstart
description: >
  End-to-end getting started with QUESTPIE, from scaffolding to production.
  Load when starting a new project, onboarding, or following the happy path
  from zero to a running app with collections, admin panel, and migrations.
---

# QUESTPIE Quickstart

Complete lifecycle guide: scaffold, define data, generate, migrate, serve, deploy.

## Contents

1. [Scaffold a New Project](#1-scaffold-a-new-project)
2. [Project Structure](#2-project-structure)
3. [Runtime Config](#3-runtime-config)
4. [Define a Collection](#4-define-a-collection)
5. [Add a Route](#5-add-a-route)
6. [Run Codegen](#6-run-codegen)
7. [Push Schema / Run Migrations](#7-push-schema--run-migrations)
8. [Wire Up the HTTP Handler](#8-wire-up-the-http-handler)
9. [Add the Admin Panel](#9-add-the-admin-panel)
10. [Typed Client SDK](#10-typed-client-sdk)
11. [Start Development](#11-start-development)
12. [Live Preview (Optional)](#12-live-preview-optional)

Also: [Common Mistakes](#common-mistakes) · [CLI Commands](#quick-reference-cli-commands) · [Minimal Complete Example](#minimal-complete-example)

---

## 1. Scaffold a New Project

```bash
bun create questpie my-app
cd my-app
```

Options:

- `-t, --template <name>` / `--runtime <id>`, runtime template: `tanstack-start` (default), `next`, `hono`, or `elysia`
- `--module <name>` / `--modules <a,b>`, enable modules; current ids are `admin`, `openapi`, `workflows`
- `-y, --yes`, non-interactive mode with defaults
- `--database <name>`, database name (default derives from the project name)
- `--queue <adapter>`, `pg-boss` (default), `bullmq`, or `none`
- `--email <adapter>`, `console` (default), `smtp`, `resend`, or `plunk`
- `--realtime <adapter>`, `none` (default), `pg-notify`, or `redis-streams`
- `--kv <adapter>`, `memory` (default) or `redis`
- `--no-install`, skip `bun install`
- `--no-git`, skip git init
- `--no-skills`, skip the background `bunx skills add questpie/questpie`
- `--no-generate`, skip the post-install codegen run
- `--continue-on-error`, keep scaffold files when install or codegen fails

After scaffolding, `.env` already exists; the scaffolder renames `env.example` to `.env.example` and copies it to `.env`.

```bash
cd my-app
docker compose up -d
bun run scaffold:verify
bun run db:push
bun run dev
```

### Environment Variables

Env is validated at boot in `src/lib/env.ts` via `@t3-oss/env-core` (Zod schemas). Add new vars there.

| Variable              | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `DATABASE_URL`        | Yes      | PostgreSQL connection string                 |
| `APP_URL`             | No       | Public URL (default: `http://localhost:3000`) |
| `PORT`                | No       | Server port (default: `3000`)                |
| `BETTER_AUTH_SECRET`  | No       | Better Auth secret (has a dev default)       |
| `MAIL_ADAPTER`        | No       | `console`, `smtp`, `resend`, or `plunk`      |
| `SMTP_HOST`           | No       | SMTP host (when `MAIL_ADAPTER=smtp`)         |
| `SMTP_PORT`           | No       | SMTP port (when `MAIL_ADAPTER=smtp`)         |
| `RESEND_API_KEY`      | No       | Resend API key (when `MAIL_ADAPTER=resend`)  |
| `PLUNK_SECRET_KEY`    | No       | Plunk API key (when `MAIL_ADAPTER=plunk`)    |
| `REDIS_URL`           | No       | Redis URL when BullMQ, Redis realtime, or Redis KV is selected |

---

## 2. Project Structure

```text
my-app/
├── questpie.config.ts                    # CLI entry (re-exports server runtime config)
├── .env                                  # Created from .env.example
├── .env.example                          # Checked-in env template
├── src/
│   ├── questpie/
│   │   ├── server/
│   │   │   ├── questpie.config.ts        # Runtime config: runtimeConfig({ db, app, ... })
│   │   │   ├── modules.ts                # Module dependencies (adminModule, openApiModule, ...)
│   │   │   ├── config/                   # Typed configuration files
│   │   │   │   ├── auth.ts              # authConfig({...}), Better Auth options
│   │   │   │   ├── admin.ts             # adminConfig({ sidebar, dashboard, branding, locale })
│   │   │   │   └── openapi.ts           # openApiConfig({ info, scalar })
│   │   │   ├── collections/              # Starter posts collection + your collections
│   │   │   ├── globals/                  # Starter site-settings global + your globals
│   │   │   └── .generated/              # Codegen output (NEVER edit)
│   │   └── admin/                        # Admin client customizations
│   │       ├── admin.ts                 # Re-exports generated admin client
│   │       ├── modules.ts               # Admin client modules
│   │       └── .generated/             # Codegen output (NEVER edit)
│   ├── lib/
│   │   ├── env.ts                       # Typed env (@t3-oss/env-core)
│   │   ├── auth-client.ts               # Admin auth client
│   │   ├── client.ts                    # Typed client SDK
│   │   ├── query-client.ts              # TanStack Query client
│   │   └── query.ts                     # TanStack Query options
│   └── routes/
│       ├── api/$.ts                     # TanStack Start API catch-all
│       └── admin/                       # Admin routes on render-layer runtimes
```

`config/app.ts` (`appConfig({ locale, access, hooks, context })`) is optional and not scaffolded, add it when needed. `routes/`, `jobs/`, `services/`, `blocks/`, `emails/`, `seeds/`, and `migrations/` are auto-discovered the moment you create them under `src/questpie/server/`.

Default modules are runtime-aware: `tanstack-start` and `next` select `admin` + `openapi`; `hono` and `elysia` select `openapi`. `workflows` is optional. `admin` requires a render-layer runtime, so the scaffolder rejects `--module admin` on `hono` and `elysia`.

### Discovery Rules

Codegen discovers files by **directory name** and **export pattern**:

| Directory       | Key derivation             | Example                                    |
| --------------- | -------------------------- | ------------------------------------------ |
| `collections/`  | Factory arg to camelCase   | `collection("blog-posts")` -> `blogPosts`  |
| `globals/`      | Factory arg to camelCase   | `global("siteSettings")` -> `siteSettings` |
| `routes/`       | Filename to camelCase/path | `create-booking.ts` -> `createBooking`     |
| `jobs/`         | Filename to camelCase      | `send-email.ts` -> `sendEmail`             |
| `routes/` (raw) | Filename to path           | `webhook.ts` -> `webhook`                  |
| `services/`     | Filename to camelCase      | `blog.ts` -> `blog`                        |
| `blocks/`       | Factory arg/export name    | `block("hero")` -> `hero`                  |
| `emails/`       | Filename to camelCase      | `welcome.ts` -> `welcome`                  |

Routes support nested directories for namespacing (`routes/booking/create.ts` -> `client.routes.booking.create()`).

Only hyphens are camelized in factory args; underscores are preserved (`global("site_settings")` -> `site_settings`).

---

## 3. Runtime Config

```ts
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";
import { env } from "@/lib/env.js";

export default runtimeConfig({
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
});
```

The CLI entry at the project root is only a convenience re-export. Runtime and CLI options live in the server config:

```ts
// questpie.config.ts (project root)
export { default } from "./src/questpie/server/questpie.config";
```

---

## 4. Define a Collection

```ts
// src/questpie/server/collections/tasks.ts
import { collection } from "#questpie/factories";

export default collection("tasks").fields(({ f }) => ({
	title: f.text(255).required(),
	description: f.textarea(),
	priority: f
		.select([
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
		])
		.default("medium")
		.required(),
	dueDate: f.date(),
	completed: f.boolean().default(false).required(),
}));
```

This creates:

- A `tasks` database table with typed columns
- CRUD API endpoints at `/api/tasks`
- Zod validation for create/update
- Type-safe query operators for `where`, `orderBy`

### Built-in Field Types

Core: `text`, `number`, `boolean`, `date`, `datetime`, `time`, `select`, `relation`, `upload`, `object`, `json`, `email`, `url`, `textarea`. Admin module fields: `richText`, `blocks`.

---

## 5. Add a Route

```ts
// src/questpie/server/routes/get-overdue-tasks.ts
import { route } from "questpie/services";
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
bun run scaffold:generate
```

This scans your file convention directories and generates:

- `src/questpie/server/.generated/index.ts`, `app` instance, `AppConfig` type
- `src/questpie/server/.generated/factories.ts`, generated factories with module-contributed field types
- `src/questpie/server/.generated/entities.gen.ts`, flat app maps like `AppCollections`, `AppGlobals`, `AppRoutes`, `AppServices`
- `src/questpie/server/.generated/context.gen.ts`, typed handler context and auth/session surface
- `src/questpie/server/.generated/names.gen.ts`, relation target names
- Module augmentation for `AppContext` (typed `collections`, `queue`, `email` in every handler)

Use `#questpie/factories` in collection, global, and block files (they need codegen-generated types). Routes, jobs, services, emails use `"questpie"` directly. Use `#questpie` for the generated app/runtime exports.

Treat the generated output as the app inventory. If a collection, global, route, service, field builder method, relation target, or `session.user` property is missing there, fix discovery, `modules.ts`, or `config/*.ts` and run codegen again. Do not add `any` casts, re-export `index.ts` barrels, or duplicate registries to hide a missing generated type.

**Run codegen again every time you add, rename, or remove a file in a convention directory.** In scaffolded projects, use `bun run questpie:generate` for just QUESTPIE codegen, `bun run scaffold:generate` for framework pre-generation plus QUESTPIE codegen, and `bun run scaffold:verify` for codegen plus TypeScript.

---

## 7. Push Schema / Run Migrations

### Development (quick iteration)

```bash
bun run db:push
```

Syncs your Drizzle schema directly to the database. No migration files created. Use this during development only.

### Production (migration files)

```bash
# Generate a migration from schema diff
bun run migrate:create

# Run pending migrations
bun run migrate

# Rollback last migration
bun run migrate:down

# Show which migrations have run
bun run migrate:status

# Reset all migrations
bun run migrate:reset

# Reset + run all (fresh start)
bun run migrate:fresh
```

---

## 8. Wire Up the HTTP Handler

### TanStack Start (default template)

```ts
// src/routes/api/$.ts
import { createFileRoute } from "@tanstack/react-router";
import { app } from "#questpie";
import { createFetchHandler } from "questpie/http";

const handler = createFetchHandler(app, { basePath: "/api" });

// createFetchHandler returns Response | null, fall back to 404 when no route matches.
const handleCmsRequest = async (request: Request) => {
	const response = await handler(request);
	return (
		response ??
		new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		})
	);
};

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleCmsRequest(request),
			POST: ({ request }) => handleCmsRequest(request),
			PUT: ({ request }) => handleCmsRequest(request),
			DELETE: ({ request }) => handleCmsRequest(request),
			PATCH: ({ request }) => handleCmsRequest(request),
		},
	},
});
```

### Hono / Elysia

The headless templates mount the same `createFetchHandler(app, { basePath: "/api" })` in `src/index.ts` and redirect `/` to `/api/docs`. They do not include the admin UI or `src/routes/admin`.

### Runtime templates

| Template | Shape |
|---|---|
| `tanstack-start` | Full-stack React with admin routes, Vite, Tailwind, Nitro |
| `next` | Next.js App Router with admin routes |
| `hono` | Headless Bun API with Hono and OpenAPI/Scalar |
| `elysia` | Headless Bun API with Elysia and OpenAPI/Scalar |

---

## 9. Add the Admin Panel

The `tanstack-start` and `next` templates select the admin module by default. The server module and admin client module are both static:

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/modules/admin";
export default [adminModule] as const;
```

```ts
// src/questpie/admin/modules.ts
import { adminClientModule } from "@questpie/admin/client/modules/admin";
export default [adminClientModule] as const;
```

This picks up admin conventions (`config/admin.ts`, blocks, views, components) and generates `src/questpie/admin/.generated/client.ts`.

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
// Typed collection queries, autocomplete on field names and operators
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
bun run dev
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

### MEDIUM: Convention file with no export

Codegen discovers a file by its export, either `export default` or a named `export const`/`function` works. A file with no export at all is skipped. Factory categories such as collections and globals key from the factory string when present; non-factory categories such as routes, jobs, services, and emails key from the filename:

```ts
// WRONG, defined but never exported, so codegen skips it
const tasks = collection("tasks").fields(/* ... */);

// CORRECT, default export (collection("tasks") -> key "tasks")
export default collection("tasks").fields(/* ... */);

// ALSO CORRECT, named export is discovered too
export const tasks = collection("tasks").fields(/* ... */);
```

### MEDIUM: Putting business logic in route handlers

Framework route handlers should only mount the QUESTPIE fetch handler. Business logic belongs in `routes/`, `jobs/`, or collection hooks:

```ts
// WRONG, business logic in route file
export const Route = createFileRoute("/api/custom")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const db = getDB();
				// ... manual queries
			},
		},
	},
});

// CORRECT, use a typed route
// src/questpie/server/routes/my-logic.ts
export default route()
	.post()
	.schema(
		z.object({
			/* ... */
		}),
	)
	.handler(async ({ input, collections }) => {
		return await collections.tasks.create(input);
	});
```

---

## Quick Reference: CLI Commands

| Command                          | Purpose                                     |
| -------------------------------- | ------------------------------------------- |
| `bun create questpie my-app`     | Scaffold a new project                      |
| `bun run scaffold:verify`        | Regenerate and type-check scaffold          |
| `bun run questpie:generate`      | Scan conventions, generate types and app    |
| `bun run db:push`                | Push schema to DB (dev only, no migrations) |
| `bun run migrate:create`         | Generate migration from schema diff         |
| `bun run migrate`                | Run pending migrations                      |
| `bun run migrate:down`           | Rollback last migration                     |
| `bun run migrate:status`         | Show migration status                       |
| `bun run migrate:fresh`          | Reset + run all migrations                  |
| `bunx questpie seed`             | Run pending seeds                           |
| `bunx questpie seed:undo`        | Undo executed seeds                         |
| `bunx questpie seed:status`      | Show seed status                            |
| `bunx questpie seed:reset`       | Reset seed tracking/checkpoints (does not undo data) |
| `bun run dev`                    | Start development server                    |

---

## Minimal Complete Example

Starting from zero, every file needed for a working app:

```ts
// questpie.config.ts (project root)
export { default } from "./src/questpie/server/questpie.config";
```

```ts
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";
import { env } from "@/lib/env";

export default runtimeConfig({
	app: { url: env.APP_URL },
	db: { url: env.DATABASE_URL },
	storage: { basePath: "/api" },
	email: { adapter: new ConsoleAdapter({ logHtml: false }) },
});
```

```ts
// src/questpie/server/collections/posts.ts
import { collection } from "#questpie/factories";

export default collection("posts").fields(({ f }) => ({
	title: f.text().required(),
	body: f.richText(),
	status: f.select([
		{ value: "draft", label: "Draft" },
		{ value: "published", label: "Published" },
	]),
}));
```

```ts
// src/routes/api/$.ts
import { createFileRoute } from "@tanstack/react-router";
import { app } from "#questpie";
import { createFetchHandler } from "questpie/http";

const handler = createFetchHandler(app, { basePath: "/api" });

const handleCmsRequest = async (request: Request) => {
	const response = await handler(request);
	return (
		response ??
		new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		})
	);
};

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleCmsRequest(request),
			POST: ({ request }) => handleCmsRequest(request),
			PUT: ({ request }) => handleCmsRequest(request),
			DELETE: ({ request }) => handleCmsRequest(request),
			PATCH: ({ request }) => handleCmsRequest(request),
		},
	},
});
```

Then run:

```bash
bun run scaffold:verify
bun run db:push
bun run dev
```

---

## 12. Live Preview (Optional)

Add split-screen live preview to any collection with `.preview()`. Live Preview uses the existing admin `FormView`, Preview button, `LivePreviewMode`, and iframe. Do not introduce a second default form view or parallel preview API names.

### Add Preview to a Collection

```ts
// src/questpie/server/collections/pages.ts
import { collection } from "#questpie/factories";

export default collection("pages")
	.fields(({ f }) => ({
		title: f.text().required(),
		slug: f.text().required(),
		content: f.blocks(),
	}))
	.preview({
		enabled: true,
		position: "right",
		defaultWidth: 50,
		url: ({ record }) => `/${record.slug}?preview=true`,
	});
```

### Add Preview Support to the Frontend Page

Frontend checklist:

1. Call `useCollectionPreview({ initialData, onRefresh })`.
2. Wrap the rendered output in `PreviewProvider`.
3. Render from `preview.data`, not directly from loader data.
4. Wrap editable scalar text in `PreviewField`.
5. Render blocks with `BlockRenderer` when the page uses `f.blocks()`.

```tsx
import {
	BlockRenderer,
	PreviewField,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";
import admin from "@/questpie/admin/.generated/client";

function PageView({ page }) {
	const router = useRouter();
	const preview = useCollectionPreview({
		initialData: page,
		onRefresh: () => router.invalidate(),
	});

	return (
		<PreviewProvider preview={preview}>
			<PreviewField field="title" editable="text" as="h1">
				{preview.data.title}
			</PreviewField>
			<BlockRenderer
				content={preview.data.content}
				data={preview.data.content?._data}
				renderers={admin.blocks}
				selectedBlockId={preview.selectedBlockId}
				onBlockClick={
					preview.isPreviewMode ? preview.handleBlockClick : undefined
				}
			/>
		</PreviewProvider>
	);
}
```

The form remains authoritative. Save, autosave, Cmd+S, history, workflow, locks, and actions stay in the existing form lifecycle.
