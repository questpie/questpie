# questpie

Server-first TypeScript backend framework with a proxy-based field builder, collections, globals, standalone routes, background jobs, and a generated REST API.

> **Active Development** — QUESTPIE is a bootstrapped, community-driven framework under active development. The API may still change between releases, but we follow semantic versioning. Full stability is targeted for v3.

## Features

- **Field Builder** — Proxy-based `f` factory: `f.text()`, `f.relation()`, `f.upload()`, `f.blocks()` — produces Drizzle columns, Zod schemas, typed operators, and admin metadata from a single definition
- **Custom Fields & Operators** — `field<TConfig, TValue>()` and `operator<TValue>()` factories for fully custom field types
- **Collections & Globals** — Fluent builder chain with hooks, access control, indexes, relations, localization
- **Standalone Routes** — End-to-end type-safe server routes via `route()`, auto-discovered by file convention
- **Reactive Fields** — Server-evaluated `hidden`, `readOnly`, `disabled`, `compute`, and dynamic `options`
- **Introspection** — Serializable field metadata, relation info, reactive config for admin consumption
- **Background Jobs** — `job()` with Zod schema validation, pg-boss or Cloudflare Queues adapters
- **Authentication** — Better Auth integration with plugins (admin, organization, 2FA, API keys)
- **Storage** — Flydrive-based (S3, R2, GCS, local) with streaming uploads and typed upload collections
- **Realtime** — PostgreSQL NOTIFY/LISTEN + Redis Streams with SSE delivery
- **Email** — SMTP + console adapters with template support
- **Search** — Full-text search with reindex support
- **Access Control** — Operation-level and field-level permissions
- **Server-Driven Admin** — Sidebar, dashboard, branding, component references all defined server-side

## Installation

```bash
bun add questpie drizzle-orm@beta zod
```

## Quick Start

### 1. Define Collections

```ts
// src/questpie/server/collections/posts.ts
import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).label("Title").required(),
		content: f.richText().label("Content").localized(),
		published: f.boolean().label("Published").default(false),
		category: f
			.select([
				{ value: "news", label: "News" },
				{ value: "blog", label: "Blog" },
				{ value: "tutorial", label: "Tutorial" },
			])
			.label("Category"),
		cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
		author: f.relation("users").required(),
		publishedAt: f.date(),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Posts" },
		icon: c.icon("ph:article"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: { position: "right", fields: [f.published, f.cover] },
			fields: [f.title, f.content, f.category, f.author, f.publishedAt],
		}),
	)
	.hooks({
		afterChange: async ({ data, operation, app }) => {
			if (operation === "create") {
				await app.queue.notifySubscribers.publish({ postId: data.id });
			}
		},
	});
```

### 2. Define Globals

```ts
// src/questpie/server/globals/site-settings.ts
import { global } from "#questpie/factories";

export const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text().label("Site Name").required(),
		description: f.textarea().label("Description"),
		logo: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
	}))
	.admin(({ c }) => ({
		label: { en: "Site Settings" },
		icon: c.icon("ph:gear-six"),
	}));
```

### 3. Configure the App

```ts
// src/questpie/server/questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: process.env.APP_URL! },
	db: { url: process.env.DATABASE_URL! },
	secret: process.env.AUTH_SECRET!,
	storage: { basePath: "/api" },
});
```

Modules are registered in a separate file:

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

### 4. Auth Config

```ts
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie";

export default authConfig({
	emailAndPassword: { enabled: true },
});
```

### 5. Generate & Mount

Run codegen to produce the typed app instance, then mount:

```ts
// Route handler
import { app } from "#questpie";
import { createFetchHandler } from "questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
```

### 6. Run Migrations

```bash
bun questpie migrate:generate
bun questpie migrate
```

## Field Builder

Fields are defined via the `f` proxy inside `.fields()`. Each field produces a Drizzle column, Zod validation, typed query operators, and serializable metadata:

```ts
collection("products").fields(({ f }) => ({
	name: f.text(255).required(),
	price: f.number().required(),
	description: f.richText().localized(),
	sku: f.text(255).required().inputOptional(), // auto-generated
	inStock: f.boolean().default(true),
	category: f.select([
		{ value: "electronics", label: "Electronics" },
		{ value: "clothing", label: "Clothing" },
		{ value: "food", label: "Food" },
	]),
	tags: f
		.select([
			{ value: "featured", label: "Featured" },
			{ value: "sale", label: "Sale" },
			{ value: "new", label: "New" },
		])
		.array(),
	image: f.upload({ to: "assets", mimeTypes: ["image/*"], maxSize: 5_000_000 }),
	brand: f.relation("brands"),
	publishedAt: f.datetime(),
	metadata: f.json(),
	email: f.email().required(),
	website: f.url(),
	slug: f.text(160).inputOptional(),
}));
```

### Nested Fields

