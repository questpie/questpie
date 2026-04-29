---
name: questpie-core/production
description:
  QUESTPIE production deployment authentication better-auth OAuth database PostgreSQL Drizzle storage S3 Flydrive queue pg-boss jobs realtime SSE pgNotify Redis migrations email SMTP KV key-value logger Pino OpenAPI Docker environment variables adapters infrastructure
  - questpie-core
---

This skill builds on questpie-core.

## Overview

QUESTPIE uses an adapter-based architecture for all infrastructure. Development defaults work out of the box; production requires explicit adapter configuration in `questpie.config.ts`.

| Service  | Dev Default           | Production Adapter                    |
| -------- | --------------------- | ------------------------------------- |
| Database | PostgreSQL (local)    | PostgreSQL (remote, SSL)              |
| Storage  | Local filesystem      | S3-compatible (`s3` driver)           |
| Queue    | None (jobs skip)      | pg-boss (`pgBossAdapter`)             |
| Realtime | pgNotify              | Redis Streams (`redisStreamsAdapter`) |
| Email    | Console (logs output) | SMTP (`SmtpAdapter`)                  |
| KV Store | In-memory             | Redis (`"redis"` adapter)             |
| Logger   | Pino (console)        | Pino (structured JSON)                |

## Authentication

QUESTPIE uses [Better Auth](https://www.better-auth.com/). Configure via `config/auth.ts`:

```ts
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	baseURL: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
	secret: process.env.BETTER_AUTH_SECRET || "change-me",
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

The `adminModule` provides a built-in `user` collection for storing user accounts.

## Database

PostgreSQL with Drizzle ORM. Schema is generated from your collection and global definitions.

```ts
export default runtimeConfig({
	db: {
		url: process.env.DATABASE_URL || "postgres://localhost/myapp",
	},
});
```

Raw access via `db` context, indexes via `.indexes()`. See `references/infrastructure-adapters.md` for field-to-column mapping and full details.

## Migrations

### Development: Push

Sync schema directly without migration files:

```bash
bunx questpie push
```

### Production: Migration Files

```bash
# Generate migration from schema diff
bunx questpie migrate:generate

# Run pending migrations
bunx questpie migrate:up

# Rollback last migration
bunx questpie migrate:down

# Drop everything and re-run (DESTRUCTIVE -- dev only)
bunx questpie migrate:fresh

# Reset migration tracking
bunx questpie migrate:reset
```

Configure migration and seed directories in `questpie.config.ts` under `cli.migrations.directory` and `cli.seeds.directory`. Run seeds with `bunx questpie seed`.

## Storage

QUESTPIE uses [Flydrive](https://flydrive.dev/) for file storage.

### Local (Development Default)

```ts
export default runtimeConfig({
	storage: {
		basePath: "/api",
	},
});
```

### S3 (Production)

```ts
import { S3Driver } from "flydrive/drivers/s3";

export default runtimeConfig({
	storage: {
		basePath: "/api",
		driver: new S3Driver({
			bucket: process.env.S3_BUCKET,
			region: process.env.S3_REGION,
			accessKeyId: process.env.S3_ACCESS_KEY,
			secretAccessKey: process.env.S3_SECRET_KEY,
		}),
	},
});
```

### Upload Fields

```ts
avatar: f.upload({
  to: "assets",
  mimeTypes: ["image/*"],
  maxSize: 5_000_000,
}),
```

## Queue

Background job processing with [pg-boss](https://github.com/timgit/pg-boss). Jobs stored in PostgreSQL.

```ts
import { pgBossAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	queue: {
		adapter: pgBossAdapter({
			connectionString: process.env.DATABASE_URL,
		}),
	},
});
```

### Publishing Jobs

From hooks, functions, or other jobs:

```ts
handler: async ({ queue }) => {
	await queue.sendAppointmentConfirmation.publish({
		appointmentId: "abc",
		customerId: "def",
	});
};
```

The `queue` object is fully typed -- autocompletion shows all registered jobs and their payload schemas.

## Realtime

SSE-based live updates via `POST /realtime` multiplexed endpoint.

### pgNotify (Single Instance)

```ts
import { pgNotifyAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	realtime: {
		adapter: pgNotifyAdapter({
			connectionString: process.env.DATABASE_URL,
		}),
	},
});
```

### Redis Streams (Multi-Instance)

Required for horizontal scaling:

```ts
import { redisStreamsAdapter } from "questpie";

