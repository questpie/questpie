# {{projectName}}

A [QUESTPIE](https://questpie.com) app built with TanStack Start.

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

# 4) Start development server
bun run dev
```

> **Production database rule:** `bun run db:push` / `questpie push` is local
> development only. Never run it against production or in deployment
> automation, even with `--force`. Generate and commit a migration with `bun
run migrate:create`, then apply it with `bun run migrate`.

- Admin panel: `http://localhost:3000/admin`
- API docs (Scalar): `http://localhost:3000/api/docs`

The API route intentionally uses QUESTPIE's low-level Fetch handler. There is
no published TanStack Start adapter package; TanStack owns the server-route
boundary and forwards all seven supported HTTP methods.

### Database extensions

QUESTPIE is drizzle-native and does **not** auto-create Postgres extensions. The
starter's full-text search relies on `pg_trgm` (trigram matching).

- **Local dev:** `docker compose up` provisions `pg_trgm` via
  `docker/init-extensions.sql`, mounted into the postgres container's
  `/docker-entrypoint-initdb.d/` and run once on first cluster init — so
  `db:push` works out of the box.
- **Managed Postgres:** enable required extensions through your provider before
  deploying. See [the QUESTPIE docs](https://questpie.com/docs) for details.

## Project Structure

```text
src/
  questpie/
    server/
      questpie.config.ts             # Runtime config
      modules.ts                     # Module list (admin/openapi/...)
      config/
        admin.ts                     # Admin sidebar/dashboard/branding
        auth.ts                      # Auth config
        openapi.ts                   # OpenAPI/Scalar config
      app.ts                         # Re-export of generated app
      .generated/                    # Codegen output (do not edit manually)
      collections/
        posts.ts
      globals/
        site-settings.ts
    admin/
      admin.ts                       # Re-export of generated admin config
      modules.ts                     # Admin client module defaults
      .generated/                    # Admin client codegen output
  routes/
    api/$.ts                         # Low-level QUESTPIE Fetch mount (seven methods)
    admin.tsx
    admin/
  lib/
    env.ts
    client.ts
    auth-client.ts
    query-client.ts
migrations/
```

## Scripts

| Command                          | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `bun dev`                        | Start development server                      |
| `bun build`                      | Build for production                          |
| `bun start`                      | Start production server                       |
| `bun check-types`                | Type check                                    |
| `bun run scaffold:generate`      | Regenerate routes and QUESTPIE codegen        |
| `bun run scaffold:verify`        | Regenerate codegen and type-check             |
| `bun run routes:generate`        | Regenerate TanStack Router route tree         |
| `bun run questpie:generate`      | Regenerate `src/questpie/server/.generated/*` |
| `bun questpie add <type> <name>` | Scaffold entity files (auto-runs codegen)     |
| `bun run db:push`                | Push schema directly to local dev database    |
| `bun run migrate`                | Run migrations                                |
| `bun run migrate:create`         | Create migration                              |

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
