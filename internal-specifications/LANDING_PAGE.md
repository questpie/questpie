# QUESTPIE CMS - Landing Page Specification

Type-safe, modular backend for content-driven applications. Built on Drizzle, Better Auth, and modern TypeScript.

//some mototo we have - Don't reinvent the wheel we use what community knows the best, and do as little abstraction as possible, while enhancing dx.

---

## Goals

- **Backend-first**: Focus on type-safe backend, not UI (admin is WIP).
- **Drive to docs**: Primary CTA is documentation—get developers exploring.
- **Show, don't tell**: Real code snippets demonstrating composability and type safety.
- **Native integrations**: We don't reinvent—Drizzle for ORM, Better Auth for auth, react-email for templates.
- **Modular by design**: Compose type-safe modules, distribute via npm, reuse across projects.

---

## Target Audience

- **TypeScript developers** building content-heavy applications (blogs, e-commerce, SaaS dashboards).
- **Teams wanting alternatives** to Strapi, Payload, or Sanity.
- **Developers who value**:
  - Type safety from DB to client
  - Framework flexibility (Elysia, Hono, Next.js, TanStack Start)
  - No vendor lock-in (self-hosted PostgreSQL)

---

## Hero Section

**Headline:**
```
Type-Safe Backend for Content-Driven Apps
```

**Subheadline:**
```
Compose modular backends with Drizzle, Better Auth, and TypeScript.
Works with Elysia, Hono, Next.js, TanStack Start—or any framework.
```

**Primary CTA (large, prominent):**
```
[Read Documentation →]
```

**Secondary CTA:**
```
[View Examples]  [GitHub]
```

**Key highlights (bullet list):**
```
• Native Drizzle ORM + Better Auth integration
• Full type-safety from schema to client (eden, hono/hc)
• Batteries included: auth, email, queues, storage, realtime
• Modular: compose and distribute type-safe modules
• Framework-agnostic HTTP adapters
```

**Right side: Animated code preview**

Show progressive composition with animated typing:

```typescript
// Step 1: Start simple
export const cms = defineQCMS({ name: 'my-app' })
  .auth({ /* Better Auth options */ })
  .build({ db: { url: process.env.DATABASE_URL } })

// Step 2: Add collections (native Drizzle schema)
export const cms = defineQCMS({ name: 'my-app' })
  .collections({
    posts: defineCollection('posts').fields({
      title: varchar('title', { length: 255 }).notNull(),
      content: text('content'),
      publishedAt: timestamp('published_at', { mode: 'date' })
    })
  })
  .auth({ /* ... */ })
  .build({ /* ... */ })

// Step 3: Add background jobs
export const cms = defineQCMS({ name: 'my-app' })
  .collections({ posts, comments, authors })
  .jobs({
    sendWelcomeEmail: defineJob({
      name: 'send-welcome-email',
      schema: z.object({ userId: z.string(), email: z.string().email() }),
      handler: async ({ userId, email }) => {
        // Type-safe payload!
      }
    })
  })
  .auth({ /* ... */ })
  .build({ /* ... */ })

// Step 4: Fully composed, type-safe CMS
export const cms = defineQCMS({ name: 'my-app' })
  .collections({ posts, comments, authors, products, orders })
  .jobs({ sendWelcomeEmail, processOrder, generateReport })
  .globals({ siteSettings, theme })
  .auth({ /* Better Auth */ })
  .build({ db, email, queue, storage })

// Fully inferred types across your app!
type MyCMS = typeof cms
```

**Visual annotations:**
- Highlight TypeScript autocomplete hints
- Show how types flow through the system
- Emphasize incremental composition

---

## Why QUESTPIE? (Problem/Solution)

### The Problem

**Other CMSs force you to choose:**

1. **Vendor lock-in or DIY hell**
   - Proprietary platforms (Sanity, Contentful) lock you into their infrastructure.
   - DIY solutions (building on Next.js, Hono) mean wiring up auth, storage, queue, email from scratch—weeks of work.

2. **Framework fragmentation**
   - Payload only works with Next.js.
   - Strapi forces you into their runtime.
   - Sanity requires their hosted backend.

3. **Type-safety theater**
   - Many CMSs claim "type-safe" but reinvent Zod schemas instead of using native Drizzle.
   - Result: double maintenance, type mismatches, validation drift.

### QUESTPIE's Answer

**Native integrations, not reinvention:**

1. **Drizzle ORM is your schema**
   - No custom field types. Use Drizzle's native column definitions.
   - Relations, constraints, indexes—all Drizzle.
   - Type safety from DB to client, zero translation layer.

