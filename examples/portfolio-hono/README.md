# Portfolio Site Example (Hono)

A complete portfolio/agency website backend built with QUESTPIE CMS and Hono.

## What This Demonstrates

- **Collections** with relations, localization, hooks, and access control
- **Globals** for site settings and homepage configuration
- **Background Jobs** for email notifications (pg-boss)
- **Email Integration** with SMTP/Console adapter
- **File Storage** for project images
- **Custom API Routes** (contact form, homepage data)
- **Better Auth** integration

## Collections

| Collection            | Description                          |
| --------------------- | ------------------------------------ |
| `projects`            | Portfolio projects with rich content |
| `categories`          | Project categories                   |
| `project_images`      | Gallery images for projects          |
| `services`            | Agency services offered              |
| `team_members`        | Team/staff profiles                  |
| `testimonials`        | Client testimonials                  |
| `contact_submissions` | Contact form submissions             |

## Globals

| Global          | Description                               |
| --------------- | ----------------------------------------- |
| `site_settings` | Site branding, contact info, SEO defaults |
| `homepage`      | Hero section, featured content IDs        |

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your database URL

# Create database
createdb portfolio

# Run migrations
bun run migrate

# Seed sample data
bun run seed

# Start server
bun run dev

# In another terminal, start the worker
bun run worker
```

## API Endpoints

### CMS Endpoints (auto-generated)

```
GET    /cms/projects              List projects
POST   /cms/projects              Create project
GET    /cms/projects/:id          Get project
PATCH  /cms/projects/:id          Update project
DELETE /cms/projects/:id          Delete project

GET    /cms/globals/site_settings Get site settings
PATCH  /cms/globals/site_settings Update site settings

POST   /cms/auth/sign-up          Register user
POST   /cms/auth/sign-in          Login
POST   /cms/auth/sign-out         Logout

POST   /cms/storage/upload        Upload file
```

### Custom Endpoints

```
POST /api/contact     Submit contact form (public)
GET  /api/homepage    Get aggregated homepage data
GET  /api/health      Health check
```

## Project Structure

```
portfolio-hono/
├── src/
│   ├── cms.ts              # CMS configuration
│   ├── server.ts           # Hono server
│   ├── collections/        # Collection definitions
│   │   ├── index.ts
│   │   ├── projects.ts
│   │   ├── categories.ts
│   │   └── ...
│   ├── globals/            # Global definitions
│   │   ├── index.ts
│   │   ├── site-settings.ts
│   │   └── homepage.ts
│   └── jobs/               # Background jobs
│       ├── index.ts
│       └── contact-notification.ts
├── worker.ts               # Job worker process
├── migrate.ts              # Migration runner
├── seed.ts                 # Database seeder
├── cms.config.ts           # CLI configuration
├── package.json
└── README.md
```

## Features Demonstrated

### 1. Collection with Relations & Localization

```typescript
export const projects = defineCollection("projects")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    categoryId: varchar("category_id", { length: 255 }),
    // ...
  })
  .localized(["title", "description", "content"])
  .relations(({ table, one, many }) => ({
    category: one("categories", {
      fields: [table.categoryId],
      references: ["id"],
    }),
    images: many("project_images"),
  }));
```

### 2. Hooks for Business Logic

```typescript
.hooks({
  beforeCreate: async ({ data }) => {
    if (!data.slug && data.title) {
      data.slug = slugify(data.title);
    }
  },
  afterCreate: async ({ data }) => {
    const cms = getCMSFromContext<AppCMS>();
    await cms.queue["notify-new-project"].publish({
      projectId: data.id,
      title: data.title,
    });
  },
})
```

### 3. Access Control

```typescript
.access({
  read: ({ user }) => {
    if (!user) return { status: "published" };
    return true;
  },
  create: ({ user }) => !!user,
  update: ({ user }) => !!user,
  delete: ({ user }) => user?.role === "admin",
})
```

### 4. Background Jobs

```typescript
const contactNotificationJob = defineJob({
  name: "contact-notification",
  schema: z.object({
    submissionId: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  handler: async (payload) => {
    const cms = getCMSFromContext<AppCMS>();
    await cms.email.send({
      to: adminEmail,
      subject: `New Contact: ${payload.name}`,
      html: "...",
    });
  },
});
```

## Learn More

- [Collections Documentation](/docs/concepts/collections)
- [Hooks Documentation](/docs/concepts/hooks)
- [Access Control](/docs/concepts/access-control)
- [Background Jobs](/docs/guides/background-jobs)
- [Email Templates](/docs/guides/email-templates)
