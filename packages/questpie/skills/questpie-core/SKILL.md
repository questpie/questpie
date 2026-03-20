---
name: questpie-core
description: QUESTPIE framework overview config codegen file-convention project-structure collections globals routes jobs services schema TypeScript backend architecture monorepo bun setup
metadata:
  version: 1.0.0
  category: framework
---

## What Is QUESTPIE

QUESTPIE is a backend-first TypeScript application framework. You define your data schema once using standalone factories, codegen generates the typed runtime, and any frontend consumes it through introspection.

It is NOT a CMS. The admin panel (`@questpie/admin`) is one projection of the schema -- the same way a client SDK, OpenAPI spec, or mobile app would be.

Core flow:

```text
Schema Files  -->  Codegen  -->  Typed Runtime  -->  Projections (Admin, SDK, OpenAPI)
                                      |
                                Database tables
                                API validation
                                Query operators
                                Type inference
```

## Monorepo Packages

| Package                    | Path                       | Purpose                                                        |
| -------------------------- | -------------------------- | -------------------------------------------------------------- |
| `questpie`                 | `packages/questpie`        | Core engine -- fields, CRUD, routes, introspection, CLI        |
| `@questpie/admin`          | `packages/admin`           | Config-driven admin UI (React + Tailwind v4 + shadcn)          |
| `@questpie/tanstack-query` | `packages/tanstack-query`  | TanStack Query option builders, `streamedQuery`, batch helpers |
| `@questpie/openapi`        | `packages/openapi`         | OpenAPI spec generation + Scalar UI middleware                 |
| `@questpie/elysia`         | `packages/elysia`          | Elysia adapter                                                 |
| `@questpie/hono`           | `packages/hono`            | Hono adapter                                                   |
| `@questpie/next`           | `packages/next`            | Next.js adapter                                                |
| `create-questpie`          | `packages/create-questpie` | CLI scaffolder (`bunx create-questpie`)                        |

Runtime: **Bun** is the only package manager. TypeScript + ESM everywhere.

## Core Architecture

### Three Layers

| Layer      | Directory              | Defines                                                                   |
| ---------- | ---------------------- | ------------------------------------------------------------------------- |
| **Server** | `src/questpie/server/` | Schema, fields, access control, hooks, routes, jobs -- WHAT the data does |
| **Admin**  | `src/questpie/admin/`  | Branding, custom renderers, client config -- HOW it renders               |
| **Routes** | `src/routes/`          | HTTP mounting only -- no business logic here                              |

### Standalone Factories

User code uses standalone factories:

```ts
// collections/posts.ts
import { collection } from "questpie";

export default collection("posts").fields(({ f }) => ({
	title: f.text({ label: "Title", required: true }),
	content: f.richText({ label: "Content" }),
	status: f.select({ label: "Status", options: ["draft", "published"] }),
}));
```

```ts
// globals/site-settings.ts
import { global } from "questpie";

export default global("site-settings").fields(({ f }) => ({
	siteName: f.text({ label: "Site Name", required: true }),
	description: f.textarea({ label: "Description" }),
}));
```

```ts
// routes/get-stats.ts
import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week", "month"]) }))
	.handler(async ({ input, collections }) => {
		const count = await collections.posts.count({});
		return { posts: count };
	});
```

### Config

```ts
// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

```ts
// modules.ts
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [
	adminModule,
	openApiModule({ info: { title: "My API", version: "1.0.0" } }),
] as const;
```

### Route Handler

```ts
// routes/api/$.ts
import { app } from "#questpie";
import { createFetchHandler } from "questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

## File Convention

QUESTPIE uses your file system as the source of truth. Drop a file in the right directory, run codegen, and it is part of your app. No manual registration.

### Directory Categories

| Directory      | Entity          | Export Style     | Key Derivation                   |
| -------------- | --------------- | ---------------- | -------------------------------- |
| `collections/` | Collections     | Default or named | Filename to camelCase            |
| `globals/`     | Globals         | Default or named | Filename to camelCase            |
| `routes/`      | Routes          | Default          | Filename to camelCase/slash path |
| `jobs/`        | Jobs            | Default          | Filename to camelCase            |
| `services/`    | Services        | Default          | Filename to camelCase            |
| `emails/`      | Email templates | Default          | Filename to camelCase            |
| `blocks/`      | Blocks          | Named exports    | Export name                      |
| `messages/`    | i18n messages   | Default          | Filename to locale key           |
| `migrations/`  | DB migrations   | Default          | Array (ordered)                  |
| `seeds/`       | DB seeds        | Default          | Array (ordered)                  |

