# {{projectName}}

A [QUESTPIE](https://questpie.com) app built with Next.js (App Router).

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

- Admin panel: `http://localhost:3000/admin`
- API docs (Scalar): `http://localhost:3000/api/docs`

## What you get

- A typed **admin panel** at `/admin` (views, dashboard, auth, media).
- A REST API with interactive **Scalar docs** at `/api/docs`.
- A fully **typed client** (`src/lib/client.ts`) plus TanStack Query option
  builders (`src/lib/query.ts`) — full inference from your server schema.

## Documentation

- [Quickstart](https://questpie.com/docs/quickstart)
- [Data modeling](https://questpie.com/docs/data-modeling)
- [Auth](https://questpie.com/docs/auth)
- [TanStack Query](https://questpie.com/docs/tanstack-query)
- [Deployment](https://questpie.com/docs/deployment)

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
  app/
    layout.tsx                       # Root layout + providers
    providers.tsx                    # QueryClientProvider
    page.tsx                         # Landing page
    not-found.tsx                    # 404 page
    api/
      [...all]/route.ts              # QUESTPIE fetch handler mount
    admin/
      layout.tsx                     # AdminLayoutProvider (Next adapter)
      admin.css                      # Admin Tailwind entry
      [[...all]]/page.tsx            # Admin router + login
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
        posts.collection.ts
      globals/
        site-settings.global.ts
    admin/
      admin.ts                       # Re-export of generated admin config
      modules.ts                     # Admin client module defaults
      .generated/                    # Admin client codegen output
  lib/
    env.ts
    client.ts
    auth-client.ts
    query-client.ts
    query.ts
migrations/
```

## Scripts

| Command                          | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `bun dev`                        | Start development server                      |
| `bun build`                      | Build for production                          |
| `bun start`                      | Start production server                       |
| `bun check-types`                | Type check                                    |
| `bun run scaffold:generate`      | Regenerate QUESTPIE codegen                   |
| `bun run scaffold:verify`        | Regenerate codegen and type-check             |
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
