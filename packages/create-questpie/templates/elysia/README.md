# {{projectName}}

A [QUESTPIE](https://questpie.com) **headless API** built with [Elysia](https://elysiajs.com),
running on [Bun](https://bun.sh). No admin UI, no React — just a typed REST API
with Scalar docs and a typed client you can consume from any frontend.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Docker](https://docker.com) (for local PostgreSQL)

### Setup

```bash
# 1) Start PostgreSQL (also provisions required extensions for local dev)
docker compose up -d

# 2) Regenerate codegen and type-check
bun run scaffold:verify

# 3) Create local database tables
bun run db:push

# 4) Start the development server (watch mode)
bun dev
```

> **Production database rule:** `bun run db:push` / `questpie push` is local
> development only. Never run it against production or in deployment
> automation, even with `--force`. Generate and commit a migration with `bun
run migrate:create`, then apply it with `bun run migrate`.

- API docs (Scalar): `http://localhost:3000/api/docs` (the root `/` redirects here)
- REST API: `http://localhost:3000/api/*`

## What you get

- **Headless REST API** — `@questpie/elysia` exposes every collection and global
  under `/api` while Elysia retains sibling host routes.
- **Scalar API reference** at `/api/docs` (the `openapi` module).
- **Auth** — Better Auth (email/password) mounted at `/api/auth`.
- **Typed client + TanStack Query** in `src/lib/` — `client.ts`
  (`createClient<AppConfig>`), `query.ts` (`createQuestpieQueryOptions`), and
  `auth-client.ts` (`better-auth/client`). A separate frontend or scripts import
  these for end-to-end type safety against your server schema.

## Running on Node instead of Bun

The entry (`src/index.ts`) calls `.listen()`, which serves on Bun directly. To
run on Node, install `@elysiajs/node` and pass its adapter:

```ts
import { node } from "@elysiajs/node";
new Elysia({ adapter: node() }) /* …routes… */
	.listen(env.PORT ?? 3000);
```

## Database extensions

QUESTPIE is drizzle-native and does **not** auto-create Postgres extensions. The
starter's full-text search relies on `pg_trgm` (trigram matching).

- **Local dev:** `docker compose up` provisions `pg_trgm` via
  `docker/init-extensions.sql`, mounted into the postgres container's
  `/docker-entrypoint-initdb.d/` and run once on first cluster init — so
  `db:push` works out of the box.
- **Managed Postgres:** enable required extensions through your provider before
  deploying. See [the QUESTPIE docs](https://questpie.com/docs/deployment) for details.

## Project Structure

```text
src/
  index.ts                           # Elysia entry — mounts the QUESTPIE Elysia adapter
  questpie/
    server/
      questpie.config.ts             # Runtime config
      modules.ts                     # Module list (openapi/...)
      config/
        auth.ts                      # Auth config
        openapi.ts                   # OpenAPI/Scalar config
      app.ts                         # Re-export of generated app
      .generated/                    # Codegen output (do not edit manually)
      collections/
        posts.ts
      globals/
        site-settings.ts
  lib/
    env.ts
    client.ts                        # Typed REST client (createClient<AppConfig>)
    auth-client.ts                   # Typed Better Auth client
    query.ts                         # TanStack Query option builders
    query-client.ts
migrations/
```

## Scripts

| Command                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `bun dev`                        | Start development server (watch)                 |
| `bun run build`                  | Build `dist/` with package dependencies external |
| `bun run start`                  | Run the server (no watch)                        |
| `bun run check-types`            | Type check                                       |
| `bun run scaffold:generate`      | Regenerate QUESTPIE codegen                      |
| `bun run scaffold:verify`        | Regenerate codegen and type-check                |
| `bun run questpie:generate`      | Regenerate `src/questpie/server/.generated/*`    |
| `bun questpie add <type> <name>` | Scaffold entity files (auto-runs codegen)        |
| `bun run db:push`                | Push schema directly to local dev database       |
| `bun run migrate`                | Run migrations                                   |
| `bun run migrate:create`         | Create migration                                 |

## Learn more

- [Quickstart](https://questpie.com/docs/quickstart)
- [Data modeling](https://questpie.com/docs/data-modeling)
- [Auth](https://questpie.com/docs/auth)
- [TanStack Query](https://questpie.com/docs/tanstack-query)
- [Deployment](https://questpie.com/docs/deployment)

## Adding a Collection

Preferred workflow:

1. Run `bun questpie add collection products`.
2. The CLI creates the file and runs codegen automatically.
3. Run `bun run db:push` for local development, or `bun run migrate:create` for production migrations.

Manual workflow (when you create files by hand):

1. Create a file in `src/questpie/server/collections/`.
2. Export a collection builder from that file.
3. Run `bun run questpie:generate`.
4. Run `bun run db:push` for local development, or `bun run migrate:create` for production migrations.

Collections are discovered automatically by codegen. No manual `app.ts` registration is required.

## Adding a Global

Preferred workflow:

1. Run `bun questpie add global marketing`.
2. The CLI creates the file and runs codegen automatically.
3. Run `bun run db:push` for local development, or `bun run migrate:create` for production migrations.

Manual workflow (when you create files by hand):

1. Create a file in `src/questpie/server/globals/`.
2. Export a global builder from that file.
3. Run `bun run questpie:generate`.
4. Run `bun run db:push` for local development, or `bun run migrate:create` for production migrations.

Globals are discovered automatically by codegen. No manual `app.ts` registration is required.
