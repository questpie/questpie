---
name: questpie-core-business-logic
description: QUESTPIE routes jobs services emails route job service email background queue scheduling Zod input validation server-side logic reusable services email templates
  - questpie-core
---

# QUESTPIE Business Logic - Routes, Jobs, Services, Emails

This skill builds on questpie-core. It covers four business-logic primitives: routes (JSON and raw HTTP), jobs (background tasks), services (reusable logic), and emails (templates).

## Routes (JSON)

JSON routes are typed server-side endpoints. Define an input schema with Zod, write a handler, and call it from the client with full type safety.

### Defining a Route

```ts
// routes/get-active-barbers.ts
import { route } from "questpie";
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

### Input Validation

JSON routes validate input with Zod automatically:

```ts
// routes/create-booking.ts
import { route } from "questpie";
import z from "zod";

export default route()
	.post()
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

Route handlers receive the full `AppContext`:

| Property      | Description                            |
| ------------- | -------------------------------------- |
| `input`       | Validated data matching the Zod schema |
| `collections` | Typed collection API                   |
| `queue`       | Publish background jobs                |
| `email`       | Send emails                            |
| `db`          | Raw database access                    |
| `session`     | Current auth session                   |
| `services`    | Custom services from `services/`       |

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
import { job } from "questpie";
import z from "zod";

