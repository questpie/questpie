# questpie

Server-first TypeScript backend framework with a proxy-based field builder, collections, globals, standalone RPC, background jobs, and a generated REST API.

> **Active Development** — QUESTPIE is a bootstrapped, community-driven framework under active development. The API may still change between releases, but we follow semantic versioning. Full stability is targeted for v3.

## Features

- **Field Builder** — Proxy-based `f` factory: `f.text()`, `f.relation()`, `f.upload()`, `f.blocks()` — produces Drizzle columns, Zod schemas, typed operators, and admin metadata from a single definition
- **Custom Fields & Operators** — `field<TConfig, TValue>()` and `operator<TValue>()` factories for fully custom field types
- **Collections & Globals** — Fluent builder chain with hooks, access control, indexes, relations, localization
- **Standalone RPC** — End-to-end type-safe server functions via `rpc()`, routed at `/rpc/<path>`
- **Reactive Fields** — Server-evaluated `hidden`, `readOnly`, `disabled`, `compute`, and dynamic `options`
- **Introspection** — Serializable field metadata, relation info, reactive config for admin consumption
- **Background Jobs** — `q.job()` with Zod schema validation, pg-boss or Cloudflare Queues adapters
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

### 1. Create Builder

```ts
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";

export const qb = q.use(adminModule);
```

### 2. Define Collections

```ts
const posts = qb.collection("posts")
  .fields((f) => ({
    title: f.text({ label: "Title", required: true, maxLength: 255 }),
    content: f.richText({ label: "Content", localized: true }),
    published: f.boolean({ label: "Published", default: false }),
    category: f.select({ label: "Category", options: ["news", "blog", "tutorial"] }),
    cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
    author: f.relation({ to: "users", required: true }),
    publishedAt: f.date(),
  }))
  .title(({ f }) => f.title)
  .admin(({ c }) => ({
    label: { en: "Posts" },
    icon: c.icon("ph:article"),
  }))
  .list(({ v }) => v.table({}))
  .form(({ v, f }) => v.form({
    sidebar: { position: "right", fields: [f.published, f.cover] },
    fields: [f.title, f.content, f.category, f.author, f.publishedAt],
  }))
  .hooks({
    afterChange: async ({ data, operation, app }) => {
      if (operation === "create") {
        await app.queue.notifySubscribers.publish({ postId: data.id });
      }
    },
  });
```

### 3. Define Globals

```ts
const siteSettings = qb.global("site_settings")
  .fields((f) => ({
    siteName: f.text({ label: "Site Name", required: true }),
    description: f.textarea({ label: "Description" }),
    logo: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
  }))
  .admin(({ c }) => ({
    label: { en: "Site Settings" },
    icon: c.icon("ph:gear-six"),
  }));
```

### 4. Build CMS

```ts
export const cms = qb
  .collections({ posts })
  .globals({ siteSettings })
  .auth({
    emailAndPassword: { enabled: true },
    baseURL: process.env.APP_URL!,
    basePath: "/api/cms/auth",
    secret: process.env.AUTH_SECRET!,
  })
  .build({
    app: { url: process.env.APP_URL! },
    db: { url: process.env.DATABASE_URL! },
    storage: { basePath: "/api/cms" },
    migrations,
  });

export type AppCMS = typeof cms;
```

### 5. Create Route Handler

```ts
import { createFetchHandler } from "questpie";

const handler = createFetchHandler(cms, {
  basePath: "/api/cms",
  rpc: appRpc,
});
```

### 6. Run Migrations

```bash
bun questpie migrate:generate
bun questpie migrate
```

## Field Builder

Fields are defined via the `f` proxy inside `.fields()`. Each field produces a Drizzle column, Zod validation, typed query operators, and serializable metadata:

```ts
qb.collection("products").fields((f) => ({
  name: f.text({ required: true, maxLength: 255 }),
  price: f.number({ required: true }),
  description: f.richText({ localized: true }),
  sku: f.text({ required: true, input: "optional" }),   // auto-generated
  inStock: f.boolean({ default: true }),
  category: f.select({ options: ["electronics", "clothing", "food"] }),
  tags: f.multiSelect({ options: ["featured", "sale", "new"] }),
  image: f.upload({ to: "assets", mimeTypes: ["image/*"], maxSize: 5_000_000 }),
  brand: f.relation({ to: "brands" }),
  publishedAt: f.datetime(),
  metadata: f.json(),
  email: f.email({ required: true }),
  website: f.url(),
  color: f.color(),
  slug: f.slug({ from: "name" }),
}));
```

### Nested Fields

```ts
address: f.object({
  label: "Address",
  fields: () => ({
    street: f.text({ required: true }),
    city: f.text({ required: true }),
    zip: f.text(),
    country: f.select({ options: ["US", "UK", "DE"] }),
  }),
})
```

### Array Fields

```ts
socialLinks: f.array({
  of: f.object({
    fields: () => ({
      platform: f.select({ options: ["twitter", "github", "linkedin"] }),
      url: f.url({ required: true }),
    }),
  }),
  maxItems: 5,
  meta: { admin: { orderable: true } },
})
```