Filenames are converted from kebab-case to camelCase: `blog-posts.ts` becomes `blogPosts`, `create-booking.ts` becomes `createBooking`.

### Single-File Conventions

| File                 | Factory                                        | Purpose                          |
| -------------------- | ---------------------------------------------- | -------------------------------- |
| `questpie.config.ts` | `runtimeConfig({...})`                         | DB, plugins, adapters            |
| `modules.ts`         | `export default [...]`                         | Module dependencies              |
| `fields.ts`          | `export default {...}`                         | Custom field type definitions    |

### Config Directory (`config/`)

All project configuration lives in `config/` with typed factory functions:

| File                | Factory                                          | Package                        | Contains                                         |
| ------------------- | ------------------------------------------------ | ------------------------------ | ------------------------------------------------ |
| `config/auth.ts`    | `authConfig({...})`                              | `"questpie"`                   | Better Auth options (email/password, providers)   |
| `config/app.ts`     | `appConfig({...})`                               | `"questpie"`                   | `locale`, `access`, `hooks`, `context`            |
| `config/admin.ts`   | `adminConfig({...})`                             | `"@questpie/admin/server"`     | `sidebar`, `dashboard`, `branding`, `locale`      |
| `config/openapi.ts` | `openApiConfig({...})`                           | `"@questpie/openapi"`          | OpenAPI spec info, Scalar UI options              |

The `appConfig` uses `destructure` — properties map to individual createApp keys. Context resolver return type auto-propagates to handler `ctx`.

### Nested Namespacing

Routes support nested directories:

```text
routes/
  booking/
    create.ts    -> client.routes.booking.create()
    cancel.ts    -> client.routes.booking.cancel()
  get-stats.ts   -> client.routes.getStats()
```

### Project Layout (by-type, default)

```text
my-app/
  questpie.config.ts
  src/
    questpie/
      server/
        questpie.config.ts
        modules.ts
        config/
          auth.ts          <- authConfig({...})
          app.ts           <- appConfig({ locale, access, hooks, context })
          admin.ts         <- adminConfig({ sidebar, dashboard, branding, locale })
          openapi.ts       <- openApiConfig({ info, scalar })
        collections/
          posts.ts
          categories.ts
        globals/
          site-settings.ts
        routes/
          create-booking.ts
        jobs/
          send-email.ts
        services/
          blog.ts
        emails/
          appointment-confirmation.ts
        .generated/
          index.ts
          factories.ts
      admin/
        admin.ts
        hooks.ts
        .generated/
          client.ts
        blocks/
          hero.tsx
    routes/
      api/
        $.ts
```

By-feature layout is also supported: nest `collections/`, `routes/`, etc. under `features/<domain>/`. Both layouts can coexist.

## Codegen

Run `questpie generate` (or `questpie dev` for watch mode) to scan file conventions and produce `.generated/`.

### What Gets Generated

**`.generated/index.ts`** -- App instance, type exports, `createContext` helper.

**`.generated/module.ts`** -- Merged module with all discovered entities.

### Generated Types

```ts
export type AppCollections = {
	posts: typeof posts;
	categories: typeof categories;
};
export type AppGlobals = { siteSettings: typeof siteSettings };
export type AppJobs = { sendEmail: typeof sendEmail };
export type AppRoutes = { webhook: typeof webhookRoute };
export type AppServices = { blog: BlogService };
export type AppEmails = {
	appointmentConfirmation: typeof appointmentConfirmationEmail;
};

export type AppConfig = {
	collections: AppCollections;
	globals: AppGlobals;
	routes: AppRoutes;
};
```

### Module Augmentation

Codegen augments `AppContext` so every handler gets typed DI:

```ts
declare global {
	namespace Questpie {
		interface AppContext {
			db: Database;
			email: MailerService<AppEmailTemplates>;
			queue: QueueClient<AppJobs>;
			collections: AppCollections;
			globals: AppGlobals;
			session: Session | null;
			blog: BlogService;
		}
	}
}
```

This is why `collections`, `queue`, `email`, `db` are available and typed in every handler.

### When to Re-Run Codegen

Re-run when you add, rename, or delete entity files, change modules/plugins, or restructure file conventions.

Do NOT re-run when you change field options, hook logic, access rules, or runtime config values.

### The `#questpie` Import

