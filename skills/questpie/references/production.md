---
name: questpie-core/production
description:
  QUESTPIE production deployment authentication better-auth OAuth database PostgreSQL Drizzle storage S3 Files SDK queue pg-boss jobs realtime SSE pgNotify Redis migrations email SMTP KV key-value logger Pino OpenAPI Docker environment variables adapters infrastructure
  - questpie-core
---

This skill builds on questpie-core. It is the **deployment/ops** doc: auth, access control, locking down the REST surface, PgBouncer, SSE keepalive, Docker, the production checklist, and common mistakes. For the exhaustive **adapter config shapes** (Storage, Queue, Realtime, Email, KV, Logger, Search, OpenAPI) see `references/infrastructure-adapters.md`.

## Contents

- [Overview](#overview)
- [Environment](#environment)
- [Authentication](#authentication), session, access control, locking down REST
- [Database & Migrations](#database--migrations)
- [Infrastructure Adapters](#infrastructure-adapters), delegated to infrastructure-adapters.md
- [PgBouncer Compatibility](#pgbouncer-compatibility)
- [Realtime & SSE Keepalive](#realtime--sse-keepalive)
- [Deployment](#deployment), Docker, env vars, checklist, health check
- [Realtime and Live Preview](#realtime-and-live-preview)
- [Common Mistakes](#common-mistakes)

## Overview

QUESTPIE uses an adapter-based architecture for all infrastructure. Development defaults work out of the box; production requires explicit adapter configuration in `questpie.config.ts`.

| Service  | Dev Default           | Production Adapter                              |
| -------- | --------------------- | ----------------------------------------------- |
| Database | PostgreSQL (local)    | PostgreSQL (remote, SSL)                        |
| Storage  | Local filesystem      | Files SDK provider adapter (`s3`, `r2`, etc.)   |
| Queue    | None (jobs skip)      | pg-boss (`pgBossAdapter`)                       |
| Realtime | pgNotify              | Redis Streams (`redisStreamsAdapter`)           |
| Email    | Console (logs output) | SMTP (`SmtpAdapter`)                            |
| KV Store | In-memory             | Redis (`redisKVAdapter`)                        |
| Logger   | Pino (console)        | Pino (structured JSON)                          |

Every adapter's exact config shape lives in `references/infrastructure-adapters.md`.

## Environment

Scaffolded apps declare every env var once in `src/lib/env.ts` via `@t3-oss/env-core`, schema-validated at boot, typed everywhere. The framework-level `questpie/env` helper is still available for apps that want generated server/client env modules; full reference: `references/env.md`. Never use raw `process.env.X` / `process.env.X!` in app code.

```ts
// src/questpie/server/env.ts (framework env-helper variant)
import { env } from "questpie/env";
import { z } from "zod";

export default env({
	server: {
		DATABASE_URL: z.url(),
		BETTER_AUTH_SECRET: z.string().min(32),
		S3_BUCKET: z.string().optional(),
		S3_REGION: z.string().optional(),
		S3_ACCESS_KEY: z.string().optional(),
		S3_SECRET_KEY: z.string().optional(),
		SMTP_HOST: z.string().optional(),
		REDIS_URL: z.url().optional(),
	},
});
```

Snippets that read config values assume `import env from "./env"` at the top of `questpie.config.ts` (or `../env` from `config/`).

## Authentication

QUESTPIE uses [Better Auth](https://www.better-auth.com/). Configure via `config/auth.ts`:

```ts
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie/app";

import env from "../env";

export default authConfig({
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	baseURL: env.APP_URL ?? "http://localhost:3000",
	basePath: "/api/auth",
	secret: env.BETTER_AUTH_SECRET,
});
```

### Auth Options

| Option                                      | Type      | Description                                         |
| ------------------------------------------- | --------- | --------------------------------------------------- |
| `emailAndPassword.enabled`                  | `boolean` | Enable email/password login                         |
| `emailAndPassword.requireEmailVerification` | `boolean` | Require email verification                          |
| `baseURL`                                   | `string`  | App public URL                                      |
| `basePath`                                  | `string`  | Auth API path prefix                                |
| `secret`                                    | `string`  | Session signing secret (min 32 chars in production) |

### Session in Handlers

Access the current session in functions, hooks, and access rules:

```ts
handler: async ({ session }) => {
	if (!session) throw new Error("Not authenticated");
	const user = session.user;
	// user.id, user.email, user.name
};
```

### Access Control with Session

```ts
.access({
  read: true,
  create: ({ session }) => !!session,
  update: ({ session }) => (session?.user as any)?.role === "admin",
  delete: ({ session }) => (session?.user as any)?.role === "admin",
})
```

The `adminModule` provides the canonical Better Auth `user` collection for storing user accounts. That contract includes `user.role` (`admin` or `user`), which built-in admin setup and login guards depend on. Do not replace `collection("user")` from scratch in apps that use `adminModule`; merge `starterModule.collections.user` and extend it instead.

### Locking Down the REST Surface

Deny-all is actually deny-all, there are no implicit framework grants above
`defaultAccess`:

```ts title="config/app.ts"
export default appConfig({
	access: { read: false, create: false, update: false, delete: false },
});
```

With this config, anonymous and authenticated callers get nothing unless a
collection opts in via `.access()`: no row listing (including
public-visibility upload collections like `assets`), and no schema/meta
introspection (gated by the same access system, visible iff at least one
operation is allowed, overridable with the `introspect` access kind). Public
upload files still serve by key (`GET /:collection/files/:key`) because
`visibility: "public"` declares the BYTES public, override with the `serve`
access kind. Do not wrap schema/meta routes in custom auth middleware; use
`introspect` rules instead.

## Database & Migrations

PostgreSQL with Drizzle ORM; schema is generated from your collection and global definitions. In production point `db.url` at a remote PG with SSL. Config shape, field-to-column mapping, raw access, and indexes are in `references/infrastructure-adapters.md`.

### Development: Push

Sync schema directly without migration files:

```bash
bunx questpie push
```

### Production: Migration Files

```bash
# Generate migration from schema diff
bunx questpie migrate:create

# Run pending migrations
bunx questpie migrate

# Rollback last migration
bunx questpie migrate:down

# Drop everything and re-run (DESTRUCTIVE -- dev only)
bunx questpie migrate:fresh

# Reset migration tracking
bunx questpie migrate:reset
```

Configure migration and seed directories in `questpie.config.ts` under `cli.migrations.directory` and `cli.seeds.directory`. Run seeds with `bunx questpie seed`.

## Infrastructure Adapters

All adapter config shapes, Storage (local, S3, R2), Queue (pg-boss, BullMQ), Realtime (pgNotify, Redis Streams), Email (SMTP, Console, Resend, Plunk), KV (Redis, custom), Logger, Search, and OpenAPI, live in **`references/infrastructure-adapters.md`**. Each is configured under `runtimeConfig({...})` in `questpie.config.ts`. The deployment-relevant constraints follow.

- **Queue / pg-boss and Realtime / pgNotify** both rely on PostgreSQL `LISTEN/NOTIFY` and silently break behind PgBouncer in transaction pool mode. See [PgBouncer Compatibility](#pgbouncer-compatibility).
- **Cloudflare Workers** process queues push-based: use `cloudflareQueuesAdapter` from `questpie/adapters/cloudflare` and export the Worker via `createCloudflareWorkerHandlers`, do not run `app.queue.listen()` in a Worker.
- **Multi-instance realtime** requires `redisStreamsAdapter`; a single instance can use `pgNotifyAdapter`.

## PgBouncer Compatibility

PgBouncer in `transaction` pool mode reassigns sessions per-transaction, so persistent listeners are impossible. Once `LISTEN` returns, the connection is handed to a different client and notifications are dropped. This breaks any feature that depends on session-bound state.

Bun SQL (`new SQL({ url })`) already pools connections internally. In single-instance and small-replica deployments, PgBouncer adds nothing on top of it. PgBouncer only earns its keep when you have 20+ replicas, run on serverless with cold-start churn, or share infra with non-Bun consumers.

### Adapter Compatibility Matrix

| Adapter                          | Direct PG | PgBouncer (transaction)           | PgBouncer (session)         |
| -------------------------------- | --------- | --------------------------------- | --------------------------- |
| `pgNotifyAdapter` (realtime)     | works     | broken, listens silently dropped | works (pooling neutralized) |
| `pgBossAdapter` (queue)          | works     | broken, LISTEN/NOTIFY required   | works (pooling neutralized) |
| Drizzle queries via Bun SQL      | works     | works                             | works                       |
| `redisStreamsAdapter` (realtime) | n/a       | n/a                               | n/a                         |

Prepared statements also break under transaction pooling. If you must use it, ensure your driver disables prepared statements end-to-end.

### DB Connection Routing

- **Default and recommended:** direct connection to the PG primary. Bun SQL pools internally; you do not need PgBouncer.
- **If you must use PgBouncer:** put it in `session` pool mode for any process that runs `pgBossAdapter` or `pgNotifyAdapter`. Session mode pins one server connection per client, which neutralizes pooling but keeps `LISTEN/NOTIFY` working.
- **Split topology:** route web traffic through PgBouncer (transaction mode) and run workers (pgBoss, pgNotify) on a direct connection. This works, but realtime fired from web handlers still routes through the same `QUESTPIE_DB`, so realtime in web fails. In practice, going direct everywhere is simpler.
- **TODO / current limitation:** the framework reads a single `QUESTPIE_DB` env var. There is no built-in split between a pooled URL and a direct URL for LISTEN consumers. Track this if you need a mixed topology.

## Realtime & SSE Keepalive

SSE-based live updates fan out via the `POST /realtime` multiplexed endpoint. Adapter config (`pgNotifyAdapter`, `redisStreamsAdapter`) is in `references/infrastructure-adapters.md`.

### SSE Keepalive & Timeouts

The `POST /realtime` SSE stream sends a `ping` every **8s** by default (`realtime.keepAliveIntervalMs`). Every layer between browser and server must tolerate at least that idle window, or subscriptions die and reconnect in a loop:

| Layer                      | Setting                            | Recommendation                                                            |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| Bun (`Bun.serve`)          | `idleTimeout` (default 10s)        | Default ping survives it; set `idleTimeout: 30` for headroom              |
| nginx                      | `proxy_read_timeout` (default 60s) | Keep >= 60s; disable SSE response buffering (`proxy_buffering off`)       |
| Load balancers (ALB, etc.) | idle timeout (often 60s)           | Keep above `keepAliveIntervalMs`                                          |
| Serverless platforms       | response buffering / max duration  | SSE needs streaming responses; buffered platforms break realtime entirely |

```ts
// Bun server entry, the app owns Bun.serve options, not the framework
export default {
	port: 3000,
	idleTimeout: 30, // seconds
	fetch: server.fetch,
};
```

## Deployment

### Docker

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS build
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx questpie generate
RUN bun run build

FROM base AS production
COPY --from=build /app/.output /app/.output
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
```

### Environment Variables

| Variable                            | Required | Description                           |
| ----------------------------------- | -------- | ------------------------------------- |
| `DATABASE_URL`                      | Yes      | PostgreSQL connection string          |
| `APP_URL`                           | Yes      | Public URL of the application         |
| `APP_SECRET` / `BETTER_AUTH_SECRET` | Yes      | Session signing secret (min 32 chars) |
| `SMTP_HOST`                         | No       | Email SMTP host                       |
| `SMTP_PORT`                         | No       | Email SMTP port                       |
| `REDIS_URL`                         | No       | Redis URL (for KV, realtime)          |
| `S3_BUCKET`                         | No       | S3 bucket name                        |
| `S3_REGION`                         | No       | S3 region                             |
| `S3_ACCESS_KEY`                     | No       | S3 access key                         |
| `S3_SECRET_KEY`                     | No       | S3 secret key                         |

### Production Checklist

- Set strong `APP_SECRET` (min 32 characters)
- Use production `DATABASE_URL` with SSL
- Run `bunx questpie migrate` before deploying
- Configure SMTP for transactional email
- Set `APP_URL` to your public domain
- Enable HTTPS
- Configure S3 or persistent storage for uploads
- Use `redisStreamsAdapter` if running multiple instances
- Set up health checks

### Health Check

```ts
// routes/health.ts
import { sql } from "questpie/drizzle";
import { route } from "questpie/services";

export default route()
	.get()
	.raw()
	.access(true)
	.handler(async ({ db }) => {
		await db.execute(sql`SELECT 1`);
		return Response.json({ status: "ok" });
	});
```

## Common Mistakes

### CRITICAL: Missing BETTER_AUTH_SECRET in production

Without a strong secret, sessions can be forged. The default `"change-me"` is for development only.

```ts
// WRONG -- in production
secret: "change-me";

// CORRECT -- declared in env.ts as z.string().min(32), validated at boot
secret: env.BETTER_AUTH_SECRET;
```

### HIGH: Not running migrations after schema changes

When you add, remove, or change collection fields, the database schema must be updated. Without migrations, queries fail or return stale data.

```bash
# After changing any collection fields:
bunx questpie migrate:create     # create migration file
bunx questpie migrate            # apply to database

# Or in development:
bunx questpie push               # direct schema sync (no migration file)
```

### HIGH: Using local storage in production without persistent volume

The local storage adapter writes to the filesystem. In containerized deployments, files are lost when the container restarts.

```ts
// WRONG -- files lost on container restart
storage: { basePath: "/api" }

// CORRECT -- persistent S3 storage
import { s3 } from "files-sdk/s3";

storage: {
  basePath: "/api",
  adapter: s3({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  }),
}
```

### MEDIUM: Missing queue adapter for background jobs

Without pg-boss configured, job `.publish()` calls silently do nothing. Jobs defined in `jobs/` will never run.

```ts
// REQUIRED for jobs to actually execute
queue: {
  adapter: pgBossAdapter({
    connectionString: env.DATABASE_URL,
  }),
}
```

### HIGH: PgBouncer transaction pool with pgNotify/pgBoss

Pointing `QUESTPIE_DB` at a PgBouncer in transaction pool mode silently breaks `pgNotifyAdapter` and `pgBossAdapter`. Both rely on PostgreSQL `LISTEN/NOTIFY`, which requires a persistent session. PgBouncer transaction pooling reassigns the session per-transaction, so the listener is dropped right after `LISTEN` returns.

Symptoms:

- Realtime: SSE clients connect but never receive events; UI silently falls back to polling, or never refreshes
- Queue: jobs sit in the table; workers process them only on the polling tick (delayed by seconds to minutes), or never wake at all

Fix:

```ts
// WRONG -- QUESTPIE_DB points at PgBouncer (transaction mode)
realtime: {
	adapter: pgNotifyAdapter({ connectionString: env.QUESTPIE_DB });
}
queue: {
	adapter: pgBossAdapter({ connectionString: env.QUESTPIE_DB });
}

// CORRECT -- direct PG connection (Bun SQL pools internally), or switch
// realtime to redisStreamsAdapter, which takes a connected redis client
// (not a URL) for multi-instance deployments:
realtime: {
	adapter: redisStreamsAdapter({ client: redis }); // see infrastructure-adapters.md
}
```

If your infra mandates PgBouncer, use `session` pool mode for processes that run pgBoss or pgNotify. See "PgBouncer Compatibility" for the full matrix.

## Realtime and Live Preview

The realtime adapter (`pgNotifyAdapter` or `redisStreamsAdapter`) is relevant for **detached or shared preview sessions**, when the preview runs in a separate browser tab, or multiple collaborators view the same preview.

For the default **same-tab preview**, realtime is NOT involved. Current same-tab preview uses `postMessage` for refresh/focus messages between the editor and the iframe.

| Preview mode        | Transport      | Requires realtime adapter? |
| ------------------- | -------------- | -------------------------- |
| Same-tab (default)  | `postMessage`  | No                         |
| Detached tab        | SSE / realtime | Yes                        |
| Shared / multi-user | SSE / realtime | Yes                        |

If your app only uses same-tab preview (the default), you do not need to configure a realtime adapter for preview purposes. Configure it when you need detached preview, multi-user collaboration, or other realtime features (live notifications, presence, etc.).

### MEDIUM: Missing APP_URL environment variable

Auth callbacks, email links, and storage URLs all depend on `APP_URL`. Without it, OAuth redirects break and email links point to `localhost`.

```bash
# WRONG
# APP_URL not set

# CORRECT
APP_URL=https://myapp.example.com
```
