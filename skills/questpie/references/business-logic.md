---
name: questpie-core-business-logic
description:
  QUESTPIE routes jobs services emails route job service email background queue scheduling Zod input validation server-side logic reusable services email templates
  - questpie-core
---

# QUESTPIE Business Logic - Routes, Jobs, Services, Emails

This skill builds on questpie-core. It covers four business-logic primitives: routes (JSON and raw HTTP), jobs (background tasks), services (reusable logic), and emails (templates).

## Contents

- [Routes (JSON)](#routes-json), typed endpoints, input validation, handler context, calling from the client
- [Jobs](#jobs), background tasks, publishing, recurring cron, queue adapter config
- [Raw Routes](#raw-routes), raw HTTP for webhooks, streams, file downloads
- [Services](#services), reusable logic injected into `AppContext`
- [Emails](#emails), templates with Zod input and HTML output
- [Common Mistakes](#common-mistakes)

## Routes (JSON)

JSON routes are typed server-side endpoints. Define an input schema with Zod, write a handler, and call it from the client with full type safety.

### Defining a Route

```ts
// routes/get-active-barbers.ts
import { route } from "questpie/services";
import z from "zod";

export default route()
	.post()
	.schema(z.object({}))
	.handler(async ({ collections }) => {
		return await collections.barbers.find({
			where: { isActive: true },
		});
	});
```

Place files in `routes/`. The filename becomes the route key: `get-active-barbers.ts` maps to `getActiveBarbers`. Files **must** use `export default`.

> **SECURITY, routes are PUBLIC by default.** A route with no `.access()` rule is open to anyone (`evaluateRouteAccess` returns `true` when no rule is set). This is the **opposite** of collections/globals, which default to require-session. Any route that reads private data or performs writes **must** declare `.access()`, e.g. `.access(({ session }) => !!session)`, or `.access(true)` to explicitly mark it public (webhooks verify the signature themselves). The same applies to raw routes.

### Input Validation

JSON routes validate input with Zod automatically:

```ts
// routes/create-booking.ts
import { route } from "questpie/services";
import z from "zod";

export default route()
	.post()
	.access(({ session }) => !!session) // writes need auth, routes are public by default
	.schema(
		z.object({
			barberId: z.string(),
			serviceId: z.string(),
			scheduledAt: z.string().datetime(),
			customerName: z.string().min(2),
			customerEmail: z.string().email(),
			notes: z.string().optional(),
		}),
	)
	.handler(async ({ input, collections }) => {
		const service = await collections.services.findOne({
			where: { id: input.serviceId },
		});
		if (!service) throw new Error("Service not found");

		const appointment = await collections.appointments.create({
			barber: input.barberId,
			service: input.serviceId,
			scheduledAt: new Date(input.scheduledAt),
			status: "pending",
			notes: input.notes || null,
		});

		return {
			success: true,
			appointmentId: appointment.id,
		};
	});
```

### Handler Context

Every handler (route, raw route, job, service, email) receives the same base `AppContext`:

| Property      | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `collections` | Typed collection API                                       |
| `queue`       | Publish background jobs                                    |
| `email`       | Send emails                                                |
| `db`          | Raw database access                                        |
| `session`     | Current auth session                                       |
| `services`    | Custom services from `services/`                           |
| _extensions_  | `appConfig({ context })` result, flat (e.g. `workspaceId`) |

Each primitive then adds its own keys to this base, see the delta tables below. JSON route handlers add:

| Property  | Description                                |
| --------- | ------------------------------------------ |
| `input`   | Validated data matching the Zod schema     |
| `params`  | URL path parameters (when pattern-matched) |
| `locale`  | Current locale                             |
| `request` | The raw `Request`, when executed over HTTP |

Derived request context (from `appConfig({ context })`) reaches route access rules and handlers alike, destructure the keys directly. Inside any nested code, `getContext<App>()` exposes the same keys (see `references/multi-tenancy.md`).

### Calling Routes

From the client SDK:

```ts
import { client } from "@/lib/client";

const result = await client.routes.createBooking({
	barberId: "abc",
	serviceId: "def",
	scheduledAt: "2025-03-15T10:00:00Z",
	customerName: "John",
	customerEmail: "john@example.com",
});
```

Via HTTP: `POST /api/create-booking` with JSON body.

### Nested Routes

Organize in subdirectories for namespacing:

```text
routes/
  booking/
    create.ts          --> client.routes.booking.create()
    cancel.ts          --> client.routes.booking.cancel()
  get-active-barbers.ts --> client.routes.getActiveBarbers()
```

## Jobs

Jobs are background tasks that run outside the request lifecycle. Ideal for sending emails, processing data, or any work that should not block an API response.

### Defining a Job

```ts
// jobs/send-appointment-confirmation.ts
import { job } from "questpie/services";
import z from "zod";

export default job({
	name: "send-appointment-confirmation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
	}),
	handler: async ({ payload, email, collections }) => {
		const customer = await collections.user.findOne({
			where: { id: payload.customerId },
		});
		if (!customer) return;

		const appointment = await collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { barber: true, service: true },
		});
		if (!appointment) return;

		await email.sendTemplate({
			template: "appointmentConfirmation",
			input: {
				customerName: customer.name,
				appointmentId: appointment.id,
				barberName: appointment.barber.name,
				serviceName: appointment.service.name,
				scheduledAt: appointment.scheduledAt.toISOString(),
			},
			to: customer.email,
		});
	},
});
```

Place files in `jobs/`. The filename becomes the job key: `send-appointment-confirmation.ts` maps to `sendAppointmentConfirmation`.

Retry behavior is configured via `options` on the job:

```ts
export default job({
	name: "send-appointment-confirmation",
	schema: z.object({ appointmentId: z.string() }),
	options: {
		retryLimit: 3,
		retryDelay: 5, // seconds, NOT ms
		retryBackoff: true, // exponential
	},
	handler: async ({ payload }) => {
		/* ... */
	},
});
```

### Publishing Jobs

Publish from hooks, routes, or other jobs via the typed `queue` context:

```ts
.hooks({
  afterChange: async ({ data, operation, queue }) => {
    if (operation === "create") {
      await queue.sendAppointmentConfirmation.publish({
        appointmentId: data.id,
        customerId: data.customer,
      }, {
        idempotencyKey: `appointment-confirmation:${data.id}`,
      });
    }
  },
})
```

The `queue` object provides full autocompletion for all jobs and their payloads. `publish()` is ambient-transaction-aware: call and await it directly inside collection hooks. pg-boss inserts the Job through the current Drizzle transaction; BullMQ, Cloudflare, and custom external adapters commit an internal `questpie_queue_dispatch` intent with the business write and relay it after commit. A rollback creates neither.

`idempotencyKey` is portable, scoped to the durable job name, and separate from `singletonKey`. Reusing the same 1-512 character non-secret key returns the same stable logical `dispatchId`; the first payload wins, even after pg-boss retention or an adapter change. QUESTPIE rejects combining `idempotencyKey` with `singletonKey`, because broker singleton suppression cannot identify a newly accepted logical dispatch. Handlers receive optional `dispatchId` and `idempotencyKey` alongside `payload` and `locale`. Delivery remains at-least-once, so use `dispatchId` for downstream dedupe.

### Recurring Jobs (Cron)

Jobs accept a job-level cron expression in `options.cron`. Schedules are registered automatically when the queue worker starts (`app.queue.listen()` calls `registerSchedules()`):

```ts
// jobs/cleanup-expired.ts
import { job } from "questpie/services";
import z from "zod";

export default job({
	name: "cleanup-expired",
	schema: z.object({}),
	options: { cron: "0 3 * * *" }, // every day at 03:00
	handler: async ({ collections }) => {
		await collections.sessions.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});
	},
});
```

Programmatic scheduling from any handler: `queue.cleanupExpired.schedule({}, "0 3 * * *")` and `queue.cleanupExpired.unschedule()`.

Use job-level cron for simple recurring tasks (cleanup, digests, syncs). Reach for **workflow-level cron** (`references/workflows.md`) only when the recurring process needs steps, durable waits, or replay, a workflow is the heavier primitive.

### Job Handler Context

Job handlers receive the base `AppContext` (see [Handler Context](#handler-context)) plus:

| Property         | Description                                  |
| ---------------- | -------------------------------------------- |
| `payload`        | Validated data matching the Zod schema       |
| `locale`         | Current locale                               |
| `dispatchId`     | Stable logical identity across relay retries |
| `idempotencyKey` | Caller-provided portable identity, when set  |

### Queue Adapter Configuration

Jobs require a queue adapter in `questpie.config.ts` (`runtimeConfig({ queue: { adapter } })`). Adapter shapes (pg-boss, BullMQ, Cloudflare Queues) and connection options: `references/infrastructure-adapters.md`.

Email delivery is an application recipe, not a second subsystem: define a typed send-mail Job, call `email.sendTemplate()` in its handler, and dispatch it with `queue.<job>.publish()`. There is no `email.enqueueTemplate()` or mail-specific outbox.

When a Better Auth mutation and its verification dispatch must commit atomically,
use `withAuthTransactionalQueue()` from `questpie/auth` inside a Better Auth
plugin hook. The callback exposes only the transaction-scoped Auth adapter and a
publisher for a concrete Job registered by the app:

```ts
import { withAuthTransactionalQueue } from "questpie/auth";

await withAuthTransactionalQueue(ctx, async ({ auth, publish }) => {
	await auth.create({ model: "verification", data: verification });
	await publish(
		sendVerificationJob,
		{ verificationId: verification.id },
		{
			idempotencyKey: `auth-verification:${verification.id}`,
		},
	);
});
```

The Queue intent joins the Auth database transaction and is encrypted at rest.
Provider I/O still belongs in the Job handler after commit; the bridge does not
expose the general Queue client to sibling Auth plugins.

## Raw Routes

Raw routes (`route().raw()`) give raw HTTP request/response handling for webhooks, OAuth callbacks, health checks, file downloads, and streaming. The handler receives the standard `Request` and must return a `Response`.

### Defining a Raw Route

```ts
// routes/health.ts
import { sql } from "questpie/drizzle";
import { route } from "questpie/services";

export default route()
	.get()
	.raw()
	.access(true)
	.handler(async ({ db }) => {
		const healthy = await db
			.execute(sql`SELECT 1`)
			.then(() => true)
			.catch(() => false);
		return Response.json({ status: healthy ? "ok" : "degraded" });
	});
```

Place files in `routes/`. The file path maps to a flat URL under your `basePath` (`/api` by default):

```text
routes/
  health.ts             --> /api/health
  webhooks/
    stripe.ts           --> /api/webhooks/stripe
  export.ts             --> /api/export
```

### Route Methods

Chain HTTP method calls on the builder (multiple methods = multiple calls):

```ts
route().post().raw().handler(...)          // POST only
route().get().post().raw().handler(...)    // GET + POST
```

Supported: `.get()`, `.post()`, `.put()`, `.delete()`, `.patch()`. The built-in `/auth/*` catch-all is itself a raw route (`route().get().post().raw()` delegating to Better Auth), raw handlers run inside `runWithContext`, so the full request context is live in any code they call.

### Raw Route Handler Context

Raw route handlers receive the base `AppContext` (see [Handler Context](#handler-context)) plus:

| Property  | Type                     | Description              |
| --------- | ------------------------ | ------------------------ |
| `request` | `Request`                | Standard Web API Request |
| `params`  | `Record<string, string>` | URL path parameters      |
| `locale`  | `string`                 | Current locale           |

Raw route handlers must return a `Response` object.

### JSON Routes vs Raw Routes

| Aspect        | JSON route                      | Raw route                         |
| ------------- | ------------------------------- | --------------------------------- |
| **Transport** | HTTP JSON (`/api/{path}`)       | Raw HTTP (`/api/{path}`)          |
| **Input**     | Zod-validated, auto-parsed      | Manual: `request.json()`          |
| **Output**    | Auto-serialized to JSON         | Raw `Response` object             |
| **Client**    | `client.routes.name(input)`     | `client.routes["name"]()`         |
| **Use for**   | Business logic, data operations | Webhooks, file uploads, streaming |

**Rule of thumb**: Use JSON routes for typed input/output with automatic validation. Use raw routes for HTTP-level control (custom headers, binary data, streams, signature verification).

### Webhook Example (Signature Verification)

Webhooks need the raw body for signature verification, exactly what `.raw()` is for:

```ts
// routes/webhooks/stripe.ts
import { route } from "questpie/services";

export default route()
	.post()
	.raw()
	.access(true) // signature IS the auth, verify it yourself below
	.handler(async ({ request, collections, queue }) => {
		const body = await request.text();
		const signature = request.headers.get("stripe-signature");
		const event = verifyStripeWebhook(body, signature); // throws on bad signature
		if (!event) return new Response("Invalid signature", { status: 401 });

		await collections.webhook_events.create({
			type: event.type,
			payload: body,
		});
		await queue.processStripeEvent.publish({ eventId: event.id });

		return new Response("OK", { status: 200 });
	});
```

### Streamed Response Example

Raw routes can return any `Response`, including streams, CSV exports, server-sent progress, large file proxies:

```ts
// routes/export.ts
import { route } from "questpie/services";

export default route()
	.get()
	.raw()
	.access(({ session }) => !!session)
	.handler(async ({ collections }) => {
		const { docs } = await collections.orders.find({ limit: 10_000 });

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue("id,total,createdAt\n");
				for (const order of docs) {
					controller.enqueue(
						`${order.id},${order.total},${order.createdAt.toISOString()}\n`,
					);
				}
				controller.close();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": 'attachment; filename="orders.csv"',
			},
		});
	});
```

## Services

Services are reusable units of logic injected into `AppContext` under the `services` key. Define in `services/`, and they become available in every hook, route, and job handler.

### Defining a Service

```ts
// services/blog.ts
import { service } from "questpie/services";
const WORDS_PER_MINUTE = 200;

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, " ");
}

export default service({
	lifecycle: "singleton",
	create: () => ({
		computeReadingTime(content: string): number {
			const text = stripHtml(content);
			const words = text
				.trim()
				.split(/\s+/)
				.filter((w) => w.length > 0).length;
			return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
		},

		generateSlug(title: string): string {
			return title
				.toLowerCase()
				.replace(/[^a-z0-9\s-]/g, "")
				.trim()
				.replace(/\s+/g, "-");
		},
	}),
});
```

The filename becomes the key: `services/blog.ts` maps to `ctx.services.blog`.

### Using Services

Services are available via `services` destructuring in any handler:

```ts
.hooks({
  beforeChange: async ({ data, services }) => {
    const { blog } = services;
    if (data.content) {
      data.readingTime = blog.computeReadingTime(data.content);
    }
    if (data.title) {
      data.slug = blog.generateSlug(data.title);
    }
  },
})
```

### Lifecycle

| Lifecycle     | Created             | Destroyed      | Use for                                  |
| ------------- | ------------------- | -------------- | ---------------------------------------- |
| `"singleton"` | Once at app startup | App shutdown   | External clients, SDKs, connection pools |
| `"request"`   | Per request         | End of request | Tenant-scoped DB, user-specific config   |

### Singleton Service

```ts
// services/stripe.ts
import { service } from "questpie/services";
import Stripe from "stripe";

export default service({
	lifecycle: "singleton",
	create: () => new Stripe(process.env.STRIPE_SECRET_KEY!),
});
```

### Request-Scoped Service

```ts
// services/tenant-db.ts
import { service } from "questpie/services";
export default service({
	lifecycle: "request",
	create: ({ db, session }) => {
		return createScopedDb(db, session?.user?.tenantId);
	},
	dispose: (scopedDb) => scopedDb.release(),
});
```

### Dependencies

There is no `deps` option. `create(ctx)` receives the full `AppContext`, destructure whatever the service needs:

```ts
// services/analytics.ts
import { service } from "questpie/services";
export default service({
	create: (ctx) => {
		const { db } = ctx;
		return new AnalyticsService(db);
	},
});
```

Available on the context: `db`, `kv`, `email`, `queue`, `storage`, `search`, `realtime`, `session`, `collections`, other `services`, plus any `appConfig({ context })` extensions.

### Disposal

Optional `dispose` for cleanup (singleton: at shutdown, request: at end of request):

```ts
export default service({
	lifecycle: "singleton",
	create: () => createConnectionPool(),
	dispose: async (pool) => {
		await pool.close();
	},
});
```

### API Reference

```ts
service({
  lifecycle?: "singleton" | "request",          // default: "singleton"
  create: (ctx) => TInstance,                   // factory; ctx is the full AppContext
  dispose?: (instance) => void | Promise<void>, // cleanup
})
```

## Emails

Email templates are defined in `emails/` and discovered by codegen. Each template has a Zod input schema and a handler that returns `{ subject, html }`.

### Defining an Email Template

```ts
// emails/appointment-confirmation.ts
import { email } from "questpie/services";
import { z } from "zod";

export default email({
	name: "appointment-confirmation",
	schema: z.object({
		customerName: z.string(),
		appointmentId: z.string(),
		barberName: z.string(),
		serviceName: z.string(),
		scheduledAt: z.string(),
	}),
	handler: ({ input }) => ({
		subject: "Appointment Confirmed",
		html: `
      <h1>Appointment Confirmed</h1>
      <p>Hi ${input.customerName}, your appointment is confirmed!</p>
      <p><strong>Service:</strong> ${input.serviceName}</p>
      <p><strong>Barber:</strong> ${input.barberName}</p>
      <p><strong>Date:</strong> ${input.scheduledAt}</p>
    `,
	}),
});
```

The filename becomes the template key: `appointment-confirmation.ts` maps to `email.sendTemplate({ template: "appointmentConfirmation", ... })`.

### Sending Emails

Use `email.sendTemplate()` from any handler:

```ts
await email.sendTemplate({
	template: "appointmentConfirmation",
	to: customer.email,
	input: {
		customerName: customer.name,
		appointmentId: appointment.id,
		barberName: appointment.barber.name,
		serviceName: appointment.service.name,
		scheduledAt: appointment.scheduledAt.toISOString(),
	},
});
```

### Dynamic Email Templates

Email handlers receive the full `AppContext` for fetching data:

```ts
// emails/weekly-digest.ts
import { email } from "questpie/services";
import { z } from "zod";

export default email({
	name: "weekly-digest",
	schema: z.object({ userId: z.string() }),
	handler: async ({ input, collections }) => {
		const user = await collections.users.findOne({
			where: { id: input.userId },
		});
		const recentPosts = await collections.posts.find({
			where: { createdAt: { gte: oneWeekAgo() } },
			limit: 5,
		});

		return {
			subject: `Weekly digest for ${user.name}`,
			html: renderDigestHtml(user, recentPosts.docs),
			text: renderDigestText(user, recentPosts.docs),
		};
	},
});
```

### Email Result

| Property  | Type     | Required | Description         |
| --------- | -------- | -------- | ------------------- |
| `subject` | `string` | Yes      | Email subject line  |
| `html`    | `string` | Yes      | HTML body           |
| `text`    | `string` | No       | Plain text fallback |

## Common Mistakes

1. **HIGH: Forgetting `.access()` on a route.**
   Routes are PUBLIC by default, a route with no `.access()` rule serves anyone. This is the opposite of collections/globals (require-session by default). Every route that reads private data or performs writes must declare `.access()`. Use `.access(true)` only when the route is intentionally public.

2. **HIGH: Not using `export default` on route/job/service/email files.**
   Codegen discovery requires `export default`. Named exports are not discovered.

3. **MEDIUM: Accessing `app.collections`/`app.globals` without context.**
   For server-side calls to the collection API, you must create a context first: `const ctx = await app.createContext({ accessMode: "system" })`. Then pass it: `app.collections.posts.find({}, ctx)`.

4. **MEDIUM: Defining job handlers without queue configuration.**
   Jobs require a queue adapter in production config. Without it, `queue.jobName.publish()` calls will fail at runtime. Configure via `runtimeConfig({ queue: { adapter: pgBossAdapter(...) } })`.

5. **MEDIUM: Confusing route keys with filenames.**
   Filenames use kebab-case (`get-active-barbers.ts`) but the key is camelCase (`getActiveBarbers`). The client SDK uses the camelCase key: `client.routes.getActiveBarbers()`.
