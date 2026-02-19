# 💈 TanStack Barbershop Example

A complete barbershop booking system built with **QUESTPIE** + **TanStack Start** + **@questpie/admin**.

## 🎯 What This Demonstrates

### QUESTPIE Features

- ✅ **Collections with Relations** - Barbers, Services, Appointments, Reviews
- ✅ **Better Auth Integration** - Email/password authentication
- ✅ **Queue Jobs** - Background email notifications (pg-boss)
- ✅ **Hooks** - Lifecycle events (afterCreate, afterUpdate)
- ✅ **Type-Safe Client** - Full TypeScript inference

### @questpie/admin Package

- ✅ **CollectionList** - Pre-built table with TanStack Table
- ✅ **CollectionForm** - Pre-built forms with React Hook Form
- ✅ **TanStack DB** - Offline-first with optimistic updates
- ✅ **Realtime Sync** - SSE-based automatic synchronization
- ✅ **Complete shadcn UI** - 53+ components (base-lyra style)

### TanStack Start Integration

- ✅ **File-based routing** - Simple, intuitive structure
- ✅ **API routes** - `/api/*` catch-all handler
- ✅ **Server functions** - Type-safe client/server communication
- ✅ **SSR ready** - Server-side rendering support

## 🚀 Quick Start

### Prerequisites

**ONLY Postgres is required!** Everything else is batteries-included:

- ✅ Auth (Better Auth)
- ✅ Storage (Flydrive - local filesystem)
- ✅ Queue (pg-boss - uses Postgres)
- ✅ Email (Console adapter - no SMTP needed)
- ✅ Logging (Pino)

### Using Docker (Recommended)

```bash
# Start everything with docker-compose
docker-compose up

# The app will be available at:
# - App: http://localhost:3000
# - Admin: http://localhost:3000/admin
```

### Local Development

```bash
# 1. Install dependencies
bun install

# 2. Set up environment
cp .env.example .env
# Edit .env with your Postgres credentials

# 3. Start PostgreSQL
docker-compose up -d

# 4. Run migrations (creates tables)
bun qcms migrate:up

# 5. Start dev server
bun run dev

# Open http://localhost:3000
```

## 📁 Project Structure

```
src/
├── server/
│   └── app.ts              # app configuration (collections, jobs, auth)
├── migrations/
│   ├── index.ts            # Migrations barrel export
│   └── *.ts                # Generated migration files
├── configs/
│   └── admin.ts            # ⭐ Admin UI config (everything auto-generated!)
├── lib/
│   └── client.ts       # Type-safe client
├── routes/
│   ├── api/
│   │   └── app/
│   │       └── $.ts        # API catch-all handler
│   ├── admin.tsx           # Admin layout (uses AdminLayout from package)
│   └── admin/
│       └── $.tsx           # Catch-all (uses AdminRouter from package)
└── components/             # Custom components (optional overrides)
app.config.ts               # CLI configuration for migrations
```

### Key Files

**`app.config.ts`** - CLI configuration for migrations:

```typescript
import { defineConfig } from "@questpie/cli";
import { app } from "./src/server/app";

export default defineConfig({
  qcms: app,
  cli: {
    migrations: {
      directory: "./src/migrations",
    },
  },
});
```

**`src/server/app.ts`** - app instance with migrations:

```typescript
import { migrations } from "../migrations";

export const app = defineQCMS({ name: "barbershop" })
  .collections({ ... })
  .migrations(migrations)  // Load migrations
  .build({ ... });
```

**`src/configs/admin.ts`** - Single source of truth for admin UI:

```typescript
export const adminConfig = defineAdminConfig<App>()({
  app: {
    brand: { name: "Barbershop Admin" },
  },
  collections: {
    barbers: {
      label: "Barbers",
      list: { defaultColumns: ["name", "email", "phone", "isActive"] },
    },
  },
});
```

Everything else is **automatically generated** from this config!

## 🛠️ CLI Commands

QUESTPIE includes a powerful CLI for database migrations:

```bash
# Generate a new migration (after schema changes)
bun qcms migrate:generate

# Run pending migrations
bun qcms migrate:up

# Check migration status
bun qcms migrate:status

# Rollback last batch
bun qcms migrate:down

# Reset all migrations
bun qcms migrate:reset

# Fresh start (reset + run all)
bun qcms migrate:fresh

# Push schema directly (dev only - no migration file)
bun qcms push
```

### Migration Workflow

1. **Make schema changes** in your collection definitions
2. **Generate migration**: `bun qcms migrate:generate`
3. **Review** the generated migration file in `src/migrations/`
4. **Import** migrations in `src/server/app.ts` via `.migrations(migrations)`
5. **Run migration**: `bun qcms migrate:up`

