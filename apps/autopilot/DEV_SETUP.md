# Autopilot Local Development Setup

## Database

Autopilot uses PostgreSQL through Questpie's migration tooling. The default local
connection string is defined in `src/questpie/server/questpie.config.ts`:

```bash
DATABASE_URL=postgres://localhost/autopilot
```

Override `DATABASE_URL` when using a different user, password, host, port, or
database name. The PostgreSQL server must already be running and the database
must exist before migrations can connect. For a default local Postgres install:

```bash
createdb autopilot
```

## First Run

Run migrations before starting Vite:

```bash
cd apps/autopilot
bun run db:setup
bun run dev
```

`db:setup` regenerates Questpie codegen, prints migration status, applies
pending migrations with `questpie migrate:up`, recreates the canonical local dev
admin, and runs the development seed data:

```txt
info@questpie.com / admin123
```

This is the repeatable pre-dev path for reaching admin without bypassing auth or
weakening setup checks.

The development seed creates a demo project, workflow, schedule, knowledge note,
and issues across the product statuses so `/admin` can be tested without
hand-entering records. To rerun only the seed step after migrations are current:

```bash
bun run db:seed
```

## Useful Commands

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| Command                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `bun run db:setup`       | Generate code, migrate, recreate dev admin, and run dev seeds    |
| `bun run db:dev-admin`   | Recreate `info@questpie.com` / `admin123` locally                |
| `bun run db:seed`        | Run pending development seeds                                    |
| `bun run db:seed:status` | Show seed execution status                                       |
| `bun run migrate:status` | Show applied and pending migrations                              |
| `bun run migrate`        | Apply pending migrations                                         |
| `bun run db:reset`       | Regenerate code, then reset and reapply migrations               |
| `bun run migrate:fresh`  | Reset and reapply all migrations                                 |

`db:reset` and `migrate:fresh` are destructive local development commands. Use
them only when the local `autopilot` database can be rebuilt.

The create-questpie template includes a `db:push` shortcut for throwaway schema
sync. Autopilot intentionally uses committed migrations for local setup because
workers need to reproduce the same auth/admin schema state that browser
verification depends on.