```ts
address: f.object({
	street: f.text().required(),
	city: f.text().required(),
	zip: f.text(),
	country: f.select([
		{ value: "US", label: "United States" },
		{ value: "UK", label: "United Kingdom" },
		{ value: "DE", label: "Germany" },
	]),
}).label("Address");
```

### Array Fields

```ts
socialLinks: f.object({
	platform: f.select([
		{ value: "twitter", label: "Twitter" },
		{ value: "github", label: "GitHub" },
		{ value: "linkedin", label: "LinkedIn" },
	]),
	url: f.url().required(),
})
	.array()
	.maxItems(5);
```

### Relations

```ts
// Belongs-to
author: f.relation("users").required().onDelete("cascade");

// Has-many through junction
services: f.relation("services").manyToMany({
	through: "barberServices",
	sourceField: "barber",
	targetField: "service",
});
```

### Blocks (Page Builder)

```ts
body: f.blocks().label("Content").localized();
```

### Custom Fields

Custom fields are implemented as module-provided field types and exposed through codegen. Once a module registers a field type, user code consumes it from the generated `#questpie/factories` import alongside built-in factories.

## Standalone Routes

Type-safe server routes via file convention:

```ts
// src/questpie/server/routes/get-stats.ts
import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week", "month"]) }))
	.handler(async ({ input, collections }) => {
		const count = await collections.posts.count({
			where: { createdAt: { gte: startDate(input.period) } },
		});
		return { posts: count };
	});
```

Routes are auto-discovered by codegen and available at `/api/<name>`.

## Background Jobs

```ts
// src/questpie/server/jobs/send-welcome-email.ts
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-welcome-email",
	schema: z.object({ userId: z.string() }),
	handler: async ({ payload, collections, email }) => {
		const user = await collections.users.findOne({
			where: { id: payload.userId },
		});
		if (user)
			await email.send({ to: user.email, subject: "Welcome!", text: "..." });
	},
});

// Dispatch (via the generated app instance)
await app.queue.sendWelcomeEmail.publish({ userId: "123" });

// Worker
await app.queue.listen();
```

## CRUD API

```ts
// Create
const post = await app.collections.posts.create({
	title: "Hello World",
	content: "...",
});

// Find many (paginated)
const { docs, totalDocs } = await app.collections.posts.find({
	where: { published: { eq: true } },
	orderBy: { publishedAt: "desc" },
	limit: 10,
	with: { author: true },
});

// Find one
const post = await app.collections.posts.findOne({
	where: { slug: { eq: "hello-world" } },
});

// Update
await app.collections.posts.updateById({
	id: post.id,
	data: { title: "Updated" },
});

// Delete
await app.collections.posts.deleteById({ id: post.id });

// Globals
const settings = await app.globals.siteSettings.get();
await app.globals.siteSettings.update({ siteName: "New Name" });
```

## Reactive Fields

Server-evaluated reactive behaviors in form config:

```ts
.form(({ v, f }) => v.collectionForm({
  fields: [
    f.title,
    {
      field: f.slug,
      compute: {
        handler: ({ data }) => slugify(data.title),
        deps: ({ data }) => [data.title, data.slug],
        debounce: 300,
      },
    },
    {
      field: f.publishedAt,
      hidden: ({ data }) => !data.published,
    },
    {
      field: f.reason,
      readOnly: ({ data }) => data.status !== "cancelled",
    },
  ],
}))
```

Dynamic options for select/relation:

```ts
city: f.relation("cities").admin({
	options: {
		handler: async ({ data, search, ctx }) => {
			const cities = await ctx.db.query.cities.findMany({
				where: { countryId: data.country },
			});
			return { options: cities.map((c) => ({ value: c.id, label: c.name })) };
		},
		deps: ({ data }) => [data.country],
	},
});
```

## CLI

```bash
bun questpie add <type> <name>  # Scaffold a new entity (collection, seed, migration, etc.)
bun questpie add --list         # List all available scaffold types
bun questpie generate           # Regenerate .generated/index.ts
bun questpie migrate:generate   # Generate migration from schema diff
bun questpie migrate            # Run pending migrations
bun questpie migrate:down       # Rollback last batch
bun questpie migrate:status     # Show migration status
bun questpie migrate:reset      # Rollback all migrations
bun questpie migrate:fresh      # Reset + run all migrations
bun questpie push               # Push schema directly (dev only)
bun questpie seed               # Run pending seeds
```

CLI config (migrations directory etc.) is set inside `runtimeConfig()`:

```ts
export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	cli: { migrations: { directory: "./src/migrations" } },
});
```

## Framework Adapters

| Adapter | Package            | Server                                         |
| ------- | ------------------ | ---------------------------------------------- |
| Hono    | `@questpie/hono`   | `questpieHono(app, { basePath })`              |
| Elysia  | `@questpie/elysia` | `questpieElysia(app, { basePath })`            |
| Next.js | `@questpie/next`   | `questpieNextRouteHandlers(app, { basePath })` |

Or use `createFetchHandler` directly with any framework that supports the Fetch API.

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