## 🗄️ Database Schema

### Collections

**Barbers** (`barbers`)

- name, email, phone, bio, avatar
- isActive (boolean)
- workingHours (JSON)

**Services** (`services`)

- name, description
- duration (minutes)
- price (cents)
- isActive (boolean)

**Appointments** (`appointments`)

- customerId → questpie_users (Better Auth)
- barberId → barbers
- serviceId → services
- scheduledAt, status, notes
- cancelledAt, cancellationReason

**Reviews** (`reviews`)

- appointmentId → appointments
- customerId → questpie_users
- barberId → barbers
- rating (1-5), comment

## 🔧 Config-Driven Admin Panel

### Everything Auto-Generated from Config

The entire admin UI is generated from `src/configs/admin.ts`:

**What's automatic:**

- ✅ **Sidebar navigation** - from `config.collections`
- ✅ **List views** - columns from `list.defaultColumns`
- ✅ **Routing** - `/admin/:collection/:id` patterns
- ✅ **Relations** - auto-loaded from `list.with`
- ✅ **Realtime sync** - SSE enabled by default
- ✅ **Brand/Logo** - from `app.brand`

**Minimal config example:**

```typescript
export const adminConfig = defineAdminConfig<App>()({
  collections: {
    barbers: {
      label: "Barbers", // That's it! Rest is auto-generated
    },
  },
});
```

**Customize what you need:**

```typescript
barbers: {
  label: "Barbers",
  icon: "user",
  list: {
    defaultColumns: ["name", "email", "phone", "isActive"],
    defaultSort: { field: "name", direction: "asc" },
    with: ["appointments"]  // Auto-load relations
  },
  fields: {
    name: { label: "Full Name" },  // Override field labels
    isActive: {
      list: { renderCell: "StatusBadge" }  // Custom cell renderer
    }
  }
}
```

### Auto-Generated Routes

**No manual route files needed!** All routes auto-generated:

- `/admin` → Dashboard
- `/admin/barbers` → List view
- `/admin/barbers/new` → Create form
- `/admin/barbers/:id` → Edit form

### Components from @questpie/admin Package

```tsx
// Admin layout - auto-generated from config
<AdminLayout config={adminConfig} LinkComponent={Link}>
  {/* Auto sidebar, header, footer */}
</AdminLayout>

// Admin router - auto-generates all CRUD views
<AdminRouter
  config={adminConfig}
  segments={segments}
  navigate={navigate}
/>

// Manual components (for custom overrides)
<CollectionList collection="barbers" columns={[...]} />
<CollectionForm collection="barbers">
  <FormField name="name" required />
</CollectionForm>
```

## 🔐 Authentication

Uses Better Auth with email/password:

```bash
# Register
POST /api/auth/sign-up
{ "email": "user@example.com", "password": "secure123" }

# Login
POST /api/auth/sign-in
{ "email": "user@example.com", "password": "secure123" }

# Get session
GET /api/auth/get-session
```

## 📧 Background Jobs

Queue jobs are automatically set up with pg-boss (uses Postgres - no Redis needed!):

```typescript
// Jobs defined in app.ts
-send -
  appointment -
  confirmation -
  send -
  appointment -
  cancellation -
  send -
  appointment -
  reminder;

// Triggered via hooks
afterCreate: async ({ data }) => {
  await app.queue.sendAppointmentConfirmation.publish({
    appointmentId: data.id,
  });
};
```

To run workers (processes jobs):

```bash
bun run worker
```

## 🎨 Styling

Uses **@questpie/admin** package with:

- Tailwind CSS v4
- shadcn/ui components (base-lyra style)
- oklch color space
- Light/dark theme support

Customization:

```css
/* Override in src/styles.css */
@import "@questpie/admin/styles";

/* Your custom styles */
```

## 🧪 Testing

```bash
# Run tests
bun test

# Type check
bun run check-types

# Lint
bun run lint
```

## 🐳 Docker

### Build image

```bash
docker build -t tanstack-barbershop .
```

### Run with docker-compose

```bash
docker-compose up -d
```

### Environment variables

See `.env.example` for all available options.

## 📚 Learn More

- [QUESTPIE Documentation](../../packages/core/docs/)
- [@questpie/admin Package](../../packages/admin/README.md)
- [TanStack Start Docs](https://tanstack.com/start)
- [Better Auth Docs](https://www.better-auth.com/)

## 🤝 Contributing

This example demonstrates best practices for:

- Collection definitions
- Relations and eager loading
- Background job processing
- Admin UI with pre-built components
- Docker deployment

Feel free to use this as a template for your own projects!

## 📝 License

MIT