2. **Better Auth for authentication**
   - Email/password, OAuth (GitHub, Google, etc.)
   - Session management, CSRF protection, email verification—handled.
   - Extend with Better Auth plugins, not custom code.

3. **react-email for templates**
   - Write email templates in React.
   - Automatic HTML + plain-text rendering.
   - SMTP, Console, or custom adapters.

4. **pg-boss for queues (no Redis required)**
   - Background jobs run on PostgreSQL.
   - Type-safe payloads with Zod.
   - Retries, scheduling, cron—built-in.

5. **Framework-agnostic adapters**
   - One backend, any frontend: Elysia, Hono, Next.js, TanStack Start.
   - Standard HTTP API contract (see ADAPTER_STANDARD.md).
   - E2E compatibility tests ensure consistency.

---

## Core Features (Snippet-Driven)

### 1. Collections = Native Drizzle Schema + Hooks + Access + Validations

**No custom abstractions. Just Drizzle + powerful extensions.**

```typescript
import { defineCollection, getCMSFromContext } from '@questpie/cms/server'
import { varchar, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const postsCollection = defineCollection('posts')
  // Native Drizzle columns
  .fields({
    title: varchar('title', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    content: text('content'),
    publishedAt: timestamp('published_at', { mode: 'date' }),
    status: varchar('status', { length: 20 }).default('draft'),
    views: integer('views').default(0),
    authorId: varchar('author_id', { length: 255 }).notNull(),
    // JSON columns with type inference
    metadata: jsonb('metadata').$type<{ seo: { title: string; description: string } }>()
  })
  // Add localization (i18n) - only these fields are translatable
  .localized(['title', 'content'] as const)
  // Add access control
  .access({
    read: true,  // Anyone can read
    create: ({ user }) => !!user,  // Must be logged in to create
    update: async ({ user, row }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { authorId: user.id }  // Only author can edit
    },
    delete: 'admin',  // Only admins can delete (role check)
    // Field-level access
    fields: {
      authorId: {
        read: true,
        write: false,  // Set via hook, not directly writable
      },
    },
  })
  // Add validation (runtime validation on top of DB constraints)
  .validation({
    exclude: { id: true, createdAt: true, updatedAt: true },
    refine: {
      title: (s) => s.min(5, 'Title too short').max(255, 'Title too long'),
      slug: (s) => s.regex(/^[a-z0-9-]+$/, 'Invalid slug format'),
      content: (s) => s.min(100, 'Content too short'),
    },
  })
  // Add lifecycle hooks
  .hooks({
    beforeChange: async ({ data, operation, user }) => {
      // Auto-set authorId on create
      if (operation === 'create' && user) {
        data.authorId = user.id
      }
      // Auto-generate slug if not provided
      if (!data.slug && data.title) {
        data.slug = data.title.toLowerCase().replace(/\s+/g, '-')
      }
    },
    afterChange: async ({ data, operation }) => {
      const cms = getCMSFromContext()
      // Send notification, index for search, etc.
      if (operation === 'create') {
        await cms.queue['index-post'].publish({ postId: data.id })
      }
    },
    beforeDelete: async ({ data, cms }) => {
      // Prevent deletion of published posts
      if (data.status === 'published') {
        throw new Error('Cannot delete published posts')
      }
    },
  })
  // Add virtual fields (computed SQL expressions, queryable, i18n-aware)
  .virtuals(({ table, i18n }) => ({
    // SQL computed field using localized content
    excerpt: sql<string>`LEFT(${i18n.content}, 150) || '...'`,
    // Computed field using regular columns
    url: sql<string>`'/blog/' || ${table.slug}`,
  }))
```

**What this gives you:**
- Full Drizzle power: constraints, indexes, default values, JSON columns with type inference
- Access to native drizzle type-safe queries: `await db.select().from(postsCollection.table).where(eq(postsCollection.table.status, 'published'))`
- No translation layer between "CMS fields" and "database columns"
- **Access control**: Operation-level + field-level access, supports roles and where conditions
- **Hooks**: beforeOperation, beforeValidate, beforeChange, afterChange, beforeRead, afterRead, beforeDelete, afterDelete
- **Virtuals**: SQL computed fields with full Drizzle type inference
- **Localization**: Per-field i18n stored in separate table with automatic COALESCE fallback
- **Validation**: Runtime validation with exclude/refine pattern (works on top of DB constraints)
- **E2E type-safety**: All features work with TypeScript inference from DB to client

---