export default runtimeConfig({
	realtime: {
		adapter: redisStreamsAdapter({
			url: process.env.REDIS_URL,
		}),
	},
});
```

## Email

Transactional email with typed templates. Two adapters: `SmtpAdapter` (production) and `ConsoleAdapter` (development).

```ts
import { SmtpAdapter, ConsoleAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	email: {
		adapter:
			process.env.NODE_ENV === "development"
				? new ConsoleAdapter({ logHtml: false })
				: new SmtpAdapter({
						transport: { host: process.env.SMTP_HOST, port: 587, secure: true },
					}),
	},
});
```

Templates go in `emails/` directory using the `email()` factory. Send via `email.sendTemplate()` in handlers. See `references/infrastructure-adapters.md` for template examples.

## Search

PostgreSQL full-text search. Mark collections as searchable:

```ts
.searchable(["title", "body", "tags"])
```

Client usage:

```ts
const results = await client.search.search({
	query: "haircut styles",
	collections: ["posts", "services"],
	limit: 20,
});
```

## KV Store

### Custom Adapter

```ts
export default runtimeConfig({
	kv: {
		adapter: myKvAdapter,
		defaultTtl: 3600,
	},
});
```

### In-Memory Default

```ts
kv: {
  defaultTtl: 3600,
}
```

### Usage

```ts
handler: async ({ kv }) => {
	await kv.set("key", "value", { ttl: 3600 });
	const value = await kv.get("key");
	await kv.delete("key");
};
```

## Logger

Structured logging with [Pino](https://getpino.io):

```ts
handler: async ({ logger }) => {
	logger.info("Processing booking");
	logger.error({ err: error }, "Booking failed");
	logger.debug({ barberId, serviceId }, "Checking availability");
};
```

Log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

Structured data goes as the first argument:

```ts
logger.info({ appointmentId: "abc", action: "created" }, "Appointment created");
```

## OpenAPI

Auto-generate OpenAPI 3.1 spec with `@questpie/openapi`. Install with `bun add @questpie/openapi`, add `openApiModule` to `modules.ts`, configure it in `config/openapi.ts` with `openApiConfig({ info: { title: "My API", version: "1.0.0" } })`, then run `bunx questpie generate`. Serves spec at `/api/openapi.json` and Scalar docs at `/api/docs`. See `references/infrastructure-adapters.md` for full options.

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
- Run `bunx questpie migrate:up` before deploying
- Configure SMTP for transactional email
- Set `APP_URL` to your public domain
- Enable HTTPS
- Configure S3 or persistent storage for uploads
- Use `redisStreamsAdapter` if running multiple instances
- Set up health checks

### Health Check

```ts
// routes/health.ts
import { route } from "questpie";

export default route({
	method: "GET",
	handler: async ({ db }) => {
		await db.execute(sql`SELECT 1`);
		return new Response(JSON.stringify({ status: "ok" }), {
			headers: { "Content-Type": "application/json" },
		});
	},
});
```

## Common Mistakes

### CRITICAL: Missing BETTER_AUTH_SECRET in production

Without a strong secret, sessions can be forged. The default `"change-me"` is for development only.

```ts
// WRONG -- in production
secret: "change-me";

// CORRECT -- strong random secret from environment
secret: process.env.BETTER_AUTH_SECRET; // min 32 chars
```

### HIGH: Not running migrations after schema changes

When you add, remove, or change collection fields, the database schema must be updated. Without migrations, queries fail or return stale data.

```bash
# After changing any collection fields:
bunx questpie migrate:generate   # create migration file
bunx questpie migrate:up         # apply to database

# Or in development:
bunx questpie push               # direct schema sync (no migration file)
```

### HIGH: Using local storage in production without persistent volume

The local storage adapter writes to the filesystem. In containerized deployments, files are lost when the container restarts.

```ts
// WRONG -- files lost on container restart
storage: { basePath: "/api" }

// CORRECT -- persistent S3 storage
import { S3Driver } from "flydrive/drivers/s3";

storage: {
  basePath: "/api",
  driver: new S3Driver({
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  }),
}
```

### MEDIUM: Missing queue adapter for background jobs

Without pg-boss configured, job `.publish()` calls silently do nothing. Jobs defined in `jobs/` will never run.

```ts
// REQUIRED for jobs to actually execute
queue: {
  adapter: pgBossAdapter({
    connectionString: process.env.DATABASE_URL,
  }),
}
```

## Realtime and Live Preview

The realtime adapter (`pgNotifyAdapter` or `redisStreamsAdapter`) is relevant for **detached or shared preview sessions** — when the preview runs in a separate browser tab, or multiple collaborators view the same preview.

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
