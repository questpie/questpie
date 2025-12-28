# 🪒 Barbershop Example - QUESTPIE CMS + Elysia

A complete, production-ready example of a barbershop booking system built with QUESTPIE CMS and Elysia adapter showcasing **full end-to-end type safety with Eden Treaty**.

## Features

✅ **Collections & Relations**
- Barbers, Services, Appointments, Reviews
- One-to-many and many-to-one relations
- Automatic relation loading with type safety

✅ **Authentication**
- Better Auth integration
- Email/password authentication
- Session management

✅ **Custom Business Logic**
- Check barber availability
- Book appointments with conflict detection
- Cancel appointments
- Customer appointment history

✅ **Background Jobs**
- Email notifications (confirmation, cancellation, reminders)
- Queue-based processing with pg-boss

✅ **Type-Safe Client SDK with Eden Treaty**
- Unified client combining CMS CRUD + Eden Treaty
- Full end-to-end type safety (superior to Hono RPC)
- Automatic response parsing
- Runtime type validation

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up Database

Create a PostgreSQL database:

```bash
createdb barbershop_elysia
```

Set environment variables (create `.env` file):

```env
DATABASE_URL=postgres://localhost/barbershop_elysia
APP_URL=http://localhost:3001
PORT=3001
BETTER_AUTH_SECRET=your-secret-key-change-in-production

# Optional: SMTP for emails
SMTP_HOST=localhost
SMTP_PORT=1025
```

### 3. Run Migrations

```bash
bun run db:migrate
```

This will:
- Create all tables (barbers, services, appointments, reviews)
- Create Better Auth tables (users, sessions, accounts)
- Create queue tables (pg-boss)
- Seed initial data (barbers and services)

### 4. Start the Server

```bash
bun run dev
```

The server will start at http://localhost:3001

### 5. Test the Client

In a separate terminal:

```bash
bun run client
```

This will demonstrate:
- Fetching barbers and services (CMS CRUD)
- Checking availability (Eden Treaty)
- Booking appointments (Eden Treaty with auth)
- Managing appointments
- Comparison with Hono RPC

### 6. (Optional) Start the Worker

For processing background jobs (emails):

```bash
bun run worker
```

## Project Structure

```
elysia-barbershop/
├── src/
│   ├── cms.ts         # CMS configuration (collections, auth, queue, etc.)
│   ├── server.ts      # Elysia server with custom routes
│   └── client.ts      # Eden Treaty client examples
├── migrate.ts         # Database migrations & seeding
├── worker.ts          # Background job worker
└── package.json
```

## API Endpoints

### CMS Routes (Auto-generated)

All collections are accessible via REST API:

- `GET /api/cms/:collection` - List all
- `POST /api/cms/:collection` - Create
- `GET /api/cms/:collection/:id` - Get one
- `PATCH /api/cms/:collection/:id` - Update
- `DELETE /api/cms/:collection/:id` - Delete

### Custom Routes

- `GET /api/barbers/:barberId/availability` - Check available time slots
- `POST /api/appointments/book` - Book an appointment (requires auth)
- `POST /api/appointments/:id/cancel` - Cancel appointment (requires auth)
- `GET /api/my/appointments` - Get user's appointments (requires auth)
- `GET /health` - Health check

### Authentication Routes (Better Auth)

- `POST /api/auth/sign-up/email` - Register
- `POST /api/auth/sign-in/email` - Login
- `POST /api/auth/sign-out` - Logout
- `GET /api/auth/session` - Get session

## Eden Treaty vs Hono RPC

### Elysia + Eden Treaty (This Example)

```typescript
import { createClientFromEden } from "@questpie/elysia/client";

const client = createClientFromEden<App, AppCMS>({ server: "localhost:3001" });

// ✅ Clean API - no $ prefix
const result = await client.api.barbers[":barberId"].availability.get({
  params: { barberId: "123" },
  query: { date: "2025-01-15", serviceId: "456" }
});

// ✅ Response already parsed and typed!
if (result.data) {
  console.log(result.data.availableSlots);
}
```

### Hono RPC

```typescript
import { hc } from "hono/client";

const client = hc<AppType>("http://localhost:3000");

// ⚠️ Requires $ prefix
const result = await client.api.barbers[":barberId"].availability.$get({
  param: { barberId: "123" },
  query: { date: "2025-01-15", serviceId: "456" }
});

// ⚠️ Manual response parsing
if (result.ok) {
  const data = await result.json();
  console.log(data.availableSlots);
}
```

## Key Benefits of Elysia

1. **Superior Type Safety**: Eden Treaty provides true end-to-end type safety
2. **Cleaner API**: No `$get`/`$post` prefixes needed
3. **Automatic Parsing**: Responses are automatically parsed and typed
4. **Runtime Validation**: Built-in schema validation with Elysia's `t` schemas
5. **Better DX**: IntelliSense works perfectly across client and server

## Collections

### Barbers
- Name, email, phone, bio, avatar
- Working hours (JSON)
- Active status

### Services
- Name, description
- Duration (minutes)
- Price (cents)
- Active status

### Appointments
- Customer, Barber, Service references
- Scheduled date/time
- Status (pending, confirmed, completed, cancelled)
- Notes, cancellation reason
- Automatic email notifications via hooks

### Reviews
- Appointment reference
- Customer, Barber references
- Rating (1-5)
- Comment

## Hooks & Queue Jobs

Appointments collection has hooks that automatically trigger jobs:

- **After Create**: Send confirmation email
- **After Update (Cancelled)**: Send cancellation email

Jobs are processed by the worker (pg-boss).

## Tech Stack

- **Framework**: Elysia (with Eden Treaty)
- **CMS**: QUESTPIE CMS
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Better Auth
- **Queue**: pg-boss
- **Email**: Nodemailer + React Email
- **Runtime**: Bun

## License

MIT