### 2. Relations = Drizzle Relations

```typescript
export const comments = defineCollection('comments')
  .fields({
    postId: varchar('post_id', { length: 255 }).notNull(),
    authorId: varchar('author_id', { length: 255 }).notNull(),
    content: text('content').notNull(),
  })
  .relations(({ one, table }) => ({
    // Many-to-one: each comment belongs to one post
    post: one('posts', {
      fields: [table.postId],
      references: ['id'],
    }),
    // Reference Better Auth's users table
    author: one('questpie_users', {
      fields: [table.authorId],
      references: ['id'],
    }),
  }))

export const posts = defineCollection('posts')
  .fields({ /* ... */ })
  .relations(({ many }) => ({
    // One-to-many: post has many comments
    comments: many('comments', {
      relationName: 'post_comments',
    }),
  }))

// Many-to-many example
export const posts = defineCollection('posts')
  .fields({ /* ... */ })
  .relations(({ manyToMany }) => ({
    tags: manyToMany('tags', {
      through: 'post_tags',  // junction table collection name
      sourceField: 'postId',
      targetField: 'tagId',
    }),
  }))
```

**What this gives you:**
- Native Drizzle relations (one, many, manyToMany)
- Type-safe joins: `await cms.collections.comments.find({ with: { post: true, author: true } })`
- Nested where conditions: `await cms.collections.posts.find({ where: { comments: { some: { content: { like: '%great post%' } } } } })`
- Relations to Better Auth tables (`questpie_users`) work seamlessly
- Full type inference for nested queries

---

### 3. Type-Safe Client (Unified CMS + RPC)

**Backend defines API contract. Client gets full type inference.**

```typescript
// Backend (Elysia)
import { Elysia } from 'elysia'
import { createCMSFetchHandler } from '@questpie/cms/elysia'
import { cms } from './cms'

export const app = new Elysia()
  .use(createCMSFetchHandler(cms, { basePath: '/cms' }))
  .get('/custom/route', () => ({ message: 'Hello from custom route!' }))
  .listen(3000)

export type App = typeof app
```

```typescript
// Frontend (unified client: CMS CRUD + Elysia RPC)
import { createClientFromEden } from '@questpie/elysia/client'
import type { App } from './server'
import type { cms } from './cms'

const client = createClientFromEden<App, typeof cms>({
  server: 'localhost:3000',
  basePath: '/cms',
})

// CMS CRUD operations - fully type-safe!
const { docs, totalDocs, page, totalPages } = await client.collections.posts.find({
  where: {
    status: 'published',  // ✓ Autocomplete knows valid fields
    publishedAt: { gte: new Date('2025-01-01') }
  },
  with: { author: true },  // Load relations
  limit: 10,
})

// docs is typed as Post[]
docs.forEach(post => {
  console.log(post.title, post.author.name)  // ✓ Knows all fields
})

// Elysia RPC for custom routes (if you added custom routes to app)
const result = await client.api.custom.route.get()
```

**Hono + hono/hc:**

```typescript
// Backend (Hono)
import { Hono } from 'hono'
import { createCMSFetchHandler } from '@questpie/cms/hono'
import { cms } from './cms'

const app = new Hono()
app.route('/cms', createCMSFetchHandler(cms))

export type AppType = typeof app
```

```typescript
// Frontend (unified client: CMS CRUD + Hono RPC)
import { createClientFromHono } from '@questpie/hono/client'
import type { AppType } from './server'
import type { cms } from './cms'

const client = createClientFromHono<AppType, typeof cms>({
  baseURL: 'http://localhost:3000',
  basePath: '/cms',
})

// CMS CRUD operations
const { docs } = await client.collections.posts.find({
  where: { status: 'published' },
  orderBy: { publishedAt: 'desc' },
})

// Hono RPC for custom routes (if you added custom routes to app)
const res = await client.api.custom.route.$get()
const data = await res.json()
```

**Type safety flows everywhere:**
- Schema → API routes → Client (eden/hono/hc)
- No codegen. No manual types. Just TypeScript inference.
- Single unified client for both CMS CRUD and custom RPC routes

---

### 4. Background Jobs (Type-Safe Payloads)