Collection and global files use `#questpie` as an import alias resolving to the generated app context. Provides field type autocompletion and relation target inference.

```ts
import { collection } from "#questpie";
```

## CLI Commands

| Command                        | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `bunx questpie generate`       | Run codegen, produce `.generated/`            |
| `bunx questpie dev`            | Watch mode -- re-runs codegen on file changes |
| `bunx questpie migrate`        | Run pending database migrations               |
| `bunx questpie migrate:create` | Create a new migration file                   |

## Built-in Field Types

`text`, `number`, `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `relation`, `upload`, `richText`, `json`, `slug`, `email`, `url`, `password`, `color`, `textarea`.

Custom fields: use `field<TConfig, TValue>()` factory. Custom operators: use `operator<TValue>()`.

## Context-First Architecture

Every handler receives dependencies through context -- no imports, no singletons:

```ts
export default route()
	.post()
	.schema(z.object({ barberId: z.string() }))
	.handler(async ({ input, collections, queue }) => {
		const appointment = await collections.appointments.create({
			barber: input.barberId,
			status: "pending",
		});
		await queue.sendConfirmation.publish({ appointmentId: appointment.id });
		return { success: true };
	});
```

`collections`, `queue`, `email`, `db`, `session` are all injected via `AppContext`. Codegen generates the type augmentation.

## Internal Package Structure

`packages/questpie/src/` layout:

| Directory  | Contents                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `server/`  | Collections, globals, fields, routes, adapters, integrated services (auth, storage, queue, mailer, realtime), migration |
| `client/`  | Client-side client, typed hooks                                                                                         |
| `shared/`  | Shared types and utilities                                                                                              |
| `exports/` | Public entry points (`index.ts`, `client.ts`, `shared.ts`, `cli.ts`)                                                    |
| `cli/`     | CLI commands and codegen pipeline                                                                                       |

Internal imports use `#questpie/*` subpath alias (e.g., `#questpie/server/fields/field`).

## Sub-Skills

| Need to...                                     | Read                           |
| ---------------------------------------------- | ------------------------------ |
| Define collections, fields, globals, relations | `questpie-core/data-modeling`  |
| Set up access control, hooks, validation       | `questpie-core/rules`          |
| Add routes, jobs, services                     | `questpie-core/business-logic` |
| Query data with the CRUD API                   | `questpie-core/crud-api`       |
| Configure auth, storage, queue, deploy         | `questpie-core/production`     |
| Build plugins, modules, custom fields          | `questpie-core/extend`         |
| Add multi-tenant scope isolation               | `questpie-core/multi-tenancy`  |

## Common Mistakes

### HIGH: Missing file convention structure for codegen discovery

Files must be placed in the correct directories for codegen to discover them. A collection file in `src/questpie/server/models/` will NOT be found -- it must be in `collections/`.

```text
WRONG:  src/questpie/server/models/posts.ts
RIGHT:  src/questpie/server/collections/posts.ts

WRONG:  src/questpie/server/api/get-stats.ts
RIGHT:  src/questpie/server/routes/get-stats.ts
```

### HIGH: Importing from `.generated/` before running codegen

The `.generated/` directory does not exist until you run `questpie generate`. Running your app or type-checking before codegen will produce import errors.

```bash
# Run this first
bunx questpie generate

# Then start your app
bun run dev
```

### HIGH: Putting business logic in framework route mount files

Framework routes should only mount handlers. Business logic belongs in collections (hooks), routes, or jobs.

```ts
// WRONG -- logic in route file
// routes/api/$.ts
app.post("/create-post", async (req) => {
	const post = await db.insert(posts).values(req.body);
	await sendEmail(post.author, "New post created");
	return post;
});

// CORRECT -- logic in typed route, framework route just mounts
// routes/create-post.ts
export default route()
	.post()
	.schema(z.object({ title: z.string(), body: z.string() }))
	.handler(async ({ input, collections, email }) => {
		const post = await collections.posts.create(input);
		await email.send("newPost", { to: post.author });
		return post;
	});
```

### MEDIUM: Using npm/yarn instead of Bun

QUESTPIE requires Bun as the package manager. The monorepo uses `bun.lock` and `packageManager: bun@1.3.0`.

```bash
# WRONG
npm install
yarn add questpie

# CORRECT
bun install
bun add questpie
```

### MEDIUM: Editing `.generated/` files

Files in `.generated/` are overwritten on every codegen run. Never edit them manually. If you need to change generated output, modify the source files and re-run `questpie generate`.