### Relations

```ts
// Belongs-to
author: f.relation({ to: "users", required: true, onDelete: "cascade" })

// Has-many through junction
services: f.relation({
  to: "services",
  hasMany: true,
  through: "barberServices",
  sourceField: "barber",
  targetField: "service",
})
```

### Blocks (Page Builder)

```ts
body: f.blocks({ label: "Content", localized: true })
```

### Custom Fields

```ts
import { field } from "questpie";

const slugField = field<SlugConfig, string>()({
  type: "slug",
  _value: undefined as unknown as string,
  toColumn: (name, config) => varchar(name, { length: 255 }),
  toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
  getOperators: (config) => ({
    column: stringColumnOperators,
    jsonb: stringJsonbOperators,
  }),
  getMetadata: (config) => ({
    type: "slug",
    label: config.label,
    required: config.required ?? false,
  }),
});

// Register on builder
const qb = q.fields({ slug: slugField });

// Use in collections
.fields((f) => ({ slug: f.slug({ required: true }) }))
```

## Standalone RPC

Type-safe server functions independent from CRUD:

```ts
import { rpc } from "questpie";

const r = rpc();

export const getStats = r.fn({
  schema: z.object({ period: z.enum(["day", "week", "month"]) }),
  handler: async ({ input, app }) => {
    const count = await app.api.collections.posts.count({
      where: { createdAt: { gte: startDate(input.period) } },
    });
    return { posts: count };
  },
});

// Register as router
export const appRpc = r.router({ ...adminRpc, getStats });
export type AppRpc = typeof appRpc;
```

Client usage:

```ts
import { createClient } from "questpie/client";
const client = createClient<AppCMS, AppRpc>({ baseURL: "...", basePath: "/api/cms" });

const stats = await client.rpc.getStats({ period: "week" });
```

## Background Jobs

```ts
import { q } from "questpie";

const sendWelcomeEmail = q.job({
  name: "send-welcome-email",
  schema: z.object({ userId: z.string() }),
  handler: async ({ payload, app }) => {
    const user = await app.api.collections.users.findById({ id: payload.userId });
    await app.email.send({ to: user.email, subject: "Welcome!", text: "..." });
  },
});

// Register
const cms = qb.jobs({ sendWelcomeEmail }).build({ ... });

// Dispatch
await cms.queue.sendWelcomeEmail.publish({ userId: "123" });

// Worker
await cms.queue.listen();
```

## CRUD API

```ts
// Create
const post = await cms.api.collections.posts.create({
  title: "Hello World",
  content: "...",
});

// Find many (paginated)
const { docs, totalDocs } = await cms.api.collections.posts.find({
  where: { published: { eq: true } },
  orderBy: { publishedAt: "desc" },
  limit: 10,
  with: { author: true },
});

// Find one
const post = await cms.api.collections.posts.findOne({
  where: { slug: { eq: "hello-world" } },
});

// Update
await cms.api.collections.posts.updateById({
  id: post.id,
  data: { title: "Updated" },
});

// Delete
await cms.api.collections.posts.deleteById({ id: post.id });

// Globals
const settings = await cms.api.globals.siteSettings.get();
await cms.api.globals.siteSettings.update({ data: { siteName: "New Name" } });
```

## Reactive Fields

Server-evaluated reactive behaviors in form config:

```ts
.form(({ v, f }) => v.form({
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
city: f.relation({
  to: "cities",
  options: {
    handler: async ({ data, search, ctx }) => {
      const cities = await ctx.db.query.cities.findMany({
        where: { countryId: data.country },
      });
      return { options: cities.map((c) => ({ value: c.id, label: c.name })) };
    },
    deps: ({ data }) => [data.country],
  },
})
```

## CLI

```bash
bun questpie migrate:generate   # Generate migration from schema changes
bun questpie migrate            # Run pending migrations
bun questpie migrate:down       # Rollback last batch
bun questpie migrate:status     # Show migration status
bun questpie migrate:reset      # Rollback all migrations
bun questpie migrate:fresh      # Reset + run all migrations
bun questpie push               # Push schema directly (dev only)
bun questpie seed               # Run pending seeds
bun questpie seed:generate      # Generate a new seed file
```

Config file (`questpie.config.ts`):

```ts
import { cms } from "@/questpie/server/cms";
export default {
  app: cms,
  cli: { migrations: { directory: "./src/migrations" } },
};
```

## Framework Adapters

| Adapter | Package            | Server                                              |
| ------- | ------------------ | --------------------------------------------------- |
| Hono    | `@questpie/hono`   | `questpieHono(cms, { basePath, rpc })`              |
| Elysia  | `@questpie/elysia` | `questpieElysia(cms, { basePath, rpc })`            |
| Next.js | `@questpie/next`   | `questpieNextRouteHandlers(cms, { basePath, rpc })` |

Or use `createFetchHandler` directly with any framework that supports the Fetch API.

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