```typescript
import { defineJob, getCMSFromContext } from '@questpie/cms/server'
import { z } from 'zod'

export const sendWelcomeEmail = defineJob({
  name: 'send-welcome-email',
  schema: z.object({
    userId: z.string(),
    email: z.string().email(),
    name: z.string()
  }),
  handler: async (payload) => {
    // payload is fully typed: { userId: string; email: string; name: string }
    const cms = getCMSFromContext()

    await cms.email.send({
      to: payload.email,
      subject: `Welcome, ${payload.name}!`,
      html: `<h1>Welcome ${payload.name}!</h1>`,
    })
  },
  options: {
    retryLimit: 3,
    retryDelay: 60,  // seconds
    retryBackoff: true,
  }
})

// Add to CMS
export const cms = defineQCMS({ name: 'my-app' })
  .jobs({ sendWelcomeEmail })
  .build({
    queue: {
      adapter: pgBossAdapter({ connectionString: process.env.DATABASE_URL })
    }
  })

// Publish jobs (type-safe!)
await cms.queue['send-welcome-email'].publish({
  userId: '123',
  email: 'user@example.com',
  name: 'John'  // ✓ Autocomplete knows required fields
})
```

**What this gives you:**
- Jobs run on PostgreSQL (pg-boss)—no Redis needed
- Retries, scheduling, cron support built-in
- Type-safe payloads with Zod schemas prevent runtime errors
- Access CMS context via `getCMSFromContext()` for email, db, etc.

---

### 5. Email Templates (react-email)

```typescript
import { defineEmailTemplate, SmtpAdapter } from '@questpie/cms/server'
import { z } from 'zod'
import * as React from 'react'

// Define template with React (ComponentType, not JSX!)
const welcomeTemplate = defineEmailTemplate({
  name: 'welcome',
  schema: z.object({
    userName: z.string(),
    loginUrl: z.string(),
  }),
  render: ({ userName, loginUrl }) =>
    React.createElement(
      'div',
      null,
      React.createElement('h1', null, `Welcome ${userName}!`),
      React.createElement('p', null, 'Thanks for joining us.'),
      React.createElement('a', { href: loginUrl }, 'Login to your account'),
    ),
  subject: (ctx) => `Welcome ${ctx.userName}!`,
})

// Register template in CMS
export const cms = defineQCMS({ name: 'my-app' })
  .emailTemplates({ welcome: welcomeTemplate })
  .build({
    email: {
      adapter: new SmtpAdapter({
        transport: {
          host: process.env.SMTP_HOST,
          port: 587,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        }
      }),
      defaults: { from: 'noreply@example.com' }
    }
  })
```

**Sending emails (3 ways):**

```typescript
// 1. Send plain HTML email
await cms.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
  text: 'Hello World',  // optional plain-text version
})

// 2. Send with React element (inline)
await cms.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  react: React.createElement('div', null,
    React.createElement('h1', null, 'Hello!')
  ),
})

// 3. Send using registered template (type-safe!)
await cms.email.sendTemplate({
  template: 'welcome',  // ✓ Autocomplete knows registered templates
  context: {
    userName: 'John',   // ✓ Type-safe context matching schema
    loginUrl: 'https://example.com/login'
  },
  to: 'user@example.com',
  subject: 'Custom subject',  // Optional - uses template's subject() if omitted
})
```

**What this gives you:**
- Define email templates with React (works with @react-email/components)
- Automatic HTML + plain-text rendering via @react-email/render
- Type-safe template schemas with Zod
- Multiple adapters: SMTP, Console (dev), or custom
- Template registry with autocomplete for template names and context

---

### 6. Modular Composition (Distribute via npm)

**Create reusable modules (without .build()):**

```typescript
// @my-org/blog-module/index.ts
import { defineCollection, defineQCMS, defineJob } from '@questpie/cms/server'
import { varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { z } from 'zod'

const posts = defineCollection('posts').fields({
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content'),
  publishedAt: timestamp('published_at', { mode: 'date' }),
  isPublished: boolean('is_published').default(false).notNull(),
})

const comments = defineCollection('comments').fields({
  postId: varchar('post_id', { length: 255 }).notNull(),
  content: text('content').notNull(),
})

const publishPost = defineJob({
  name: 'publish-post',
  schema: z.object({ postId: z.string() }),
  handler: async (payload) => {
    // Publish logic
  }
})

// Export module WITHOUT .build() - no runtime config
export const blogModule = defineQCMS({ name: 'blog-module' })
  .collections({ posts, comments })
  .jobs({ publishPost })
  // NO .build() here! Modules are composable building blocks
```

**Compose modules in your main app:**

