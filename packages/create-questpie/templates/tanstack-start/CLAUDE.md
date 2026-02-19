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
  server/           ← WHAT: data contracts and behavior
    app.ts          ← Main composition root (collections, globals, auth, build)
    builder.ts      ← Shared builder: qb = q.use(adminModule)
    rpc.ts          ← RPC router instance
    sidebar.ts      ← Admin sidebar configuration
    dashboard.ts    ← Admin dashboard configuration
    collections/    ← One file per collection (*.collection.ts)
    globals/        ← One file per global (*.global.ts)
  admin/            ← HOW: UI rendering concerns
    admin.ts        ← Client builder: qa<App>().use(adminModule)
    builder.ts      ← Client-side builder instance
```

## Key Files

- **`src/questpie/server/app.ts`** — The composition root. Register collections, globals, sidebar, dashboard, auth, and call `.build()`.
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

1. Create `src/questpie/server/collections/my-thing.collection.ts`
2. Export from `src/questpie/server/collections/index.ts`
3. Register in `src/questpie/server/app.ts` → `.collections({ posts, myThing })`
4. Add to sidebar in `src/questpie/server/sidebar.ts`
5. Run `bun questpie migrate:create` to generate migration

### Add a new global

1. Create `src/questpie/server/globals/my-global.global.ts`
2. Export from `src/questpie/server/globals/index.ts`
3. Register in `src/questpie/server/app.ts` → `.globals({ siteSettings, myGlobal })`
4. Add to sidebar in `src/questpie/server/sidebar.ts`
5. Run `bun questpie migrate:create`

### Add an RPC function (end-to-end type-safe)

`rpc.ts` uses `rpc<App>()` — a type-only import from `app.ts` (erased at runtime, no circular dependency). This gives you fully typed `app` in all handlers.

1. Create `src/questpie/server/functions/my-function.ts`:
   ```ts
   import { r } from "@/questpie/server/rpc";
   import { z } from "zod";

   export const myFunction = r.fn({
     schema: z.object({ id: z.string() }),
     handler: async ({ input, app }) => {
       // input: { id: string } — typed from Zod schema
       // app: App — fully typed, autocomplete works
       return { name: "result" };
     },
   });
   ```
2. Register in `app.ts` → `appRpc = r.router({ ...adminRpc, myFunction })`
3. Call from client (fully typed):
   ```ts
   const result = await client.rpc.myFunction({ id: "123" });
   // result: { name: string } — inferred from handler return type
   ```

See AGENTS.md for detailed RPC type flow, access control, and TanStack Query integration.

## Documentation

- **QUESTPIE Docs**: https://questpie.com/docs
- **Getting Started**: https://questpie.com/docs/getting-started
- **API Reference (local)**: http://localhost:3000/api/docs (Scalar UI, available when dev server is running)
