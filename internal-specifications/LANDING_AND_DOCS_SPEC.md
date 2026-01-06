# QUESTPIE CMS - Landing Page, Documentation & Examples Specification

> Complete specification for rebuilding the landing page, restructuring documentation, and creating new real-life examples.

---

## Table of Contents

1. [Philosophy & Messaging](#1-philosophy--messaging)
2. [Landing Page Specification](#2-landing-page-specification)
3. [Documentation Specification](#3-documentation-specification)
4. [Examples Specification](#4-examples-specification)
5. [Existing Documentation Audit](#5-existing-documentation-audit)
6. [Source Code References](#6-source-code-references)
7. [Implementation Priority](#7-implementation-priority)

---

## 1. Philosophy & Messaging

### Core Value Proposition

QUESTPIE CMS is NOT just another headless CMS. It's a **type-safe backend toolkit** for content-driven TypeScript applications.

### Key Messages (in order of importance)

1. **Amazing DX** - TypeScript inference from DB schema to client, no codegen
2. **No Magic, Native Libraries** - Drizzle ORM, Better Auth, pg-boss, Nodemailer - not proprietary abstractions
3. **Batteries Included** - Auth, email, queues, storage, realtime out of the box
4. **Adapter Pattern** - Swap transports (queue, email, storage, realtime) without changing business logic
5. **Framework Agnostic** - Hono, Elysia, Next.js, TanStack Start - same CMS, your choice
6. **Decoupled Architecture** - Backend and Admin UI are separate (unlike Payload)
7. **Bleeding Edge** - Bun, Node LTS, drizzle-orm@beta, Zod v4

### Tone

- Technical but approachable
- Show, don't tell (code examples over marketing speak)
- No competitor bashing - just explain our approach
- Focus on developer productivity and type safety

### Target Audience

- TypeScript developers building content-heavy apps
- Developers frustrated with CMS vendor lock-in
- Teams wanting self-hosted, type-safe solutions
- Developers who value DX and modern tooling

---

## 2. Landing Page Specification

### Design System

**Keep existing Ando design system** - grid lines, animations, visual style.

### Section Order

```
1. Hero (existing - keep with updates)
2. Our Approach (new)
3. Features Grid (update)
4. Framework Adapters (update)
5. Code Demo (existing AnimatedCode - update content)
6. Examples (update with real examples)
7. Get Started CTA (new)
8. Footer (update links)
```

---

### Section 2.1: Hero

**Location:** `apps/docs/src/components/landing/Hero.tsx`

**Keep:**

- Visual design and animations
- Beta badge
- CTA buttons

**Update:**

- Tagline: Keep "Type-Safe Backend for Content-Driven Apps"
- Subtitle: Update to emphasize native libraries:
  ```
  "Build with Drizzle ORM, Better Auth, and TypeScript.
  No proprietary abstractions - just native libraries with amazing DX."
  ```
- Feature bullets - update to:
  - "Native Drizzle ORM schema"
  - "Better Auth integration"
  - "Type-safe from DB to client"
  - "Batteries included: queues, email, storage"
  - "Swap any adapter - your infrastructure"

**Code Demo Steps (AnimatedCode)** - Update to show real workflow:

```typescript
// Step 1: Define Collection (Drizzle native)
import { defineCollection } from "@questpie/cms/server";
import { varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const projects = defineCollection("projects")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    featured: boolean("featured").default(false),
    publishedAt: timestamp("published_at", { mode: "date" }),
  })
  .title((t) => t.title);

// Step 2: Add Relations (Drizzle style)
  .relations(({ table, one, many }) => ({
    category: one("categories", {
      fields: [table.categoryId],
      references: ["id"],
    }),
    images: many("project_images"),
  }))

// Step 3: Add Hooks (business logic)
  .hooks({
    afterCreate: async ({ data }) => {
      const cms = getCMSFromContext();
      await cms.queue["notify-admin"].publish({
        projectId: data.id,
      });
    },
  })

// Step 4: Build CMS
export const cms = defineQCMS({ name: "portfolio" })
  .collections({ projects, categories, projectImages })
  .auth({ emailAndPassword: { enabled: true } })
  .build({
    db: { url: process.env.DATABASE_URL },
    queue: { adapter: pgBossAdapter({ connectionString: DATABASE_URL }) },
    email: { adapter: smtpAdapter({ /* ... */ }) },
  });

// Step 5: Mount to Framework (Hono)
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";

const app = new Hono()
  .route("/", questpieHono(cms));

// Step 6: Type-Safe Client
const client = createQCMSClient<typeof cms>({
  baseURL: "http://localhost:3000",
});

const { docs } = await client.collections.projects.find({
  where: { featured: true },
  with: { category: true, images: true },
});
// docs is fully typed!
```

---

### Section 2.2: Our Approach (NEW)

**Purpose:** Explain philosophy without bashing competitors.

**Layout:** 3-4 cards in a row

**Content:**

```
Card 1: "Your Schema is Drizzle"
- No proprietary schema DSL
- Use native Drizzle ORM column types
- Migrations auto-generated by Drizzle Kit
- Full PostgreSQL power

Card 2: "Native Libraries, Not Abstractions"
- Better Auth for authentication
- pg-boss for background jobs
- Nodemailer + React Email for transactional email
- Flydrive for file storage
- Learn once, use everywhere

Card 3: "Adapter Pattern"
- Swap queue backend (pg-boss, BullMQ, custom)
- Swap email provider (SMTP, Sendgrid, Resend)
- Swap storage (local, S3, R2, GCS)
- Swap realtime transport (Postgres NOTIFY, Redis)
- Your infrastructure, your choice

Card 4: "Decoupled by Design"
- Backend schema is pure data
- Admin UI is separate package
- Build multiple frontends on same backend
- No UI code in your schema definitions
```

---

### Section 2.3: Features Grid

**Layout:** 2x3 or 2x4 grid of feature cards with code snippets

**Features to highlight:**

```
1. Collections (Native Drizzle)
   Code: defineCollection with fields

2. Relations (Drizzle Relations)
   Code: .relations() with one/many

3. Hooks (Lifecycle Events)
   Code: beforeCreate, afterUpdate

4. Access Control (Database-level)
   Code: .access() with WHERE conditions

5. Background Jobs (pg-boss)
   Code: defineJob + publish

6. Email Templates (React Email)
   Code: defineEmailTemplate

7. Realtime (SSE)
   Code: Subscribe to collection changes

8. Modular Composition
   Code: .use() to compose modules
```

**Each card shows:**

- Feature name
- One-sentence description
- 5-10 line code example
- Link to docs section

---

### Section 2.4: Framework Adapters

**Layout:** 4 tabs or cards showing each framework

**Frameworks:**

1. Hono (`@questpie/hono`)
2. Elysia (`@questpie/elysia`)
3. Next.js (`@questpie/next`)
4. TanStack Start (`@questpie/tanstack-start`)

**Each shows:**

```typescript
// Hono
import { questpieHono } from "@questpie/hono";
const app = new Hono().route("/", questpieHono(cms));

// Elysia
import { questpieElysia } from "@questpie/elysia";
const app = new Elysia().use(questpieElysia(cms));

// Next.js
import { questpieNextRouteHandlers } from "@questpie/next";
export const { GET, POST, PATCH, DELETE } = questpieNextRouteHandlers(cms);

// TanStack Start
import { questpieStartHandlers } from "@questpie/tanstack-start";
export const Route = createFileRoute("/api/cms/$")({
  server: { handlers: questpieStartHandlers(cms) },
});
```

---

### Section 2.5: Code Demo

**Keep existing AnimatedCode component** with updated content from Hero section.

---

### Section 2.6: Examples

**Layout:** 2 cards (for now, expandable later)

**Content:**

```
Card 1: Portfolio Site (Hono)
- Backend-only API
- Projects, Categories, Team Members
- File uploads for images
- Contact form with email notification
- Link: /docs/examples/portfolio-hono

Card 2: Portfolio Site (TanStack Start)
- Fullstack with Admin UI
- Same collections as Hono version
- Puck Editor for page building
- Tiptap for rich text
- Link: /docs/examples/portfolio-tanstack
```

**Note:** These examples don't exist yet - will be created as part of this spec.

---

### Section 2.7: Get Started CTA

**Content:**

```
Ready to build?

# Install
bun add @questpie/cms drizzle-orm@beta

# Generate your first migration
bun qcms migrate:generate

# Start building
[Read the Docs] [View on GitHub]
```

---

### Section 2.8: Footer

**Update links:**

- Product: Documentation, Features (anchor), Roadmap (GitHub discussions)
- Resources: Examples (GitHub), Changelog (GitHub releases)
- Community: GitHub, Discord (if exists), Twitter/X (if exists)
- Remove placeholder # links

---

## 3. Documentation Specification

### Philosophy

1. **Practical first** - "How to achieve X" over theory
2. **Code-heavy** - Every concept with working examples
3. **No fluff** - Straight to the point
4. **API reference** - Complete method signatures and types
5. **Modern stack** - Emphasize Bun, latest Node, drizzle-orm@beta

### New Structure

```
docs/
├── index.mdx                        # Quick overview + navigation

├── getting-started/
│   ├── index.mdx                    # Overview of section
│   ├── installation.mdx             # Install + first setup
│   ├── quick-start.mdx              # Build first collection in 5 min
│   └── project-structure.mdx        # Recommended file organization

├── concepts/
│   ├── index.mdx                    # Overview of core concepts
│   ├── collections.mdx              # REWRITE - more concise
│   ├── globals.mdx                  # REWRITE - more concise
│   ├── fields.mdx                   # REWRITE - comprehensive field reference
│   ├── relations.mdx                # KEEP - comprehensive
│   ├── hooks.mdx                    # KEEP - comprehensive
│   ├── access-control.mdx           # KEEP - comprehensive
│   └── validation.mdx               # NEW - Zod integration

├── guides/
│   ├── index.mdx                    # Overview + guide list
│   ├── authentication.mdx           # UPDATE - Better Auth setup
│   ├── file-uploads.mdx             # REWRITE - Flydrive guide
│   ├── background-jobs.mdx          # EXPAND - pg-boss patterns
│   ├── email-templates.mdx          # NEW - React Email guide
│   ├── realtime.mdx                 # KEEP - SSE subscriptions
│   ├── custom-functions.mdx         # NEW - defineFunction + RPC
│   ├── modular-composition.mdx      # NEW - .use() and npm distribution
│   ├── polymorphic-relations.mdx    # NEW - patterns without native support
│   └── custom-adapters.mdx          # NEW - build your own adapters

├── adapters/
│   ├── index.mdx                    # Adapter overview + comparison
│   ├── hono.mdx                     # Hono-specific guide
│   ├── elysia.mdx                   # Elysia-specific guide
│   ├── nextjs.mdx                   # Next.js-specific guide
│   └── tanstack-start.mdx           # TanStack Start guide

├── client/
│   ├── index.mdx                    # Client SDK overview
│   ├── basic-usage.mdx              # CRUD operations
│   ├── tanstack-query.mdx           # Query options + SSR
│   └── tanstack-db.mdx              # Offline-first + realtime

├── admin/                           # When ready
│   ├── index.mdx                    # Admin package overview
│   ├── setup.mdx                    # Installation + config
│   ├── collections.mdx              # Collection UI config
│   ├── fields.mdx                   # Field renderers
│   ├── layouts.mdx                  # Sections, tabs, sidebar
│   └── theming.mdx                  # Tailwind customization

├── reference/
│   ├── index.mdx                    # Reference overview
│   ├── collection-api.mdx           # All CRUD methods + signatures
│   ├── global-api.mdx               # Global methods
│   ├── cli.mdx                      # REWRITE - qcms commands
│   ├── configuration.mdx            # Full config reference
│   ├── errors.mdx                   # NEW - Error types
│   └── types.mdx                    # NEW - Type utilities

└── examples/
    ├── index.mdx                    # Examples overview
    ├── portfolio-hono.mdx           # Walkthrough of Hono example
    └── portfolio-tanstack.mdx       # Walkthrough of TanStack example
```

---

### Content Guidelines per Section

#### Getting Started

**installation.mdx:**

```markdown
# Installation

## Requirements

- Bun 1.0+ (recommended) or Node.js 20+
- PostgreSQL 15+
- TypeScript 5.0+

## Install

bun add @questpie/cms drizzle-orm@beta zod
bun add -D drizzle-kit

## Framework Adapter

bun add @questpie/hono # or @questpie/elysia, @questpie/next, etc.
```

**quick-start.mdx:**

- 5-minute guide
- Single collection
- Mount to Hono
- Test with curl
- No extras (no auth, no queue)

---

#### Concepts

**fields.mdx (REWRITE):**

Must include comprehensive reference:

```markdown
# Field Types

## String Fields

- varchar(name, { length }) - Fixed max length
- text(name) - Unlimited text
- char(name, { length }) - Fixed length

## Number Fields

- integer(name) - 32-bit integer
- bigint(name, { mode: "number" }) - 64-bit integer
- serial(name) - Auto-increment
- smallint(name) - 16-bit integer
- real(name) - 32-bit float
- doublePrecision(name) - 64-bit float
- numeric(name, { precision, scale }) - Exact decimal

## Boolean

- boolean(name)

## Date/Time

- timestamp(name, { mode: "date" | "string", withTimezone? })
- date(name, { mode: "date" | "string" })
- time(name)
- interval(name)

## JSON

- json(name) - JSON (text storage)
- jsonb(name) - Binary JSON (indexed, faster queries)
- Use .$type<T>() for TypeScript typing

## UUID

- uuid(name) - Auto-generates UUID v7

## Arrays

- .array() modifier on any type
- Example: varchar("tags", { length: 100 }).array()

## Modifiers

- .notNull()
- .default(value)
- .defaultRandom() - for UUIDs
- .primaryKey()
- .unique()
- .references(() => table.column)

## Examples

[Full code examples for each type]
```

**validation.mdx (NEW):**

```markdown
# Validation

## Schema Validation

Fields are validated by database constraints (notNull, unique, etc.)

## Runtime Validation with Zod

Use .validation() to add Zod refinements:

defineCollection("users")
.fields({
email: varchar("email", { length: 255 }).notNull(),
age: integer("age"),
})
.validation({
refine: {
email: (s) => s.email("Invalid email format"),
age: (s) => s.min(0).max(150),
},
})

## Validation in Hooks

[Example of beforeCreate validation]

## Custom Validation Functions

[Example of complex cross-field validation]
```

---

#### Guides

**email-templates.mdx (NEW):**

```markdown
# Email Templates

## Setup

Configure email adapter in CMS:
[Code example]

## Define Template

import { defineEmailTemplate } from "@questpie/cms/server";

const welcomeEmail = defineEmailTemplate({
name: "welcome",
schema: z.object({
userName: z.string(),
verifyUrl: z.string().url(),
}),
subject: (ctx) => `Welcome, ${ctx.userName}!`,
render: ({ userName, verifyUrl }) =>
React.createElement("div", null, [
React.createElement("h1", null, `Hello ${userName}`),
React.createElement("a", { href: verifyUrl }, "Verify Email"),
]),
});

## Register Templates

[CMS config example]

## Send Email

await cms.email.sendTemplate({
template: "welcome",
to: user.email,
context: { userName: user.name, verifyUrl: "..." },
});

## Custom Adapters

- SMTP (default)
- Console (development)
- Custom: implement MailerAdapter interface
```

**modular-composition.mdx (NEW):**

```markdown
# Modular Composition

## Philosophy

Share collections, auth configs, jobs across projects via npm.

## Creating a Module

// my-blog-module/src/index.ts
export const blogModule = defineQCMS({ name: "blog" })
.collections({
posts: defineCollection("posts").fields({...}),
categories: defineCollection("categories").fields({...}),
})
.jobs({
notifySubscribers: defineJob({...}),
});
// Do NOT call .build() - that's for the consumer

## Using a Module

import { blogModule } from "my-blog-module";

const cms = defineQCMS({ name: "app" })
.use(blogModule)
.collections({ products }) // Add more collections
.build({ /_ runtime config _/ });

## Extending Module Collections

const cms = defineQCMS({ name: "app" })
.use(blogModule)
.collections({
// Extend blog posts with custom fields
posts: blogModule.state.collections.posts.merge(
defineCollection("posts").fields({
customField: varchar("custom", { length: 100 }),
})
),
})
.build({...});

## Publishing to npm

[package.json example with peer dependencies]
```

**polymorphic-relations.mdx (NEW):**

```markdown
# Polymorphic Relations

QUESTPIE doesn't have native polymorphic relations, but you can achieve
similar patterns using these approaches:

## Pattern 1: Discriminated Union with JSONB

[Example with type field + data JSONB]

## Pattern 2: Multiple Nullable Foreign Keys

[Example with separate FK columns]

## Pattern 3: Junction Table per Type

[Example with separate junction tables]

## When to Use Each

[Comparison table]
```

**custom-adapters.mdx (NEW):**

```markdown
# Custom Adapters

## Queue Adapter

interface QueueAdapter {
publish(jobName: string, payload: unknown, options?: JobOptions): Promise<void>;
schedule(jobName: string, cron: string, payload: unknown): Promise<void>;
listen(handlers: Record<string, JobHandler>): Promise<void>;
}

## Email Adapter

interface MailerAdapter {
send(options: SendOptions): Promise<void>;
}

## Storage Adapter

Uses Flydrive DriverContract - see Flydrive docs.

## Realtime Adapter

interface RealtimeAdapter {
publish(channel: string, event: unknown): Promise<void>;
subscribe(channel: string, handler: EventHandler): () => void;
}

## Example: Custom Queue Adapter

[Full implementation example]
```

---

#### Reference

**cli.mdx (REWRITE):**

```markdown
# CLI Reference

## Migration Commands

### migrate:generate

Generate migration from schema changes.

bun qcms migrate:generate
bun qcms migrate:generate --name add-posts-table
bun qcms migrate:generate --dry-run

Options:

- -c, --config <path> - Config file (default: cms.config.ts)
- -n, --name <name> - Custom migration name
- --dry-run - Preview without creating files
- --verbose - Show detailed output

### migrate:up

Run pending migrations.

bun qcms migrate:up
bun qcms migrate:up --target 20240101_migration_name

Options:

- -c, --config <path>
- -t, --target <migration> - Run up to specific migration
- --dry-run

### migrate:down

Rollback migrations.

bun qcms migrate:down
bun qcms migrate:down --batch 2

Options:

- -c, --config <path>
- -b, --batch <number> - Rollback specific batch
- -t, --target <migration> - Rollback to specific migration
- --dry-run

### migrate:status

Show migration status.

bun qcms migrate:status

### migrate:reset

Rollback all migrations.

bun qcms migrate:reset --dry-run

### migrate:fresh

Reset and re-run all migrations.

bun qcms migrate:fresh

## Configuration

The CLI looks for cms.config.ts in the current directory by default.

// cms.config.ts
import { cms } from "./src/cms";
export default cms;
```

**collection-api.mdx (NEW):**

```markdown
# Collection API Reference

## find(options?, context?)

Find multiple records with pagination.

### Options

- where: WhereConditions - Filter records
- columns: ColumnSelection - Select specific columns
- with: RelationSelection - Include relations
- orderBy: OrderBySpec - Sort results
- limit: number - Max records (default: 50)
- offset: number - Skip records
- page: number - Page number (alternative to offset)
- includeDeleted: boolean - Include soft-deleted
- extras: Record<string, SQL> - Additional computed columns

### Returns

{
docs: T[];
totalDocs: number;
limit: number;
offset: number;
page: number;
totalPages: number;
hasNextPage: boolean;
hasPrevPage: boolean;
}

### Example

const { docs, totalDocs } = await cms.api.collections.posts.find({
where: { isPublished: true },
with: { author: true },
orderBy: { createdAt: "desc" },
limit: 10,
}, context);

## findOne(options, context?)

[Full documentation]

## create(data, context?)

[Full documentation]

## updateById({ id, data }, context?)

[Full documentation]

## deleteById({ id }, context?)

[Full documentation]

## restoreById({ id }, context?)

[Full documentation]

## findVersions({ id, limit?, offset? }, context?)

[Full documentation]

## revertToVersion({ id, version? | versionId? }, context?)

[Full documentation]

## Where Operators

- eq, ne, gt, gte, lt, lte
- in, notIn
- like, ilike, notLike, notIlike
- contains, startsWith, endsWith
- isNull, isNotNull
- arrayOverlaps, arrayContained, arrayContains
- AND, OR, NOT
- RAW (for custom SQL)

[Examples for each operator]
```

---

## 4. Examples Specification

### Overview

Create 2 real-world examples demonstrating QUESTPIE CMS capabilities:

1. **portfolio-hono** - Backend API only (demonstrates decoupled architecture)
2. **portfolio-tanstack** - Fullstack with future Admin UI, Puck, Tiptap

Both represent the same domain: **Portfolio/Agency Website**

---

### Domain Model

```
Collections:
├── projects
│   ├── title (varchar, localized)
│   ├── slug (varchar, unique)
│   ├── description (text, localized)
│   ├── content (jsonb - Tiptap rich text)
│   ├── featuredImage (varchar - storage reference)
│   ├── categoryId (uuid - FK to categories)
│   ├── featured (boolean)
│   ├── publishedAt (timestamp)
│   └── status (varchar: draft, published, archived)
│
├── categories
│   ├── name (varchar, localized)
│   ├── slug (varchar, unique)
│   └── description (text, localized)
│
├── project_images
│   ├── projectId (uuid - FK to projects)
│   ├── imageUrl (varchar - storage reference)
│   ├── caption (varchar, localized)
│   └── order (integer)
│
├── services
│   ├── title (varchar, localized)
│   ├── description (text, localized)
│   ├── icon (varchar)
│   ├── price (integer - cents)
│   └── order (integer)
│
├── team_members
│   ├── name (varchar)
│   ├── role (varchar, localized)
│   ├── bio (text, localized)
│   ├── avatar (varchar - storage reference)
│   ├── email (varchar)
│   └── order (integer)
│
├── testimonials
│   ├── clientName (varchar)
│   ├── clientCompany (varchar)
│   ├── content (text, localized)
│   ├── avatar (varchar)
│   └── featured (boolean)
│
├── contact_submissions
│   ├── name (varchar)
│   ├── email (varchar)
│   ├── message (text)
│   ├── status (varchar: new, read, replied)
│   └── repliedAt (timestamp)
│
└── pages (for Puck - TanStack version only)
    ├── slug (varchar, unique)
    ├── title (varchar, localized)
    ├── content (jsonb - Puck data)
    └── publishedAt (timestamp)

Globals:
├── site_settings
│   ├── siteName (varchar, localized)
│   ├── tagline (varchar, localized)
│   ├── logo (varchar - storage)
│   ├── contactEmail (varchar)
│   ├── socialLinks (jsonb)
│   └── seo (jsonb: defaultTitle, defaultDescription)
│
└── homepage
    ├── heroTitle (varchar, localized)
    ├── heroSubtitle (text, localized)
    ├── heroImage (varchar - storage)
    └── featuredProjectIds (jsonb - array of UUIDs)
```

---

### Example: portfolio-hono

**Location:** `examples/portfolio-hono/`

**Structure:**

```
portfolio-hono/
├── src/
│   ├── cms.ts              # CMS configuration
│   ├── collections/
│   │   ├── index.ts        # Export all collections
│   │   ├── projects.ts
│   │   ├── categories.ts
│   │   ├── services.ts
│   │   ├── team-members.ts
│   │   ├── testimonials.ts
│   │   └── contact-submissions.ts
│   ├── globals/
│   │   ├── index.ts
│   │   ├── site-settings.ts
│   │   └── homepage.ts
│   ├── jobs/
│   │   ├── index.ts
│   │   └── contact-notification.ts
│   ├── email-templates/
│   │   ├── index.ts
│   │   └── contact-notification.tsx
│   ├── server.ts           # Hono server
│   └── client.ts           # Example client usage
├── worker.ts               # Job worker
├── migrate.ts              # Migration runner
├── seed.ts                 # Seed data
├── cms.config.ts           # CLI config
├── package.json
├── tsconfig.json
└── README.md
```

**Features demonstrated:**

- Collection builder with all field types
- Relations (one-to-many, many-to-one)
- Localization (i18n)
- Hooks (slug generation, publish date)
- Access control (public read, auth for write)
- Globals for site settings
- Background jobs (contact notification)
- Email templates (contact form)
- File storage integration
- Custom API routes (contact form handler)

---

### Example: portfolio-tanstack

**Location:** `examples/portfolio-tanstack/`

**Structure:**

```
portfolio-tanstack/
├── src/
│   ├── server/
│   │   ├── cms.ts
│   │   ├── collections/
│   │   ├── globals/
│   │   ├── jobs/
│   │   └── email-templates/
│   ├── configs/
│   │   └── admin.ts        # Admin UI config
│   ├── lib/
│   │   └── cms-client.ts
│   ├── routes/
│   │   ├── index.tsx       # Public homepage
│   │   ├── projects/
│   │   ├── api/
│   │   │   └── cms/
│   │   │       └── $.ts    # CMS API handler
│   │   └── admin/
│   │       ├── index.tsx   # Admin dashboard
│   │       └── $.tsx       # Admin catch-all
│   └── components/
│       ├── puck/           # Puck editor components
│       └── tiptap/         # Tiptap editor config
├── worker.ts
├── migrate.ts
├── seed.ts
├── cms.config.ts
├── package.json
├── tsconfig.json
├── app.config.ts           # TanStack Start config
└── README.md
```

**Additional features (beyond Hono):**

- Full frontend rendering
- Admin UI integration (@questpie/admin)
- Puck page builder for `pages` collection
- Tiptap rich text for project content
- TanStack Query integration
- SSR with data prefetching

---

### Example README Template

```markdown
# Portfolio Site Example (Hono)

A complete portfolio/agency website backend built with QUESTPIE CMS.

## What This Demonstrates

- [x] Collection definitions with Drizzle fields
- [x] Relations (projects -> categories, projects -> images)
- [x] Localization (title, description in multiple languages)
- [x] Hooks (auto-slug, publish date)
- [x] Access control (public read, authenticated write)
- [x] Globals (site settings)
- [x] Background jobs (email notifications)
- [x] Email templates (React Email)
- [x] File storage (project images)
- [x] Custom API routes (contact form)

## Quick Start

# Install

bun install

# Setup database

docker-compose up -d # Or use your own Postgres

# Run migrations

bun run migrate

# Seed data

bun run seed

# Start server

bun run dev

# Start worker (separate terminal)

bun run worker

## API Endpoints

GET /cms/projects # List projects
GET /cms/projects/:id # Get project
POST /cms/projects # Create project (auth required)
...

POST /api/contact # Submit contact form (public)

## Project Structure

[Explain each directory]

## Learn More

- [Collections Documentation](/docs/concepts/collections)
- [Hooks Documentation](/docs/concepts/hooks)
- [Email Templates Guide](/docs/guides/email-templates)
```

---

## 5. Existing Documentation Audit

### Status Legend

- **KEEP** - Good as is
- **UPDATE** - Minor updates needed
- **REWRITE** - Major rewrite needed
- **DELETE** - Remove entirely
- **NEW** - Create from scratch

### Audit Results

| File                                   | Status  | Notes                                       |
| -------------------------------------- | ------- | ------------------------------------------- |
| `docs/index.mdx`                       | UPDATE  | Update navigation, add quick links          |
| `introduction/index.mdx`               | DELETE  | Placeholder only                            |
| `introduction/overview.mdx`            | REWRITE | Too long, outdated claims, move to concepts |
| `introduction/getting-started.mdx`     | REWRITE | Needs clearer steps                         |
| `core-concepts/index.mdx`              | DELETE  | Placeholder only                            |
| `core-concepts/collections.mdx`        | UPDATE  | Good but verbose, trim                      |
| `core-concepts/fields.mdx`             | REWRITE | Too minimal (45 lines)                      |
| `core-concepts/globals.mdx`            | KEEP    | Comprehensive                               |
| `core-concepts/relations.mdx`          | KEEP    | Comprehensive                               |
| `core-concepts/hooks.mdx`              | KEEP    | Comprehensive                               |
| `core-concepts/access-control.mdx`     | KEEP    | Comprehensive                               |
| `guides/index.mdx`                     | DELETE  | Placeholder only                            |
| `guides/authentication.mdx`            | UPDATE  | Add Better Auth plugin examples             |
| `guides/storage-upload.mdx`            | REWRITE | Currently stub                              |
| `guides/queue-jobs.mdx`                | UPDATE  | Add more patterns                           |
| `guides/realtime-subscriptions.mdx`    | KEEP    | Good                                        |
| `guides/custom-api-routes.mdx`         | UPDATE  | Add more examples                           |
| `guides/creating-a-collection.mdx`     | DELETE  | Redundant with collections.mdx              |
| `guides/typescript-best-practices.mdx` | UPDATE  | Add type utilities                          |
| `reference/index.mdx`                  | DELETE  | Placeholder only                            |
| `reference/cms-config.mdx`             | REWRITE | Too minimal                                 |
| `reference/cli.mdx`                    | REWRITE | Missing qcms commands                       |
| `reference/drizzle-orm.mdx`            | DELETE  | Just link to Drizzle docs                   |
| `reference/hono-adapter.mdx`           | REWRITE | Move to adapters section                    |

---

## 6. Source Code References

### For Documentation Writers

**Collections:**

- Builder: `packages/cms/src/server/collection/builder/collection-builder.ts`
- CRUD: `packages/cms/src/server/collection/crud/crud-generator.ts`
- Types: `packages/cms/src/server/collection/builder/types.ts`

**Globals:**

- Builder: `packages/cms/src/server/global/builder/global-builder.ts`
- CRUD: `packages/cms/src/server/global/crud/global-crud.ts`

**Adapters:**

- HTTP Core: `packages/cms/src/server/adapters/http.ts`
- Hono: `packages/hono/src/index.ts`
- Elysia: `packages/elysia/src/index.ts`
- Next.js: `packages/next/src/index.ts`
- TanStack Start: `packages/tanstack-start/src/index.ts`

**Integrated Services:**

- Auth: `packages/cms/src/server/integrated/auth/`
- Queue: `packages/cms/src/server/integrated/queue/`
- Email: `packages/cms/src/server/integrated/mailer/`
- Storage: `packages/cms/src/server/integrated/storage/`
- Realtime: `packages/cms/src/server/integrated/realtime/`

**CLI:**

- Commands: `packages/cms/src/cli/`

**Client:**

- Client: `packages/cms/src/client/`
- TanStack Query: `packages/tanstack-query/src/`

**Admin (when documenting):**

- Config: `packages/admin/src/config/`
- Components: `packages/admin/src/components/`
- Hooks: `packages/admin/src/hooks/`

---

## 7. Implementation Priority

### Phase 1: Foundation (Week 1)

1. Create `portfolio-hono` example
2. Rewrite `fields.mdx` with comprehensive reference
3. Rewrite `cli.mdx` with actual commands
4. Create `getting-started/installation.mdx`
5. Create `getting-started/quick-start.mdx`

### Phase 2: Landing Page (Week 1-2)

1. Update Hero content
2. Create "Our Approach" section
3. Update Features grid
4. Update Framework adapters section
5. Update Examples section (link to new examples)
6. Fix Footer links

### Phase 3: Guides (Week 2)

1. Create `email-templates.mdx`
2. Create `modular-composition.mdx`
3. Create `custom-functions.mdx`
4. Rewrite `storage-upload.mdx` (now `file-uploads.mdx`)
5. Create `custom-adapters.mdx`

### Phase 4: Reference (Week 2-3)

1. Create `collection-api.mdx`
2. Create `global-api.mdx`
3. Rewrite `configuration.mdx`
4. Create `errors.mdx`
5. Create `types.mdx`

### Phase 5: Adapters (Week 3)

1. Create `adapters/index.mdx`
2. Create `adapters/hono.mdx`
3. Create `adapters/elysia.mdx`
4. Create `adapters/nextjs.mdx`
5. Create `adapters/tanstack-start.mdx`

### Phase 6: TanStack Example (Week 3-4)

1. Create `portfolio-tanstack` example
2. Add Puck integration
3. Add Tiptap integration
4. Create example walkthroughs

### Phase 7: Cleanup (Week 4)

1. Delete redundant docs
2. Update all navigation
3. Cross-link between docs
4. Review and polish

---

## Appendix: Tech Stack Emphasis

In all documentation, emphasize:

```
Runtime: Bun 1.0+ (recommended) or Node.js 20+
Database: PostgreSQL 15+
ORM: drizzle-orm@beta (latest beta)
Validation: Zod v4
Auth: Better Auth
TypeScript: 5.0+
```

Reason for beta/cutting-edge:

- Best DX and type inference
- Active development with fast fixes
- We're early adopters helping shape the ecosystem
- Production-ready despite beta label

---

_End of Specification_