```typescript
import { defineQCMS } from '@questpie/cms/server'
import { blogModule } from '@my-org/blog-module'
import { ecommerceModule } from '@my-org/ecommerce-module'

// Use .use() to merge entire modules
export const cms = defineQCMS({ name: 'my-shop' })
  .use(blogModule)       // Merge blog collections + jobs
  .use(ecommerceModule)  // Merge ecommerce collections + jobs
  .collections({
    // Add your own collections
    reviews: defineCollection('reviews').fields({ /* ... */ })
  })
  .build({  // Only main app has .build() with runtime config
    db: { url: process.env.DATABASE_URL },
    email: { adapter: smtpAdapter },
    queue: { adapter: pgBossAdapter },
  })

// Type-safe access to all merged collections
const { docs: posts } = await cms.collections.posts.find()  // from blogModule
const { docs: products } = await cms.collections.products.find()  // from ecommerceModule
const { docs: reviews } = await cms.collections.reviews.find()  // your own
```

**Extend module collections with .merge():**

```typescript
import { blogModule } from '@my-org/blog-module'
import { defineCollection, defineQCMS } from '@questpie/cms/server'
import { boolean, integer } from 'drizzle-orm/pg-core'

export const cms = defineQCMS({ name: 'my-shop' })
  .use(blogModule)
  .collections({
    // Override posts collection with additional fields
    posts: blogModule.state.collections.posts.merge(
      defineCollection('posts').fields({
        featured: boolean('featured').default(false),
        viewCount: integer('view_count').default(0),
      })
    )
  })
  .build({ /* ... */ })

// Now posts collection has: title, content, publishedAt, isPublished, featured, viewCount
```

**What this gives you:**
- **Distribute via npm**: Modules are just TypeScript packages, publish anywhere
- **Composable building blocks**: Use `.use()` to merge collections, jobs, globals, auth config
- **Type-safe composition**: Full TypeScript inference across merged modules
- **Extensible**: Use `.merge()` to extend module collections with additional fields, hooks, access rules
- **Reusable logic**: Perfect for agencies building similar apps for multiple clients
- **No runtime coupling**: Modules define schema, main app provides runtime config (.build())

---

### 7. Custom RPC Functions (Type-Safe Business Logic)

**Define custom functions at root, collection, or global level.**

```typescript
import { defineFunction, getRequestContext } from '@questpie/cms/server'
import { z } from 'zod'

// Root-level function (available at /cms/rpc/ping)
const ping = defineFunction({
  schema: z.object({ message: z.string() }),
  outputSchema: z.object({
    message: z.string(),
    timestamp: z.number()
  }),
  handler: async (input) => {
    const ctx = getRequestContext() // uses node:async_hooks under the hood to extract context
    return {
      message: input.message,
      timestamp: Date.now()
    }
  }
})

// Raw function for custom request handling (e.g., webhooks, file uploads)
const webhook = defineFunction({
  mode: "raw",
  handler: async ({ request, context }) => {
    const body = await request.text()
    // Access headers, FormData, etc.
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

// Collection-scoped function (available at /cms/collections/posts/rpc/publish)
const posts = defineCollection('posts')
  .fields({ /* ... */ })
  .functions({
    publish: defineFunction({
      schema: z.object({ id: z.string() }),
      handler: async (input) => {
        const cms = getCMSFromContext()
        // Business logic: update status, send notifications, etc.
        await cms.collections.posts.update(input.id, { status: 'published' })
        return { id: input.id, published: true }
      }
    }),
    archive: defineFunction({
      schema: z.object({ id: z.string() }),
      handler: async (input) => {
        // Archive logic
        return { id: input.id, archived: true }
      }
    })
  })

// Global-scoped function (available at /cms/globals/settings/rpc/clearCache)
const settings = defineGlobal('settings')
  .fields({ /* ... */ })
  .functions({
    clearCache: defineFunction({
      schema: z.object({}),
      handler: async () => {
        const cms = getCMSFromContext()
        // Clear cache logic
        return { success: true }
      }
    })
  })

// Register root functions
export const cms = defineQCMS({ name: 'my-app' })
  .functions({ ping, webhook })
  .collections({ posts })
  .globals({ settings })
  .build({ /* ... */ })
```

**Calling functions from client:**

```typescript
// Root-level function
const result = await client.api.cms.rpc.ping({ message: 'Hello' })

// Collection function (Hono example)
const publishResult = await client.api.cms.collections.posts.rpc.publish({ id: 'post-123' })

// Global function
const cacheResult = await client.api.cms.globals.settings.rpc.clearCache({})
```