export default job({
	name: "sendAppointmentConfirmation",
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

### Publishing Jobs

Publish from hooks, routes, or other jobs via the typed `queue` context:

```ts
.hooks({
  afterChange: async ({ data, operation, queue }) => {
    if (operation === "create") {
      await queue.sendAppointmentConfirmation.publish({
        appointmentId: data.id,
        customerId: data.customer,
      });
    }
  },
})
```

The `queue` object provides full autocompletion for all jobs and their payloads.

### Job Handler Context

| Property      | Description                            |
| ------------- | -------------------------------------- |
| `payload`     | Validated data matching the Zod schema |
| `collections` | Typed collection API                   |
| `email`       | Email service                          |
| `queue`       | Publish other jobs                     |
| `db`          | Database instance                      |

### Queue Adapter Configuration

Configure the queue adapter in your runtime config:

```ts
// questpie.config.ts
import { pgBossAdapter, runtimeConfig } from "questpie";

export default runtimeConfig({
	queue: {
		adapter: pgBossAdapter({
			connectionString: process.env.DATABASE_URL,
		}),
	},
});
```

## Routes

Routes give raw HTTP request/response handling for webhooks, OAuth callbacks, health checks, file downloads, and streaming.

### Defining a Route

```ts
// routes/health.ts
import { route } from "questpie";

export default route({
	method: "GET",
	handler: async ({ db }) => {
		const healthy = await db
			.execute(sql`SELECT 1`)
			.then(() => true)
			.catch(() => false);
		return Response.json({ status: healthy ? "ok" : "degraded" });
	},
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

```ts
route({ method: "POST", handler: ... })           // Single method
route({ method: ["GET", "POST"], handler: ... })   // Multiple methods
route({ handler: ... })                            // All methods (default)
```

Supported: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`.

### Route Handler Context

| Property      | Type                     | Description              |
| ------------- | ------------------------ | ------------------------ |
| `request`     | `Request`                | Standard Web API Request |
| `params`      | `Record<string, string>` | URL path parameters      |
| `locale`      | `string`                 | Current locale           |
| `db`          | `Database`               | Database instance        |
| `session`     | `Session \| null`        | Current auth session     |
| `collections` | `CollectionsAPI`         | Typed collection API     |
| `queue`       | `QueueClient`            | Queue client             |
| `email`       | `MailerService`          | Email service            |
| `services`    |                          | User-defined services    |

Route handlers must return a `Response` object.

### JSON Routes vs Raw Routes

| Aspect        | JSON route                      | Raw route                         |
| ------------- | ------------------------------- | --------------------------------- |
| **Transport** | HTTP JSON (`/api/{path}`)       | Raw HTTP (`/api/{path}`)          |
| **Input**     | Zod-validated, auto-parsed      | Manual: `request.json()`          |
| **Output**    | Auto-serialized to JSON         | Raw `Response` object             |
| **Client**    | `client.routes.name(input)`     | `client.routes["name"]()`         |
| **Use for**   | Business logic, data operations | Webhooks, file uploads, streaming |

**Rule of thumb**: Use JSON routes for typed input/output with automatic validation. Use raw routes for HTTP-level control (custom headers, binary data, streams, signature verification).

### Webhook Example

```ts
// routes/webhooks/stripe.ts
import { route } from "questpie";

export default route({
	method: "POST",
	handler: async ({ request, db }) => {
		const body = await request.text();
		const signature = request.headers.get("stripe-signature");
		const event = verifyStripeWebhook(body, signature);

		await db.insert(webhookEvents).values({
			type: event.type,
			payload: body,
		});

		return new Response("OK", { status: 200 });
	},
});
```

## Services

Services are reusable units of logic injected into `AppContext` under the `services` key. Define in `services/`, and they become available in every hook, route, and job handler.

### Defining a Service

```ts
// services/blog.ts
import { service } from "questpie";

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
import { service } from "questpie";
import Stripe from "stripe";

export default service({
	lifecycle: "singleton",
	create: () => new Stripe(process.env.STRIPE_SECRET_KEY!),
});
```

### Request-Scoped Service

```ts
// services/tenant-db.ts
import { service } from "questpie";

export default service({
	lifecycle: "request",
	deps: ["db", "session"] as const,
	create: ({ db, session }) => {
		return createScopedDb(db, session?.user?.tenantId);
	},
	dispose: (scopedDb) => scopedDb.release(),
});
```

### Dependencies

Services can depend on other services and infrastructure via `deps`. Use `as const` for type safety:

```ts
// services/analytics.ts
import { service } from "questpie";

export default service({
	deps: ["db", "logger"] as const,
	create: ({ db, logger }) => {
		logger.info("Analytics service initialized");
		return new AnalyticsService(db);
	},
});
```

Available dependencies: `db`, `logger`, `kv`, `email`, `queue`, `storage`, `search`, `realtime`, `session`, and any user-defined services.

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
  lifecycle?: "singleton" | "request",        // default: "singleton"
  deps?: readonly string[],                   // dependencies from AppContext
  create: (deps) => TInstance,                // factory function
  dispose?: (instance) => void | Promise<void>, // cleanup
})
```

## Emails

Email templates are defined in `emails/` and discovered by codegen. Each template has a Zod input schema and a handler that returns `{ subject, html }`.

### Defining an Email Template

```ts
// emails/appointment-confirmation.ts
import { email } from "questpie";
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
import { email } from "questpie";
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

1. **HIGH: Putting business logic in route files.**
   Framework route files should only mount HTTP handlers. Business logic belongs in routes, hooks, or services. Raw routes are for HTTP control (webhooks, file downloads, streaming).

2. **HIGH: Not using `export default` on route/job/service/email files.**
   Codegen discovery requires `export default`. Named exports are not discovered.

3. **MEDIUM: Accessing `app.collections`/`app.globals` without context.**
   For server-side calls to the collection API, you must create a context first: `const ctx = await app.createContext({ accessMode: "system" })`. Then pass it: `app.collections.posts.find({}, ctx)`.

4. **MEDIUM: Defining job handlers without queue configuration.**
   Jobs require a queue adapter in production config. Without it, `queue.jobName.publish()` calls will fail at runtime. Configure via `runtimeConfig({ queue: { adapter: pgBossAdapter(...) } })`.

5. **MEDIUM: Confusing route keys with filenames.**
   Filenames use kebab-case (`get-active-barbers.ts`) but the key is camelCase (`getActiveBarbers`). The client SDK uses the camelCase key: `client.routes.getActiveBarbers()`.
