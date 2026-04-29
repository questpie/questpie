# Infrastructure Adapters Reference

All adapter configurations for QUESTPIE production infrastructure.

## Database

PostgreSQL with Drizzle ORM. Configured in `questpie.config.ts`:

```ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	db: {
		url: process.env.DATABASE_URL || "postgres://localhost/myapp",
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

File storage via [Flydrive](https://flydrive.dev/).

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

Works with AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2:

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

## Queue

Background jobs via [pg-boss](https://github.com/timgit/pg-boss). Jobs stored in PostgreSQL -- no external queue service needed.

### Configuration

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

Required for horizontal scaling across multiple server instances:

```ts
import { redisStreamsAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	realtime: {
		adapter: redisStreamsAdapter({
			url: process.env.REDIS_URL,
		}),
	},
});
```

### When to Use Which

| Adapter               | Use Case                                              |
| --------------------- | ----------------------------------------------------- |
| `pgNotifyAdapter`     | Single server, development, simple deployments        |
| `redisStreamsAdapter` | Multiple servers, horizontal scaling, high throughput |

## Email

Transactional email with typed templates.

### SMTP (Production)

```ts
import { SmtpAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	email: {
		adapter: new SmtpAdapter({
			transport: {
				host: process.env.SMTP_HOST,
				port: parseInt(process.env.SMTP_PORT || "587"),
				secure: true,
			},
		}),
	},
});
```

### Console (Development)

Logs emails to console instead of sending:

```ts
import { ConsoleAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
});
```

### Environment-Based Switching

```ts
email: {
  adapter:
    process.env.NODE_ENV === "development"
      ? new ConsoleAdapter({ logHtml: false })
      : new SmtpAdapter({
          transport: {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            secure: true,
          },
        }),
}
```

### Defining Templates

Templates go in the `emails/` directory:

```ts
// emails/welcome.ts
import { email } from "questpie";
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
	await kv.set("session:abc", JSON.stringify(data), { ttl: 3600 });

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
	logger.error({ err: error }, "Request failed");
	logger.debug({ userId, action }, "User action");
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

Pass objects as the first argument:

```ts
logger.info(
	{
		appointmentId: "abc",
		action: "created",
		barberId: "def",
	},
	"Appointment created",
);
```

## OpenAPI

Auto-generates OpenAPI 3.1 spec from your schema.

### Setup

```bash
bun add @questpie/openapi
```

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [adminModule, openApiModule] as const;
```

Configure it in `config/openapi.ts`:

```ts
import { openApiConfig } from "@questpie/openapi";

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
import { openApiRoute } from "@questpie/openapi";

export default openApiRoute({
	info: { title: "My API", version: "1.0.0" },
});
```

```ts
// routes/docs.ts
import { docsRoute } from "@questpie/openapi";

export default docsRoute({
	scalar: { theme: "purple" },
});
```

### Programmatic Access

```ts
import { generateOpenApiSpec } from "@questpie/openapi";

const spec = generateOpenApiSpec(app, {
	info: { title: "My API", version: "1.0.0" },
});
```

## Migrations CLI

| Command                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `bunx questpie push`             | Direct schema sync (dev only, no migration file) |
| `bunx questpie migrate:generate` | Generate migration from schema diff              |
| `bunx questpie migrate:up`       | Run pending migrations                           |
| `bunx questpie migrate:down`     | Rollback last migration                          |
| `bunx questpie migrate:fresh`    | Drop all and re-run (DESTRUCTIVE)                |
| `bunx questpie migrate:reset`    | Reset migration tracking                         |
| `bunx questpie seed`             | Run seed files                                   |

## Complete Production Config Example

```ts
import {
	runtimeConfig,
	pgBossAdapter,
	pgNotifyAdapter,
	SmtpAdapter,
} from "questpie";
import { S3Driver } from "flydrive/drivers/s3";

export default runtimeConfig({
	db: {
		url: process.env.DATABASE_URL!,
	},
	storage: {
		basePath: "/api",
		driver: new S3Driver({
			bucket: process.env.S3_BUCKET!,
			region: process.env.S3_REGION!,
			accessKeyId: process.env.S3_ACCESS_KEY!,
			secretAccessKey: process.env.S3_SECRET_KEY!,
		}),
	},
	queue: {
		adapter: pgBossAdapter({
			connectionString: process.env.DATABASE_URL!,
		}),
	},
	realtime: {
		adapter: pgNotifyAdapter({
			connectionString: process.env.DATABASE_URL!,
		}),
	},
	email: {
		adapter: new SmtpAdapter({
			transport: {
				host: process.env.SMTP_HOST!,
				port: parseInt(process.env.SMTP_PORT || "587"),
				secure: true,
			},
		}),
	},
	kv: {
		adapter: myKvAdapter,
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