**What this gives you:**
- **Custom business logic** beyond CRUD - publish workflows, archive, export, etc.
- **Type-safe RPC** - input/output schemas validated with Zod
- **Raw mode** for webhooks, file uploads, custom headers
- **Scoped functions** - organize by collection/global or keep at root level
- **Access CMS context** - use `getRequestContext()` or `getCMSFromContext()`
- **HTTP endpoints** auto-generated:
  - Root: `/cms/rpc/{functionName}`
  - Collection: `/cms/collections/{collectionName}/rpc/{functionName}`
  - Global: `/cms/globals/{globalName}/rpc/{functionName}`

---

## Framework Adapters (One Backend, Any Framework)

**Elysia:**

```typescript
import { Elysia } from 'elysia'
import { createCMSFetchHandler } from '@questpie/cms/elysia'
import { cms } from './cms'

new Elysia()
  .use(createCMSFetchHandler(cms, { basePath: '/api/cms' }))
  .listen(3000)
```

**Hono:**

```typescript
import { Hono } from 'hono'
import { createCMSFetchHandler } from '@questpie/cms/hono'
import { cms } from './cms'

const app = new Hono()
app.route('/api/cms', createCMSFetchHandler(cms))

export default app
```

**Next.js (App Router):**

```typescript
// app/api/cms/[...cms]/route.ts
import { cms } from '@/lib/cms'
import { createCMSFetchHandler } from '@questpie/cms/next'

export const { GET, POST, PUT, PATCH, DELETE } = createCMSFetchHandler(cms)
```

**TanStack Start:**

```typescript
import { createAPIFileRoute } from '@tanstack/start/api'
import { cms } from '@/server/cms'
import { createCMSFetchHandler } from '@questpie/cms/tanstack-start'

export const Route = createAPIFileRoute('/api/cms/$')({
  GET: createCMSFetchHandler(cms),
  POST: createCMSFetchHandler(cms),
  // ... other methods
})
```

**All adapters follow the same HTTP contract** (see `specifications/ADAPTER_STANDARD.md`).

**E2E compatibility tests** ensure consistent behavior across frameworks.

---

## Adapter Pattern (No Vendor Lock-in)

**QUESTPIE uses adapters for all infrastructure concerns. Swap implementations without changing your code.**

### Not Locked into pg-boss

```typescript
// Default: pg-boss (PostgreSQL-based queue)
export const cms = defineQCMS({ name: 'my-app' })
  .jobs({ sendEmail, processOrder })
  .build({...}) // pgBossAdapter() is used by default

// Or specific adapter

export const cms = defineQCMS({ name: 'my-app' })
  .jobs({ sendEmail, processOrder })
  .build({
    queue: {
      adapter: bullMQAdapter({ connection: { host: 'localhost', port: 6379 } }) // Redis-based queue
    }
  })

// Or write your own adapter
import type { QueueAdapter } from '@questpie/cms/server'

const customQueueAdapter: QueueAdapter = {
  publish: async (job, payload) => { /* your logic */ },
  subscribe: async (job, handler) => { /* your logic */ },
  // ... implement interface
}
```

### Not Locked into SMTP

```typescript
// SMTP adapter
import { SmtpAdapter } from '@questpie/cms/server'

export const cms = defineQCMS({ name: 'my-app' })
  .build({
    email: {
      adapter: new SmtpAdapter({
        transport: { host: 'smtp.example.com', port: 587, auth: { /*...*/ } }
      })
    }
  })

// Console adapter (dev)
import { ConsoleAdapter } from '@questpie/cms/server'

export const cms = defineQCMS({ name: 'my-app' })
  .build({
    email: {
      adapter: new ConsoleAdapter({ logHtml: true })
    }
  })

// Sendgrid, Mailgun, Postmark, etc.—just implement the adapter interface
```

### Not Locked into PostgreSQL NOTIFY for Realtime

```typescript
// PostgreSQL NOTIFY backend (default)
export const cms = defineQCMS({ name: 'my-app' })
  .build({...}) // pgNotifyAdapter() is used by default

// Redis Streams backend
export const cms = defineQCMS({ name: 'my-app' })
  .build({
    realtime: {
      adapter: redisStreamsAdapter({ connection: { /*...*/ } })
    }
  })

// Custom adapter (e.g., AWS EventBridge, RabbitMQ)
const customRealtimeAdapter: RealtimeAdapter = {
  publish: async (channel, event) => { /* your logic */ },
  subscribe: async (channel, handler) => { /* your logic */ }
}
```

### Storage Adapters (Flydrive)

