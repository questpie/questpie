# Toy Factory Backend

A backend-first [QUESTPIE](https://questpie.com) example for simple toy production planning. The app has no public site: the first useful surface is the admin panel plus typed API routes.

It demonstrates:

- Admin-only TanStack Start app with QUESTPIE mounted at `/api`
- Collections for toys, bill of materials, materials, machines, production orders, operations, and inventory movements
- `pg-boss` queue jobs for material planning
- Durable workflows from `@questpie/workflows`
- Typed routes for starting production, receiving materials, and capacity summaries
- Email templates using the integrated mailer service
- Seed data that makes the admin usable immediately

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Docker](https://docker.com) (for local PostgreSQL)

### Setup

```bash
# 1) Start PostgreSQL
docker compose up -d

# 2) Regenerate codegen and type-check
bun run scaffold:verify

# 3) Create local database tables
bun run db:push

# 4) Seed demo factory data
bun run seed

# 5) Start development server
bun run dev
```

- Admin panel: `http://localhost:3000/admin`
- API docs (Scalar): `http://localhost:3000/api/docs`
- Production planning route: `POST /api/rpc/planning/start-production`
- Material receipt route: `POST /api/rpc/planning/receive-materials`
- Capacity summary route: `POST /api/rpc/planning/capacity-summary`

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
        materials.ts
        toys.ts
        toy-materials.ts
        machines.ts
        production-orders.ts
        operations.ts
        inventory-movements.ts
      jobs/
        recalculate-material-plan.ts
      workflows/
        production-order-plan.ts
        nightly-capacity-review.ts
      routes/
        rpc/
          planning/
            start-production.ts
            receive-materials.ts
            capacity-summary.ts
      emails/
        production-scheduled.ts
      services/
        capacity-planner.ts
      seeds/
        demo.ts
      globals/
        site-settings.ts
    admin/
      admin.ts                       # Re-export of generated admin config
      modules.ts                     # Admin client module defaults
      .generated/                    # Admin client codegen output
  routes/
    api/$.ts                         # QUESTPIE fetch handler mount
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
| `bun run seed`                   | Seed demo production planning data            |
| `bun run migrate`                | Run migrations                                |
| `bun run migrate:create`         | Create migration                              |

## Demo Flow

1. Open `/admin` and inspect the seeded `PO-1001` production order.
2. Start the workflow:

```bash
curl -X POST http://localhost:3000/api/rpc/planning/start-production \
  -H 'content-type: application/json' \
  -d '{"orderId":"<production-order-id>"}'
```

3. If the order waits for materials, receive stock and signal the workflow:

```bash
curl -X POST http://localhost:3000/api/rpc/planning/receive-materials \
  -H 'content-type: application/json' \
  -d '{"materialId":"<material-id>","quantity":25,"orderId":"<production-order-id>"}'
```

4. Query the planning horizon:

```bash
curl -X POST http://localhost:3000/api/rpc/planning/capacity-summary \
  -H 'content-type: application/json' \
  -d '{"days":14}'
```

The workflow runs through `production-order-plan`, publishes the material planning job, waits for `production.materials-ready` when needed, schedules the order, and sends `production-scheduled` through the configured email adapter.

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
