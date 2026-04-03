# CLAUDE.md

This is a [QUESTPIE](https://questpie.com) project scaffolded with `create-questpie`.

## Quick Reference

| Command                              | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `bun dev`                            | Start dev server (port 3000)             |
| `bun build`                          | Build for production                     |
| `bun start`                          | Start production server                  |
| `bun questpie add <type> <name>`     | Scaffold a new entity (collection, seed, etc.) |
| `bun questpie add --list`            | List all available scaffold types        |
| `bun questpie generate`              | Regenerate .generated/index.ts           |
| `bun questpie migrate:create`        | Generate a migration from schema diff    |
| `bun questpie migrate`               | Run pending migrations                   |
| `bun questpie seed`                  | Run pending seeds                        |
| `docker compose up -d`               | Start PostgreSQL                         |

## Project Architecture

This project follows QUESTPIE's **server-first** philosophy:

- **Server** defines WHAT (schema, validation, access, hooks, jobs)
- **Client** defines HOW (rendering, themes, custom components)

```
src/questpie/
  server/              ← WHAT: data contracts and behavior
    questpie.config.ts ← App config: runtimeConfig({ db, app, ... })
    modules.ts         ← Module dependencies (adminModule, openApiModule, etc.)
    config/            ← Typed configuration files
      auth.ts          ← authConfig({...}) — Better Auth options
      app.ts           ← appConfig({ locale, access, hooks, context })
      admin.ts         ← adminConfig({ sidebar, dashboard, branding, locale })
      openapi.ts       ← openApiConfig({ info, scalar })
    .generated/        ← Codegen output (app instance + App type)
      index.ts
    collections/       ← One file per collection (auto-discovered)
    globals/           ← One file per global (auto-discovered)
    routes/            ← Server routes via route() (auto-discovered)
    jobs/              ← Background job definitions (auto-discovered)
    blocks/            ← Block definitions (auto-discovered)
  admin/               ← HOW: UI rendering concerns
    admin.ts           ← Re-exports generated admin config
    .generated/        ← Codegen output (admin client config)
      client.ts
```

## Key Files

- **`src/questpie/server/questpie.config.ts`** — App config: `runtimeConfig({ db, app, ... })`.
- **`src/questpie/server/modules.ts`** — Module dependencies: `export default [adminModule, openApiModule] as const`.
- **`src/questpie/server/config/auth.ts`** — Auth config via `authConfig()` factory.
- **`src/questpie/server/config/app.ts`** — App config (locale, access, hooks, context) via `appConfig()` factory.
- **`src/questpie/server/config/admin.ts`** — Admin config (sidebar, dashboard, branding, locale) via `adminConfig()` factory.
- **`src/questpie/server/.generated/index.ts`** — Codegen output. Exports typed `app` instance and `App` type. Run `bunx questpie generate` to regenerate.
- **`src/lib/env.ts`** — Type-safe env variables via `@t3-oss/env-core`. Add new env vars here with Zod schemas.
- **`questpie.config.ts`** — CLI config (migration directory, app reference).
- **`src/routes/api/$.ts`** — API catch-all handler. Serves REST + OpenAPI docs at `/api/docs`.

## Environment Variables

Defined in `src/lib/env.ts` with runtime validation. See `.env.example` for all available variables.

Required:

- `DATABASE_URL` — PostgreSQL connection string

Optional (with defaults):

- `APP_URL` — Application URL (default: `http://localhost:3000`)
- `BETTER_AUTH_SECRET` — Auth secret key
- `MAIL_ADAPTER` — `console` or `smtp`

## Common Tasks

### Add a new collection

Preferred workflow:

1. Run `bun questpie add collection my-thing`
2. The CLI creates the file and auto-runs codegen
3. Run `bun questpie migrate:create`

Manual workflow:

1. Create `src/questpie/server/collections/my-thing.ts` with a named export:
   ```ts
   import { collection } from "questpie";
   export const myThing = collection("my-thing").fields(({ f }) => ({ ... }));
   ```
2. Run `bunx questpie generate` to regenerate `.generated/index.ts`
3. Run `bun questpie migrate:create` to generate migration

Collections are auto-discovered by codegen — no manual registration needed.

### Add a new global

Preferred workflow:

1. Run `bun questpie add global my-global`
2. The CLI creates the file and auto-runs codegen
3. Run `bun questpie migrate:create`

Manual workflow:

1. Create `src/questpie/server/globals/my-global.ts` with a named export
2. Run `bunx questpie generate`
3. Run `bun questpie migrate:create`

### Add a server route (end-to-end type-safe)

1. Create `src/questpie/server/routes/my-function.ts`:

   ```ts
   import { route } from "questpie";
   import { z } from "zod";

   export default route()
   	.post()
   	.schema(z.object({ id: z.string() }))
   	.handler(async ({ input, collections }) => {
   		// input: typed from Zod schema; collections, db, session, etc. from AppContext
   		return { name: "result" };
   	});
   ```

2. Run `bunx questpie generate` — route is auto-discovered and available at `/api/my-function`

See AGENTS.md for detailed route patterns, access control, and TanStack Query integration.

## Documentation

- **QUESTPIE Docs**: https://questpie.com/docs
- **Getting Started**: https://questpie.com/docs/getting-started
- **API Reference (local)**: http://localhost:3000/api/docs (Scalar UI, available when dev server is running)