```typescript
// S3
import { s3Driver } from 'flydrive/drivers/s3'

export const cms = defineQCMS({ name: 'my-app' })
  .build({
    storage: {
      driver: s3Driver({ bucket: 'my-bucket', region: 'us-east-1', /*...*/ })
    }
  })

// Cloudflare R2
import { r2Driver } from 'flydrive/drivers/r2'

export const cms = defineQCMS({ name: 'my-app' })
  .build({
    storage: {
      driver: r2Driver({ /*...*/ })
    }
  })

// Local filesystem
import { fsDriver } from 'flydrive/drivers/fs'

export const cms = defineQCMS({ name: 'my-app' })
  .build({
    storage: {
      driver: fsDriver({ location: './uploads' })
    }
  })
```

### KV Store Adapters

```typescript
// Upstash Redis
export const cms = defineQCMS({ name: 'my-app' })
  .build({
    kv: {
      adapter: upstashAdapter({ url: process.env.UPSTASH_URL, token: process.env.UPSTASH_TOKEN })
    }
  })

// Vercel KV
export const cms = defineQCMS({ name: 'my-app' })
  .build({
    kv: {
      adapter: vercelKVAdapter({ /*...*/ })
    }
  })

// Memory (dev)
export const cms = defineQCMS({ name: 'my-app' })
  .build({
    kv: {
      adapter: memoryKVAdapter()
    }
  })
```

### Channels Integration (Work in Progress)

```typescript
// Future: Slack, Discord, Telegram, WhatsApp adapters for notifications
export const cms = defineQCMS({ name: 'my-app' })
  .build({
    channels: {
      slack: slackAdapter({ webhookUrl: process.env.SLACK_WEBHOOK }),
      discord: discordAdapter({ webhookUrl: process.env.DISCORD_WEBHOOK })
    }
  })

// WIP—coming soon!
```

---

## Batteries Included (with Adapter Flexibility)

QUESTPIE doesn't just give you a CMS. It gives you a complete backend:

| Feature        | Default Technology       | Adapter Pattern                                    |
| -------------- | ------------------------ | -------------------------------------------------- |
| **Auth**       | Better Auth              | OAuth providers, custom strategies                 |
| **Email**      | react-email + Nodemailer | SMTP, Console, Sendgrid, Mailgun, Postmark, custom |
| **Queue**      | pg-boss (PostgreSQL)     | BullMQ (Redis), custom queue adapters              |
| **Storage**    | Flydrive                 | S3, R2, GCS, local filesystem, custom drivers      |
| **Realtime**   | SSE (Server-Sent Events) | PostgreSQL NOTIFY, Redis Streams, custom adapters  |
| **KV Store**   | Configurable             | Upstash, Vercel KV, Redis, Memory, custom adapters |
| **Search**     | Built-in                 | Collection-specific search config                  |
| **Logging**    | Pino                     | Structured logging                                 |
| **Migrations** | Drizzle Kit              | Automatic schema migrations                        |
| **Channels**   | (WIP)                    | Slack, Discord, Telegram (coming soon)             |

**All integrated. All type-safe. All swappable. Use only what you need.**

---

## Admin UI (Work in Progress)

We're building a **config-driven admin UI** package (`@questpie/admin`):

- Zero-config by default: `<AdminApp client={cmsClient} />`
- Override what you need with `defineAdminConfig`
- shadcn/ui + Tailwind CSS v4
- Rich text editor (Tiptap), block editor (Puck), relation pickers

**Current status:** Early preview. Backend is production-ready. Admin is evolving.

**For now:** Explore our examples to see the admin UI in action, but expect changes.

---

## Real-World Examples

Clone and run production-ready examples:

1. **[Barbershop Booking System](examples/hono-barbershop)** (Hono)
   - Barbers, services, appointments, reviews
   - Better Auth (email/password)
   - Queue jobs for email notifications
   - Custom calendar view in admin

2. **[Barbershop (Elysia)](examples/elysia-barbershop)** (Elysia + eden client)
   - Same barbershop logic, different framework
   - Shows eden client type-safety

3. **[Barbershop (TanStack Start)](examples/tanstack-barbershop)** (TanStack Start)
   - Full-stack example with SSR
   - TanStack Query integration

**Each example includes:**
- Full source code
- Database setup (Drizzle + PostgreSQL)
- Email templates (react-email)
- Background jobs (pg-boss)
- Admin UI config

---

## How QUESTPIE Compares

