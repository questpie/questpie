# CLAUDE.md

This is a [QUESTPIE](https://questpie.com) project scaffolded with `create-questpie`.

## Quick Reference

| Command                       | Purpose                      |
| ----------------------------- | ---------------------------- |
| `bun dev`                     | Start dev server (port 3000) |
| `bun build`                   | Build for production         |
| `bun start`                   | Start production server      |
| `bun questpie migrate`        | Run database migrations      |
| `bun questpie migrate:create` | Generate a new migration     |
| `docker compose up -d`        | Start PostgreSQL             |

## Project Architecture

This project follows QUESTPIE's **server-first** philosophy:
- **Server** defines WHAT (schema, validation, access, hooks, jobs)
- **Client** defines HOW (rendering, themes, custom components)

```
src/questpie/
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
```

## Key Files

- **`src/questpie/server/questpie.config.ts`** — App config: `config({ modules: [admin()], db, app, ... })`. Sidebar, dashboard, branding are options to `admin()`.
- **`src/questpie/server/auth.ts`** — Auth config (`export default { ... } satisfies AuthConfig`).
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

1. Create `src/questpie/server/collections/my-thing.ts` with a named export:
   ```ts
   import { collection } from "questpie";
   export const myThing = collection("my-thing").fields(({ f }) => ({ ... }));
   ```
2. Run `bunx questpie generate` to regenerate `.generated/index.ts`
3. Run `bun questpie migrate:create` to generate migration

Collections are auto-discovered by codegen — no manual registration needed.

### Add a new global

1. Create `src/questpie/server/globals/my-global.ts` with a named export
2. Run `bunx questpie generate`
3. Run `bun questpie migrate:create`

### Add a server function (end-to-end type-safe)

1. Create `src/questpie/server/functions/my-function.ts`:
   ```ts
   import { fn } from "questpie";
   import { z } from "zod";

   export default fn({
     schema: z.object({ id: z.string() }),
     handler: async ({ input, app }) => {
       // input: { id: string } — typed from Zod schema
       // app: fully typed, autocomplete works
       return { name: "result" };
     },
   });
   ```
2. Run `bunx questpie generate` — function is auto-discovered and available at `/api/fn/my-function`

See AGENTS.md for detailed function patterns, access control, and TanStack Query integration.

## Documentation

- **QUESTPIE Docs**: https://questpie.com/docs
- **Getting Started**: https://questpie.com/docs/getting-started
- **API Reference (local)**: http://localhost:3000/api/docs (Scalar UI, available when dev server is running)
