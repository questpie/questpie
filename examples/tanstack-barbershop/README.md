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
bun questpie migrate

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

**`questpie.config.ts`** - CLI configuration:

```typescript
export default {
	app: "./src/questpie/server/.generated/index.ts",
	migrations: { directory: "./src/migrations" },
};
```

**`src/questpie/server/questpie.config.ts`** - App runtime config:

```typescript
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

**`src/questpie/server/modules.ts`** - Module dependencies:

```typescript
import { adminModule } from "@questpie/admin/server";
export default [adminModule] as const;
```

Collections, globals, routes, and admin config are **auto-discovered** by codegen from file conventions.

## 🛠️ CLI Commands

QUESTPIE includes a powerful CLI for database migrations:

```bash
# Generate a new migration (after schema changes)
bun questpie migrate:generate

# Run pending migrations
bun questpie migrate:up

# Check migration status
bun questpie migrate:status

# Rollback last batch
bun questpie migrate:down

# Reset all migrations
bun questpie migrate:reset

# Fresh start (reset + run all)
bun questpie migrate:fresh

# Push schema directly (dev only - no migration file)
bun questpie push
```

### Migration Workflow

1. **Make schema changes** in your collection definitions
2. **Generate migration**: `bun questpie migrate:generate`
3. **Review** the generated migration file in `src/migrations/`
4. **Import** migrations in `src/server/app.ts` via `.migrations(migrations)`
5. **Run migration**: `bun questpie migrate:up`

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

- `src/questpie/server/jobs/send-appointment-confirmation.ts`
- `src/questpie/server/jobs/send-appointment-cancellation.ts`
- `src/questpie/server/jobs/send-appointment-reminder.ts`
- `src/questpie/server/jobs/notify-blog-subscribers.ts`

```typescript
afterChange: async ({ data, operation, queue }) => {
	if (operation === "create") {
		await queue.sendAppointmentConfirmation.publish({
			appointmentId: data.id,
			customerId: data.customer,
		});
	}
};
```

To run workers in development:

```bash
bun run dev:worker
```

To run workers in production:

```bash
bun run worker
```

The worker starts `app.queue.listen()` from `src/worker.ts` and processes queued jobs in a separate process from the web app.

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