| Feature                          | QUESTPIE                         | Strapi          | Payload          | Sanity          |
| -------------------------------- | -------------------------------- | --------------- | ---------------- | --------------- |
| **Type-safe (DB to client)**     | ✓ (native Drizzle)               | ~ (limited)     | ✓ (custom)       | ~ (runtime)     |
| **Self-hosted**                  | ✓                                | ✓               | ✓                | ✗ (cloud-only)  |
| **Framework-agnostic**           | ✓ (Elysia, Hono, Next, TS Start) | ✗ (own runtime) | ✗ (Next.js only) | ✓ (API-based)   |
| **Native Drizzle ORM**           | ✓                                | ✗               | ✗ (partialy)     | N/A             |
| **Native Better Auth**           | ✓                                | ✗               | ✗                | ✗               |
| **Built-in queue (no Redis)**    | ✓ (pg-boss)                      | ✗               | ✓ (cron-based)   | ✗               |
| **Decoupled admin UI**           | ✓ (config-driven)                | ✗ (coupled)     | ✗ (coupled)      | ✓ (cloud-based) |
| **Modular (distribute via npm)** | ✓                                | ~               | ~                | ✗               |

**vs Strapi:**
- Strapi has its own runtime and database layer. QUESTPIE uses standard tools (Drizzle, Better Auth).
- Strapi's admin is tightly coupled. QUESTPIE's admin is config-driven and separate.

**vs Payload:**
- Payload is Next.js-only. QUESTPIE works with any TypeScript framework.
- Payload reinvents schema definitions. QUESTPIE uses Drizzle natively.

**vs Sanity:**
- Sanity requires their hosted backend. QUESTPIE is fully self-hosted with just PostgreSQL as single dependency.
- Sanity's Studio is powerful but opaque. QUESTPIE's admin is open-source and hackable.

---

## Get Started

```bash
bun add @questpie/cms @questpie/admin
```

**Next steps:**

1. **[Read Documentation →](https://docs.questpie.dev)** (primary CTA)
2. **[Clone Examples →](https://github.com/questpie/questpie-cms/tree/main/examples)**
3. **[Star on GitHub →](https://github.com/questpie/questpie-cms)**

---

## Minimal Quick Start

**1. Define your schema:**

```typescript
// src/cms.ts
import { defineQCMS, defineCollection } from '@questpie/cms/server'
import { varchar, text } from 'drizzle-orm/pg-core'

const posts = defineCollection('posts').fields({
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content')
})

export const cms = defineQCMS({ name: 'my-app' })
  .collections({ posts })
  .auth({ /* Better Auth options */ })
  .build({
    db: { url: process.env.DATABASE_URL }
  })
```

**2. Add to your server (Hono example):**

```typescript
import { Hono } from 'hono'
import { createCMSFetchHandler } from '@questpie/cms/hono'
import { cms } from './cms'

const app = new Hono()
app.route('/api/cms', createCMSFetchHandler(cms))

export default app
```

**3. Use the client:**

```typescript
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:3000')

const res = await client.api.cms.collections.posts.$get()
const posts = await res.json()  // Typed as Post[]
```

**4. Launch admin UI:**

```tsx
import { AdminApp } from '@questpie/admin'
import { cmsClient } from './cms-client'

export default function Admin() {
  return <AdminApp client={cmsClient} />
}
```

---

## Design Principles

1. **Don't reinvent. Integrate.**
   - Drizzle for ORM (not custom schema layer)
   - Better Auth for authentication (not custom auth)
   - react-email for templates (not custom templating)

2. **Type-safety is non-negotiable.**
   - Schema → API → Client: one source of truth
   - No codegen. Just TypeScript inference.

3. **Modular by default.**
   - Collections, jobs, globals, functions: all composable
   - Distribute modules via npm
   - Override and extend without forking

4. **Framework-agnostic.**
   - HTTP adapter standard (`ADAPTER_STANDARD.md`)
   - Works with Elysia, Hono, Next.js, TanStack Start
   - E2E compatibility tests across adapters

5. **Backend excellence first.**
   - Admin UI is important but secondary
   - Get the backend right: type-safe, modular, performant
   - UI can evolve without breaking backend

---

## Footer

**Product:**
- Features
- Roadmap
- Pricing (if applicable)

**Resources:**
- Documentation
- Examples
- Blog
- Changelog

**Community:**
- GitHub
- Discord
- Twitter/X

**Legal:**
- Terms of Service
- Privacy Policy

---

## Content Principles

- **Show real code**: Every claim backed by a snippet.
- **Be honest**: Admin is WIP. Backend is ready. Say it clearly.
- **Developer language**: "Type-safe", "modular", "Drizzle native"—not marketing fluff.
- **Drive to docs**: Primary goal is to get developers reading and experimenting.

---

This specification is a living document. Update as QUESTPIE evolves.
