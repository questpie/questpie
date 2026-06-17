# Infrastructure Adapters Reference

The exhaustive catalog of adapter config shapes for QUESTPIE infrastructure. For deployment ops (auth, access control, PgBouncer, SSE keepalive, Docker, checklist), see `references/production.md`.

- [Database](#database)
- [Storage](#storage), local, S3, R2, signed URLs
- [Queue](#queue), pg-boss, BullMQ
- [Realtime](#realtime), pgNotify, Redis Streams
- [Search](#search), Postgres FTS, pgvector semantic
- [Email](#email), SMTP, Console, Resend, Plunk, custom
- [KV Store](#kv-store), Redis, custom, in-memory
- [Logger](#logger)
- [OpenAPI](#openapi)
- [Migrations CLI](#migrations-cli)
- [Complete Production Config Example](#complete-production-config-example)
- [Environment Variables Summary](#environment-variables-summary)

Every env var is declared once in `env.ts` (beside `questpie.config.ts`) and consumed via `import env from "./env"`, never raw `process.env.X` / `process.env.X!`. See `references/env.md`.

## Database

PostgreSQL with Drizzle ORM. Configured in `questpie.config.ts`:

```ts
import { runtimeConfig } from "questpie/app";

import env from "./env";

export default runtimeConfig({
	db: {
		url: env.DATABASE_URL,
	},
});
```

### Field-to-Column Mapping

| QUESTPIE Field | Drizzle Column Type |
| -------------- | ------------------- |
| `f.text()`     | `varchar` / `text`  |
| `f.number()`   | `integer`           |
| `f.boolean()`  | `boolean`           |
| `f.date()`     | `date`              |
| `f.datetime()` | `timestamp`         |
| `f.select()`   | `varchar`           |
| `f.json()`     | `jsonb`             |
| `f.object()`   | `jsonb`             |
| `.array()`     | `jsonb`             |
| `f.relation()` | `varchar` (FK)      |

### Raw Access

```ts
handler: async ({ db }) => {
	// Raw SQL
	const result = await db.execute(sql`SELECT COUNT(*) FROM posts`);

	// Drizzle query builder
	const rows = await db.select().from(table).where(eq(table.id, id));
};
```

### Indexes

```ts
import { uniqueIndex, index } from "drizzle-orm/pg-core";

collection("posts")
	.fields(({ f }) => ({ slug: f.text().required() }))
	.indexes(({ table }) => [
		uniqueIndex("posts_slug_unique").on(table.slug),
		index("posts_status_idx").on(table.status),
	]);
```

## Storage

File storage via [Files SDK](https://files-sdk.dev/).

### Local (Development)

Default adapter. Files stored on local filesystem:

```ts
export default runtimeConfig({
	storage: {
		basePath: "/api",
	},
});
```

### S3-Compatible (Production)

Works with AWS S3, MinIO, DigitalOcean Spaces, and other S3-compatible
providers that do not have a dedicated Files SDK adapter:

```ts
import { s3 } from "files-sdk/s3";

import env from "./env";

export default runtimeConfig({
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
	},
});
```

### Cloudflare R2 (Production)

Use Files SDK's dedicated R2 adapter:

```ts
import { r2 } from "files-sdk/r2";

import env from "./env";

export default runtimeConfig({
	storage: {
		basePath: "/api",
		adapter: r2({
			bucket: env.R2_BUCKET,
			accountId: env.R2_ACCOUNT_ID,
			accessKeyId: env.R2_ACCESS_KEY_ID,
			secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		}),
	},
});
```

### Upload Fields

```ts
avatar: f.upload({
  to: "assets",          // target upload collection
  mimeTypes: ["image/*"], // allowed MIME types
  maxSize: 5_000_000,     // max file size in bytes (5MB)
}),
```

### Client Upload

```ts
const asset = await client.collections.assets.upload(file, {
	onProgress: (percent) => console.log(`${percent}%`),
});

const assets = await client.collections.assets.uploadMany(files, {
	onProgress: (percent) => console.log(`${percent}%`),
});
```

Failed uploads reject with `UploadError` (from `questpie/client`) carrying the HTTP status and server message.

### Signed URLs (Private Files)

Upload rows carry a `url` populated automatically on read: `visibility: "public"` files get a plain collection-scoped URL (`{basePath}/{collection}/files/{key}`); `"private"` files get an HMAC-signed token appended (`?token=...`), signed with `app.config.secret` and expiring after `storage.signedUrlExpiration` (default `3600` seconds):

```ts
export default runtimeConfig({
	storage: {
		basePath: "/api",
		signedUrlExpiration: 900, // 15 minutes
	},
});
```

Serving stays collection-scoped, the file route verifies the token **and** the collection's `serve` access rule. To mint URLs manually (custom emails, server-rendered pages):

```ts
import { buildStorageFileUrl, generateSignedUrlToken } from "questpie/storage";

const token = await generateSignedUrlToken(asset.key, app.config.secret!, 900, "assets");
const url = buildStorageFileUrl(app.config.app.url, "/api", "assets", asset.key, token);
```

(`verifySignedUrlToken` is the verification half the serve route runs, you rarely call it yourself.)

## Queue

Background jobs via [pg-boss](https://github.com/timgit/pg-boss), BullMQ, or a custom queue adapter.

### Configuration

```ts
import { runtimeConfig } from "questpie/app";
import { pgBossAdapter } from "questpie/adapters/pg-boss";

import env from "./env";

export default runtimeConfig({
	queue: {
		adapter: pgBossAdapter({
			connectionString: env.DATABASE_URL,
		}),
	},
});
```

### BullMQ

`connection` is BullMQ's `ConnectionOptions`, pass a `url`, the discrete `{ host, port, password }` ioredis fields, or an existing ioredis instance:

```ts
import { runtimeConfig } from "questpie/app";
import { bullMQAdapter } from "questpie/adapters/bullmq";

import env from "./env";

export default runtimeConfig({
	queue: {
		adapter: bullMQAdapter({
			connection: { url: env.REDIS_URL },
			queuePrefix: "my-app",
		}),
	},
});
```

The built-in BullMQ adapter targets open-source BullMQ and does not expose per-group FIFO behavior. Use a native grouped queue adapter if the workload needs one active job per group with cross-group parallelism.

### Publishing Jobs

The `queue` context object is fully typed:

```ts
handler: async ({ queue }) => {
	await queue.sendConfirmation.publish({
		appointmentId: "abc",
		customerId: "def",
	});
};
```

## Realtime

SSE-based live updates.

### pgNotify (Single Instance)

Uses PostgreSQL `LISTEN/NOTIFY`. Best for single-server deployments:

```ts
import { runtimeConfig } from "questpie/app";
import { pgNotifyAdapter } from "questpie/adapters/pg-notify";

import env from "./env";

export default runtimeConfig({
	realtime: {
		adapter: pgNotifyAdapter({
			connectionString: env.DATABASE_URL,
		}),
	},
});
```

### Redis Streams (Multi-Instance)

Required for horizontal scaling across multiple server instances. Takes a connected, redis-shaped `client` (the node-redis command surface: `xAdd`, `xReadGroup`, `xGroupCreate`, `xAck`), not a URL:

```ts
import { createClient } from "redis";
import { runtimeConfig } from "questpie/app";
import { redisStreamsAdapter } from "questpie/adapters/redis-streams";

import env from "./env";

const redis = createClient({ url: env.REDIS_URL });
await redis.connect();

export default runtimeConfig({
	realtime: {
		adapter: redisStreamsAdapter({ client: redis }),
	},
});
```

### When to Use Which

| Adapter               | Use Case                                              |
| --------------------- | ----------------------------------------------------- |
| `pgNotifyAdapter`     | Single server, development, simple deployments        |
| `redisStreamsAdapter` | Multiple servers, horizontal scaling, high throughput |

## Search

Full-text search via PostgreSQL (no extra service). The adapter goes directly on the `search` key:

```ts
import { runtimeConfig } from "questpie/app";
import { createPostgresSearchAdapter } from "questpie/adapters/postgres-search";

export default runtimeConfig({
	search: createPostgresSearchAdapter(), // pg_trgm + tsvector FTS
});
```

### Semantic Search (pgvector + Embeddings)

`createPgVectorSearchAdapter` wraps the Postgres adapter and adds an `embedding` vector column + cosine-distance search. It needs the `pgvector` extension (`CREATE EXTENSION "vector";`, the adapter ships its own migrations) and an embedding provider:

```ts
import { runtimeConfig } from "questpie/app";
import { createPgVectorSearchAdapter } from "questpie/adapters/pgvector-search";
import { createOpenAIEmbeddingProvider } from "questpie/search";

import env from "./env";

export default runtimeConfig({
	search: createPgVectorSearchAdapter({
		embeddingProvider: createOpenAIEmbeddingProvider({
			apiKey: env.OPENAI_API_KEY,
			model: "text-embedding-3-small",
		}),
		// Hybrid scoring weights (defaults shown)
		lexicalWeight: 0.4,
		semanticWeight: 0.6,
		indexType: "ivfflat", // or "hnsw"
	}),
});
```

Search modes: `lexical` (FTS + trigram), `semantic` (pure vector similarity), `hybrid` (weighted combination). Embeddings are generated on `index()`; if generation fails, the row still indexes for lexical search.

For non-OpenAI providers, `createCustomEmbeddingProvider({ name, model, dimensions, generate })` wraps any embedding function.

## Email

Transactional email with typed templates.

### SMTP (Production)

`secure` follows the SMTP convention: `false` for STARTTLS on port 587 (most providers), `true` for implicit TLS on port 465.

```ts
import { runtimeConfig } from "questpie/app";
import { SmtpAdapter } from "questpie/adapters/smtp";

import env from "./env";

export default runtimeConfig({
	email: {
		adapter: new SmtpAdapter({
			transport: {
				host: env.SMTP_HOST,
				port: 587,
				secure: false, // STARTTLS; use secure: true with port 465
			},
		}),
	},
});
```

### Console (Development)

Logs emails to console instead of sending:

```ts
import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";

export default runtimeConfig({
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
});
```

### Resend (HTTP API)

For [Resend](https://resend.com) and Resend-compatible providers, no SMTP credentials needed:

```ts
import { runtimeConfig } from "questpie/app";
import { resendAdapter } from "questpie/adapters/resend";

import env from "./env";

export default runtimeConfig({
	email: {
		adapter: resendAdapter({
			apiKey: env.RESEND_API_KEY,
			// baseUrl: "https://api.resend.com",  // override for compatible providers
		}),
	},
});
```

### Plunk (HTTP API)

For [Plunk](https://www.useplunk.com) transactional email (also self-hosted):

```ts
import { runtimeConfig } from "questpie/app";
import { plunkAdapter } from "questpie/adapters/plunk";

import env from "./env";

export default runtimeConfig({
	email: {
		adapter: plunkAdapter({
			apiKey: env.PLUNK_API_KEY, // secret key, public keys only track events
			// baseUrl: "https://next-api.useplunk.com",  // override for self-hosted
		}),
	},
});
```

### Custom Mail Adapter

For any other provider, extend the `MailAdapter` base class from `questpie/mailer` (implement `send(options)`) and pass an instance as `email.adapter`.

### Environment-Based Switching

```ts
email: {
  adapter:
    env.NODE_ENV === "development"
      ? new ConsoleAdapter({ logHtml: false })
      : new SmtpAdapter({
          transport: {
            host: env.SMTP_HOST,
            port: 587,
            secure: false, // STARTTLS; use secure: true with port 465
          },
        }),
}
```

### Defining Templates

Templates go in the `emails/` directory:

```ts
// emails/welcome.ts
import { email } from "questpie/services";
import z from "zod";

export default email({
	name: "welcome",
	schema: z.object({
		userName: z.string(),
		loginUrl: z.string(),
	}),
	handler: ({ input }) => ({
		subject: `Welcome, ${input.userName}!`,
		html: `<h1>Welcome!</h1><p><a href="${input.loginUrl}">Sign in here</a></p>`,
	}),
});
```

### Sending

```ts
handler: async ({ email }) => {
	await email.sendTemplate({
		template: "welcome",
		input: { userName: "John", loginUrl: "https://app.example.com/login" },
		to: "john@example.com",
	});
};
```

## KV Store

Key-value storage for caching, rate limiting, ephemeral data.

### Redis

`client` accepts a node-redis client or a `() => client` provider (resolved + cached on first use):

```ts
import { createClient } from "redis";
import { runtimeConfig } from "questpie/app";
import { redisKVAdapter } from "questpie/adapters/redis-kv";

import env from "./env";

async function getRedis() {
	const redis = createClient({ url: env.REDIS_URL });
	await redis.connect();
	return redis;
}

export default runtimeConfig({
	kv: {
		adapter: redisKVAdapter({ client: getRedis, keyPrefix: "my-app:" }),
		defaultTtl: 3600,
	},
});
```

### Custom Adapter

Implement the `KVAdapter` interface from `questpie/kv` and pass an instance:

```ts
import { runtimeConfig } from "questpie/app";
import type { KVAdapter } from "questpie/kv";

const myKvAdapter: KVAdapter = {
	async get(key) {
		/* ... */ return null;
	},
	async set(key, value, ttl) {
		/* ... */
	},
	async delete(key) {
		/* ... */
	},
	async has(key) {
		/* ... */ return false;
	},
	async clear() {
		/* ... */
	},
};

export default runtimeConfig({
	kv: {
		adapter: myKvAdapter,
		defaultTtl: 3600,
	},
});
```

### In-Memory Default

```ts
export default runtimeConfig({
	kv: {
		defaultTtl: 3600,
	},
});
```

### API

```ts
handler: async ({ kv }) => {
	// Set with TTL (seconds)
	await kv.set("session:abc", JSON.stringify(data), 3600);

	// Get
	const value = await kv.get("session:abc");

	// Delete
	await kv.delete("session:abc");
};
```

## Logger

Structured logging via [Pino](https://getpino.io).

### Usage

```ts
handler: async ({ logger }) => {
	logger.info("Processing request");
	logger.error("Request failed", { err: error });
	logger.debug("User action", { userId, action });
};
```

### Log Levels

| Level   | Usage                 |
| ------- | --------------------- |
| `trace` | Detailed debugging    |
| `debug` | Development debugging |
| `info`  | Normal operations     |
| `warn`  | Potential issues      |
| `error` | Errors                |
| `fatal` | Critical failures     |

### Structured Data

Pass the message first, then structured data as additional arguments:

```ts
logger.info("Appointment created", {
	appointmentId: "abc",
	action: "created",
	barberId: "def",
});
```

## OpenAPI

Auto-generates OpenAPI 3.1 spec from your schema.

### Setup

```bash
bun add @questpie/openapi
```

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/modules/admin";
import { openApiModule } from "@questpie/openapi/modules/openapi";

export default [adminModule, openApiModule] as const;
```

`openApiModule` carries its codegen plugin, do not also add `openApiPlugin()` to `questpie.config.ts` unless you deliberately omit the module.

Configure it in `config/openapi.ts`:

```ts
import { openApiConfig } from "@questpie/openapi/server";

export default openApiConfig({
	info: { title: "My API", version: "1.0.0" },
});
```

Then run codegen:

```bash
bunx questpie generate
```

### Configuration Options

```ts
openApiConfig({
	info: {
		title: "My API",
		version: "1.0.0",
		description: "Backend for my app",
	},
	servers: [{ url: "https://api.example.com", description: "Production" }],
	basePath: "/api",
	exclude: {
		collections: ["_internal_logs"],
		globals: ["_cache"],
	},
	auth: true, // include auth endpoints
	search: true, // include search endpoints
	scalar: {
		theme: "purple", // Scalar UI theme
	},
	specPath: "openapi.json", // custom spec route
	docsPath: "docs", // custom docs route
});
```

### Routes

| Route                   | Description                      |
| ----------------------- | -------------------------------- |
| `GET /api/openapi.json` | OpenAPI 3.1 JSON spec            |
| `GET /api/docs`         | Scalar interactive API reference |

### What Gets Documented

| Source      | Documented As                                           |
| ----------- | ------------------------------------------------------- |
| Collections | CRUD endpoints (`GET`, `POST`, `PUT`, `DELETE`)         |
| Globals     | Read/update endpoints (`GET`, `PUT`)                    |
| Routes      | App route endpoints (`/api/{path}`)                     |
| Auth        | Sign-in, sign-up, session endpoints (when `auth: true`) |
| Search      | Search endpoints (when `search: true`)                  |

### Manual Route Approach

Instead of the module, create route files directly:

```ts
// routes/openapi.json.ts
import { openApiRoute } from "@questpie/openapi/server";

export default openApiRoute({
	info: { title: "My API", version: "1.0.0" },
});
```

```ts
// routes/docs.ts
import { docsRoute } from "@questpie/openapi/server";

export default docsRoute({
	scalar: { theme: "purple" },
});
```

### Programmatic Access

```ts
import { generateOpenApiSpec } from "@questpie/openapi/server";

const spec = generateOpenApiSpec(app, {
	info: { title: "My API", version: "1.0.0" },
});
```

## Migrations CLI

| Command                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `bunx questpie push`             | Direct schema sync (dev only, no migration file) |
| `bunx questpie migrate:create`   | Generate migration from schema diff              |
| `bunx questpie migrate`          | Run pending migrations                           |
| `bunx questpie migrate:down`     | Rollback last migration                          |
| `bunx questpie migrate:fresh`    | Drop all and re-run (DESTRUCTIVE)                |
| `bunx questpie migrate:reset`    | Reset migration tracking                         |
| `bunx questpie seed`             | Run seed files                                   |

## Complete Production Config Example

```ts
import { createClient } from "redis";
import { runtimeConfig } from "questpie/app";
import { pgBossAdapter } from "questpie/adapters/pg-boss";
import { pgNotifyAdapter } from "questpie/adapters/pg-notify";
import { redisKVAdapter } from "questpie/adapters/redis-kv";
import { SmtpAdapter } from "questpie/adapters/smtp";
import { s3 } from "files-sdk/s3";

import env from "./env";

async function getRedis() {
	const redis = createClient({ url: env.REDIS_URL });
	await redis.connect();
	return redis;
}

export default runtimeConfig({
	db: {
		url: env.DATABASE_URL,
	},
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
	},
	queue: {
		adapter: pgBossAdapter({
			connectionString: env.DATABASE_URL,
		}),
	},
	realtime: {
		adapter: pgNotifyAdapter({
			connectionString: env.DATABASE_URL,
		}),
	},
	email: {
		adapter: new SmtpAdapter({
			transport: {
				host: env.SMTP_HOST,
				port: 587,
				secure: false, // STARTTLS; use secure: true with port 465
			},
		}),
	},
	kv: {
		adapter: redisKVAdapter({ client: getRedis }),
		defaultTtl: 3600,
	},
	cli: {
		migrations: { directory: "./src/migrations" },
		seeds: { directory: "./src/seeds" },
	},
});
```

## Environment Variables Summary

| Variable             | Service                       | Required            |
| -------------------- | ----------------------------- | ------------------- |
| `DATABASE_URL`       | Database, Queue, Realtime     | Yes                 |
| `APP_URL`            | Auth, Email links             | Yes                 |
| `BETTER_AUTH_SECRET` | Auth sessions                 | Yes (production)    |
| `REDIS_URL`          | KV, Realtime (multi-instance) | No                  |
| `S3_BUCKET`          | Storage                       | No (if using local) |
| `S3_REGION`          | Storage                       | No                  |
| `S3_ACCESS_KEY`      | Storage                       | No                  |
| `S3_SECRET_KEY`      | Storage                       | No                  |
| `SMTP_HOST`          | Email                         | No                  |
| `SMTP_PORT`          | Email                         | No                  |
