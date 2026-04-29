# RFC: Context-First Architecture

> Status: **Draft**
> Authors: @drepkovsky
> Date: 2026-02-25
> Supersedes: RFC-FILE-CONVENTION §5.3, §9; RFC-MODULE-ARCHITECTURE §9–10

---

## Summary

QUESTPIE's core is an **empty framework**. It provides builder primitives (`CollectionBuilder`, `GlobalBuilder`), a codegen engine, and a plugin API — but zero fields, zero views, zero collections, zero services. Everything is contributed by **modules** and **plugins**, wired together by codegen, and made available to every handler through a single extensible interface: **`AppContext`**.

There is no god object. No `Questpie<TConfig>` generic. No `App` type. The runtime `app` is a simple extensible object where everything sits flat. Plugins and modules add their keys horizontally — fields, views, services, routes, collections — through the same mechanism.

---

## §1 Motivation

### The Problem

Previous architecture had a `Questpie<TConfig>` generic class that accumulated the entire app state as one massive type parameter. This caused:

- **TS7056** — TypeScript could not serialize the inferred type into `.d.ts`
- **`any` everywhere** — handlers received `app: any`, `db: any`, `session: any`
- **God object** — `app.db`, `app.queue`, `app.email` — everything accessed through one instance
- **Prototype patches** — admin extensions like `.admin()`, `.list()` monkey-patched `CollectionBuilder.prototype`
- **Hardcoded features** — builtin fields, auth collections baked into core

### The Solution

1. **`AppContext`** — empty interface in core, augmented via `declare module "questpie"` in generated code
2. **Every handler** (hooks, access, functions, jobs, routes) extends `AppContext` — flat destructuring, full types
3. **No `Questpie<>` in user code** — internal type derivation only, never exported
4. **No `App` type** — the runtime `app` is `AppContext & lifecycle`, `AppConfig` for client APIs
5. **Proxy-based extensions** — no prototype mutation, `declare module` for types + `Proxy` for runtime
6. **Empty core** — fields, views, collections all come from modules via codegen

---

## §2 AppContext — The Universal Context

### Core Definition

```ts
// packages/questpie/src/server/config/app-context.ts
export interface AppContext {}
```

Empty by default. **Every handler context extends it:**

```ts
interface HookContext<TData, TOriginal, TOperation> extends AppContext {
	data: TData;
	original: TOriginal | undefined;
	operation: TOperation;
}

interface FunctionHandlerArgs<TInput> extends AppContext {
	input: TInput;
}

interface JobHandlerArgs<TPayload> extends AppContext {
	payload: TPayload;
}

interface RouteHandlerArgs extends AppContext {
	request: Request;
	params: Record<string, string>;
}

interface AccessContext<TData> extends AppContext {
	data?: TData;
}
```

### Generated Augmentation

Codegen produces `declare module "questpie"` that fills `AppContext` with typed services:

```ts
// .generated/index.ts (auto-generated)
declare module "questpie" {
  interface AppContext {
    // Infrastructure (from runtimeConfig)
    db: DrizzleClient<AppSchema>;
    queue: QueueClient<AppJobs>;
    email: MailerService;
    storage: StorageManager;
    kv: KVService;
    logger: LoggerService;
    search: SearchService;
    realtime: RealtimeService;

    // Entity APIs (from collections/ and globals/)
    collections: { posts: CollectionCRUD<...>; users: CollectionCRUD<...> };
    globals: { siteSettings: GlobalCRUD<...> };

    // Request-scoped
    session: { user: User; session: Session } | null;
    t: (key: AppMessageKeys | (string & {}), params?: Record<string, unknown>) => string;

    // User services (from services/*.ts)
    stripe: Stripe;
    analytics: AnalyticsService;
  }
}
```

### Result: Every Handler Gets Everything

```ts
// In a hook — all typed, zero imports needed:
hooks: {
	afterChange: [
		async ({ data, db, session, queue, email, stripe }) => {
			if (data.status === "published") {
				await queue.sendNotification.publish({ postId: data.id });
				await email.send({
					to: "admin@example.com",
					subject: "New post",
					html: "<p>New post published</p>",
				});
				stripe.events.track("post_published");
			}
		},
	];
}

// In a function:
export default fn({
	schema: z.object({ postId: z.string() }),
	handler: async ({ input, db, collections }) => {
		return await collections.posts.findOne({
			where: { id: input.postId },
			with: { author: true },
		});
	},
});

// In a job:
export default job({
	name: "send-weekly-digest",
	schema: z.object({ userId: z.string() }),
	handler: async ({ payload, db, email, collections }) => {
		const user = await collections.users.findOne({
			where: { id: payload.userId },
		});
		const posts = await collections.posts.find({
			limit: 10,
			orderBy: { createdAt: "desc" },
		});
		await email.send({
			to: user.email,
			subject: "Weekly Digest",
			html: renderDigest(posts),
		});
	},
});
```

### Plugin Extensibility

Any plugin can add keys to `AppContext`:

```ts
// @questpie/channels plugin
declare module "questpie" {
	interface AppContext {
		channels: ChannelsService;
	}
}

// Now EVERY handler gets `channels` typed:
async ({ data, channels }) => {
	await channels.broadcast("post-updates", { action: "created", post: data });
};
```

---

## §3 The Empty Core

### What Core Provides

Core (`packages/questpie`) is a **framework** — it provides primitives, not features:

| Primitive              | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `CollectionBuilder`    | Immutable builder for defining collections (fields, hooks, access, relations) |
| `GlobalBuilder`        | Immutable builder for defining globals                                        |
| `createApp()`          | Runtime assembly — creates the app object from definition + runtime config    |
| `AppContext`           | Empty extensible interface — the universal handler context                    |
| `extractAppServices()` | Flattens app instance into AppContext shape                                   |
| Codegen engine         | File discovery + template generation                                          |
| `CodegenPlugin` API    | Extension point for plugins to discover files and register builder extensions |
| Type utilities         | `GetCollection`, `GetGlobal`, `CollectionSelect`, etc.                        |
| HTTP adapter           | `createFetchHandler()` — URL dispatch (§7)                                    |
| CRUD generator         | Generates typed CRUD APIs from collection/global definitions                  |

### What Core Does NOT Provide

- **No field types** — no `f.text()`, no `f.number()`, nothing
- **No view types** — no `v.table()`, no `v.form()`
- **No collections** — no users, sessions, assets
- **No auth** — no session management, no login
- **No i18n messages** — no error strings
- **No admin UI** — no sidebar, dashboard, branding

### Everything Comes From Modules

```
┌─ starter module ──────────────┐  ┌─ admin module ─────────────────┐
│                               │  │                                │
│  Fields:                      │  │  Fields:                       │
│  • text, textarea, email, url │  │  • richText, blocks            │
│  • number, boolean            │  │                                │
│  • date, datetime, time       │  │  Views:                        │
│  • select, relation, upload   │  │  • table, form                 │
│  • object, array, json        │  │                                │
│                               │  │  Components:                   │
│  Collections:                 │  │  • icon, badge                 │
│  • user, session, account     │  │                                │
│  • verification, apikey       │  │  Builder Extensions:           │
│  • assets                     │  │  • .admin(), .list(), .form()  │
│                               │  │  • .preview(), .actions()      │
│  Auth:                        │  │                                │
│  • default auth configuration │  │  Collections:                  │
│                               │  │  • adminPreferences            │
│  Messages:                    │  │  • savedViews, adminLocks      │
│  • en locale (error strings)  │  │                                │
│                               │  │  Sidebar, Dashboard, Branding  │
│  Default Access Rules         │  │                                │
│                               │  │  Functions:                    │
│  Jobs:                        │  │  • setup, locale, preview,     │
│  • realtimeCleanup            │  │    adminConfig, actions,       │
│                               │  │    translation, reactive, ...  │
└───────────────────────────────┘  └────────────────────────────────┘
```

### How Fields Are Injected

Fields come from modules, injected by codegen into the generated `collection()` factory:

```ts
// .generated/factories.ts (auto-generated)

// Fields merged from ALL modules:
// starter contributes: text, number, boolean, date, select, relation, ...
// admin contributes: richText, blocks
// The codegen merges them from module definitions.

export function collection(name) {
	return _wrapColl(
		new CollectionBuilder({
			name,
			fieldTypes: _mergedFieldTypes, // ← injected by codegen
			fields: {},
			// ...
		}),
	);
}
```

User writes:

```ts
import { collection } from "#questpie";

export const posts = collection("posts").fields(({ f }) => ({
	title: f.text({ required: true }), // ← from starter module
	body: f.richText(), // ← from admin module
}));
```

`f` proxy knows all available field types because codegen injected them. Core doesn't know or care what fields exist.

---

## §4 Primitives — Routes, Functions, Jobs, Services

QUESTPIE provides four handler primitives. Each receives `AppContext` with full typed services.

### §4.1 Functions — Type-Safe Remote Procedures

**Purpose:** Validated input → typed output. Auto-serialized JSON. Schema-driven.

**File convention:** `functions/**/*.ts` — nested folders become nested namespaces.

```ts
// functions/get-revenue-stats.ts
import { fn } from "questpie";
import { z } from "zod";

export default fn({
	schema: z.object({
		period: z.enum(["week", "month", "year"]),
	}),
	access: ({ session }) => session?.user.role === "admin",
	handler: async ({ input, db }) => {
		const stats = await db
			.select()
			.from(orders)
			.where(gte(orders.createdAt, getPeriodStart(input.period)));
		return { revenue: stats.reduce((sum, o) => sum + o.total, 0) };
	},
});
```

**URL:** `POST /rpc/getRevenueStats` — body: `{ "period": "month" }`

**Nested namespaces:**

```
functions/
  admin/
    get-users.ts      → POST /rpc/admin/getUsers
    ban-user.ts       → POST /rpc/admin/banUser
  get-active-barbers.ts → POST /rpc/getActiveBarbers
```

**Key properties:**

- `schema` — Zod schema validates input before handler runs
- `outputSchema` — optional, validates output
- `access` — access control callback or boolean
- `handler` — receives `{ input, ...AppContext }`
- Always `POST`, always JSON serialized
- Type-safe client: `client.rpc.admin.getUsers({ limit: 10 })`

**Raw SQL with table references:**

For complex SQL (JOINs, aggregations, window functions), use `db` directly.
Import the collection builder from its source file — the `.table` property is
the Drizzle table schema:

```ts
import { appointments } from "../collections/appointments";
import { services } from "../collections/services";

export default fn({
  handler: async ({ input, db }) => {
    const result = await db.select({
      totalRevenue: sql`COALESCE(SUM(${(services as any).table.price}), 0)`,
      count: sql`COUNT(*)`,
    })
    .from((appointments as any).table)
    .innerJoin((services as any).table, eq(...));
    return result[0];
  }
});
```

**Prefer `collections` API for most cases.** Fall back to raw `db` + imported
tables only when SQL expressiveness is essential (aggregations, window functions, CTEs).

**Raw mode** — when you need direct `Request`/`Response` control:

```ts
import { fn } from "questpie";

export default fn({
	mode: "raw",
	handler: async ({ request, db }) => {
		const csv = await generateCSV(db);
		return new Response(csv, { headers: { "Content-Type": "text/csv" } });
	},
});
```

### §4.2 Routes — Raw HTTP Handlers

**Purpose:** Full HTTP control. Any method. Direct `Request` → `Response`.

**File convention:** `routes/**/*.ts`

```ts
// routes/webhooks/stripe.ts
import { route } from "questpie";

export default route({
	method: "POST",
	handler: async ({ request, db, queue }) => {
		const sig = request.headers.get("stripe-signature");
		const body = await request.text();

		const event = verifyStripeWebhook(body, sig, process.env.STRIPE_SECRET!);

		switch (event.type) {
			case "checkout.session.completed":
				await queue.processPayment.publish({ sessionId: event.data.object.id });
				break;
			case "invoice.payment_failed":
				await queue.handleFailedPayment.publish({
					invoiceId: event.data.object.id,
				});
				break;
		}

		return new Response("ok", { status: 200 });
	},
});
```

**URL:** `POST /routes/webhooks/stripe`

**Key differences from functions:**

- Any HTTP method (`GET`, `POST`, `PUT`, `DELETE`, etc.)
- No schema validation — you parse the request yourself
- No automatic serialization — you return a `Response` directly
- No access control callback — you handle auth yourself
- Good for: webhooks, file downloads, SSE streams, health checks, OAuth callbacks

```ts
// routes/health.ts
export default route({
	method: "GET",
	handler: async ({ db }) => {
		const ok = await db.execute(sql`SELECT 1`);
		return Response.json({ status: "ok", db: !!ok });
	},
});
```

### §4.3 When to Use Functions vs Routes

|                    | Functions (`fn`)                           | Routes (`route`)                     |
| ------------------ | ------------------------------------------ | ------------------------------------ |
| **Input**          | Zod-validated JSON body                    | Raw `Request` — parse yourself       |
| **Output**         | Auto-serialized (JSON/SuperJSON)           | Raw `Response` — build yourself      |
| **HTTP method**    | Always `POST`                              | Any method                           |
| **Access control** | Built-in `access` callback                 | Handle yourself                      |
| **Client SDK**     | `client.rpc.myFunction(input)` — type-safe | Not in client SDK                    |
| **Use for**        | Business logic, queries, mutations         | Webhooks, downloads, streams, health |
| **URL pattern**    | `/rpc/{name}`                              | `/routes/{path}`                     |

**Rule of thumb:** If the caller is your own frontend → **function**. If the caller is an external service or needs non-JSON responses → **route**.

### §4.4 Jobs — Background Processing

**Purpose:** Async work. Queued, retried, scheduled.

**File convention:** `jobs/*.ts`

```ts
// jobs/send-appointment-confirmation.ts
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-appointment-confirmation",
	schema: z.object({
		appointmentId: z.string(),
		customerEmail: z.string().email(),
	}),
	options: {
		retryLimit: 3,
		retryDelay: 5, // seconds
		retryBackoff: true,
	},
	handler: async ({ payload, db, email, collections }) => {
		const appointment = await collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { barber: true, service: true },
		});

		await email.send({
			to: payload.customerEmail,
			subject: `Appointment confirmed with ${appointment.barber.name}`,
			html: renderConfirmationEmail(appointment),
		});
	},
});
```

**Dispatching from any handler:**

```ts
// In a hook, function, route, or another job:
async ({ data, queue }) => {
	await queue.sendAppointmentConfirmation.publish({
		appointmentId: data.id,
		customerEmail: data.customerEmail,
	});
};
```

**Queue API per job:**

- `queue.jobName.publish(payload, options?)` — enqueue for immediate processing
- `queue.jobName.schedule(payload, cron)` — schedule recurring execution
- `queue.jobName.unschedule()` — cancel scheduled execution

**Workflows** — multi-step jobs with checkpointing:

```ts
import { workflow } from "questpie";

export default workflow("onboard-customer")
	.step("create-account", async ({ payload, db }) => {
		const user = await db.insert(users).values(payload).returning();
		return { userId: user.id };
	})
	.step("send-welcome", async ({ payload, email }) => {
		await email.send({ to: payload.email, subject: "Welcome!" });
		return payload;
	})
	.step("setup-defaults", async ({ payload, collections }) => {
		await collections.preferences.create({
			userId: payload.userId,
			theme: "light",
		});
	})
	.build(z.object({ email: z.string(), name: z.string() }));
```

### §4.5 Services — Dependency Injection

**Purpose:** First-class, typed, lifecycle-managed dependencies. Flat on AppContext.

**File convention:** `services/*.ts`

**Factory:** `service()` (identity function for type inference, consistent with `collection`, `global`, `route`, `fn`, `job`)

#### Service Definition

```ts
interface ServiceDefinition<TDeps extends readonly string[], TInstance> {
	/**
	 * Lifecycle determines when the service is created:
	 * - "singleton" — created once at app startup, destroyed at app.destroy()
	 * - "request" — created fresh per request, disposed at end of request
	 * @default "singleton"
	 */
	lifecycle?: "singleton" | "request";

	/**
	 * Dependencies — names of infrastructure or other services this service needs.
	 * Resolved from AppContext before calling create().
	 * Use `as const` for type-safe deps:
	 *   deps: ["db", "logger"] as const
	 */
	deps?: TDeps;

	/**
	 * Factory function. Receives resolved dependencies as an object.
	 */
	create: (deps: Record<TDeps[number], any>) => TInstance;

	/**
	 * Cleanup function called when the service is destroyed.
	 * For singletons: called at app.destroy() (server shutdown).
	 * For request-scoped: called at end of request (if handler completes).
	 */
	dispose?: (instance: TInstance) => void | Promise<void>;
}
```

#### Singleton Services

Created once at startup. Shared across all requests. Good for SDK clients, connection pools, external API wrappers.

```ts
// services/stripe.ts
import { service } from "#questpie";
import Stripe from "stripe";

export default service({
	lifecycle: "singleton",
	create: () => new Stripe(process.env.STRIPE_SECRET_KEY!),
});
```

```ts
// services/geocoding.ts
import { service } from "#questpie";

export default service({
	lifecycle: "singleton",
	deps: ["logger"] as const,
	create: ({ logger }) => {
		logger.info("Geocoding service initialized");
		return new GeocodingClient({ apiKey: process.env.MAPS_API_KEY! });
	},
	dispose: (instance) => instance.close(),
});
```

#### Request-Scoped Services

Created fresh per request. Good for tenant-scoped connections, user-specific config.

```ts
// services/tenant-db.ts
import { service } from "#questpie";

export default service({
	lifecycle: "request",
	deps: ["db", "session"] as const,
	create: ({ db, session }) => {
		const tenantId = session?.user?.tenantId;
		return tenantId ? createScopedDb(db, tenantId) : db;
	},
});
```

#### Dependency Resolution

Services can depend on:

- **Infrastructure** — `db`, `email`, `queue`, `storage`, `kv`, `logger`, `search`, `realtime`
- **Other services** — singleton services can depend on other singletons (resolved in registration order)
- **Request context** — request-scoped services also get `session` and other request-level deps

Resolution order for singletons at startup:

1. Infrastructure services initialized (db, queue, email, storage, etc.)
2. Singleton services created in registration order
3. Each service's `deps` resolved from infrastructure + already-created singletons

Resolution for request-scoped services per request:

1. Infrastructure deps from app instance
2. Singleton service instances from cache
3. Request-scoped overrides (session, transaction db)

#### How Services Get Injected

Codegen discovers `services/*.ts`, derives the instance type via `ServiceInstanceOf<>`, and augments AppContext:

```ts
// Generated — declare module "questpie"
interface AppContext {
	// ... infrastructure ...
	stripe: ServiceInstanceOf<typeof _svc_stripe>; // Stripe
	geocoding: ServiceInstanceOf<typeof _svc_geocoding>; // GeocodingClient
	tenantDb: ServiceInstanceOf<typeof _svc_tenantDb>; // DrizzleClient
}
```

At runtime, `extractAppServices()` resolves all services from the app instance and injects them flat into handler context:

```ts
// Every handler gets all services flat:
async ({ data, db, stripe, geocoding, tenantDb, session }) => {
	const location = await geocoding.geocode(data.address);
	const charge = await stripe.charges.create({
		amount: data.price * 100,
		currency: "usd",
	});
	await tenantDb.insert(orders).values({ ...data, location });
};
```

#### Lifecycle & Cleanup

Singleton services are disposed when `app.destroy()` is called:

```ts
// At server shutdown:
await app.destroy();
// → Calls dispose() on each singleton service that defines it
// → Closes database connections
// → Stops queue workers
// → Cleans up realtime subscriptions
```

This prevents connection leaks during server shutdown or HMR in development.

---

## §5 The HTTP Adapter — `createFetchHandler`

### Overview

`createFetchHandler(app)` returns a single `(request: Request) => Promise<Response>` function. It dispatches based on URL segments:

```
Request
  ↓
Parse URL, strip basePath
  ↓
Match first segment:
  /auth/**           → Better Auth (login, signup, session, OAuth)
  /search            → Full-text search (POST)
  /search/reindex/:c → Reindex collection (POST)
  /rpc/:path...      → Function dispatch (POST) — §4.1
  /realtime          → SSE multiplexed subscriptions (POST)
  /routes/:path...   → Custom route dispatch (any method) — §4.2
  /globals/:name     → Global CRUD (GET, PATCH)
  /globals/:name/... → Global schema, versions, revert, transition
  /:collection       → Collection CRUD (GET, POST, PATCH)
  /:collection/:id   → Single record CRUD (GET, PATCH, DELETE)
  /:collection/:id/... → Versions, revert, restore, transition, audit
  ↓
resolveContext():
  1. Authenticate via Better Auth (session from cookie)
  2. Resolve locale (query param → custom getter → Accept-Language)
  3. Apply adapter extendContext() hook
  4. Apply app contextResolver() (from context.ts)
  ↓
extractAppServices():
  → Flatten all services into AppContext shape
  ↓
Handler execution
  ↓
smartResponse() — JSON or SuperJSON based on Accept header
  ↓
Response
```

### Extensibility

The handler is extensible through the primitives themselves — no framework hooks needed:

| Extension Point      | Mechanism                                                                |
| -------------------- | ------------------------------------------------------------------------ |
| New HTTP endpoints   | `routes/*.ts` files → auto-discovered, mounted at `/routes/*`            |
| New business logic   | `functions/*.ts` files → auto-discovered, mounted at `/rpc/*`            |
| Custom auth          | `getSession` callback on adapter config                                  |
| Custom locale        | `getLocale` callback on adapter config                                   |
| Context enrichment   | `context.ts` single file — adds properties to every request context      |
| New CRUD collections | `collections/*.ts` files → auto-discovered, auto-mounted at `/:slug`     |
| New globals          | `globals/*.ts` files → auto-discovered, auto-mounted at `/globals/:slug` |
| Background work      | `jobs/*.ts` files → dispatched via `queue.jobName.publish()`             |

**Example: Adding webhooks to an existing app:**

```
src/questpie/server/
  routes/
    webhooks/
      stripe.ts       ← POST /routes/webhooks/stripe
      github.ts       ← POST /routes/webhooks/github
  jobs/
    process-payment.ts ← background processing
  services/
    stripe.ts          ← Stripe SDK singleton
```

No framework configuration. No plugin installation. Just create files — codegen discovers them, types them, wires them.

### Adapter Configuration

```ts
import { createFetchHandler } from "questpie";
import { app } from "#questpie";

const handler = createFetchHandler(app, {
	basePath: "/api",
	accessMode: "user",

	// Custom context enrichment (e.g., multi-tenancy)
	extendContext: async ({ request }) => ({
		tenantId: request.headers.get("x-tenant-id"),
	}),

	// Custom session resolution (override Better Auth)
	getSession: async (request, app) => {
		const token = request.headers.get("authorization")?.replace("Bearer ", "");
		return token ? verifyApiKey(token) : null;
	},

	// Custom locale resolution
	getLocale: (request) => request.headers.get("x-locale") ?? undefined,
});
```

---

## §6 Proxy-Based Builder Extensions

### Problem

Admin module adds methods like `.admin()`, `.list()`, `.form()` to `CollectionBuilder`. Previously done via prototype patching — global mutation, fragile.

### Solution: Extension Registry + Proxy Wrapper

**Types** — `declare module "questpie"` augmentation (generated in `factories.ts`):

```ts
declare module "questpie" {
	interface CollectionBuilder<TState> {
		admin(configFn: AdminConfigCallback): CollectionBuilder<TState>;
		list(configFn: ListConfigCallback): CollectionBuilder<TState>;
		form(configFn: FormConfigCallback): CollectionBuilder<TState>;
		preview(config: PreviewConfig): CollectionBuilder<TState>;
		actions(configFn: ActionsCallback): CollectionBuilder<TState>;
	}
}
```

**Runtime** — Proxy intercepts extension calls:

```ts
// Extension registry (generated)
const _collExt = {
	admin: { stateKey: "admin", resolve: (fn) => fn({ c: componentProxy }) },
	list: {
		stateKey: "adminList",
		resolve: (fn) => fn({ v: viewProxy, f: fieldRefProxy }),
	},
	form: {
		stateKey: "adminForm",
		resolve: (fn) => fn({ v: viewProxy, f: fieldRefProxy }),
	},
	preview: { stateKey: "adminPreview", resolve: (v) => v },
	actions: {
		stateKey: "adminActions",
		resolve: (fn) => fn({ a: actionProxy, c: componentProxy }),
	},
};

// Proxy wrapper (generated)
function _wrapColl(builder) {
	return new Proxy(builder, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && prop in _collExt) {
				const ext = _collExt[prop];
				return (configOrFn) =>
					_wrapColl(target.set(ext.stateKey, ext.resolve(configOrFn)));
			}
			const val = Reflect.get(target, prop, receiver);
			if (typeof val === "function") {
				return function (...args) {
					const result = val.apply(target, args);
					return result instanceof CollectionBuilder
						? _wrapColl(result)
						: result;
				};
			}
			return val;
		},
	});
}
```

**Key properties:**

- **Zero prototype mutation** — no global side effects
- **Generic inference preserved** — TypeScript sees augmented interface, Proxy is transparent
- **Plugin-composable** — any plugin can add extensions via `CodegenPlugin.registries`
- **Callback context** — `({ c })`, `({ v, f })`, `({ a, c, f })` proxies created at resolve time

### Adding Custom Extensions

A plugin can add new builder methods:

```ts
// @questpie/webhooks codegen plugin
export const webhooksPlugin: CodegenPlugin = {
	name: "questpie-webhooks",
	registries: {
		collectionExtensions: {
			webhooks: {
				stateKey: "webhooks",
				configType: "WebhookConfig",
				isCallback: false,
			},
		},
	},
};
```

Generated output:

```ts
declare module "questpie" {
	interface CollectionBuilder<TState> {
		webhooks(config: WebhookConfig): CollectionBuilder<TState>;
	}
}
```

User writes:

```ts
export const orders = collection("orders")
  .fields(({ f }) => ({ total: f.number(), status: f.select({ options: [...] }) }))
  .webhooks({ events: ["create", "update"], secret: process.env.WEBHOOK_SECRET });
```

---

## §7 Generated Code — What Codegen Produces

### `.generated/index.ts`

The generated entrypoint:

1. **Imports** everything discovered (collections, globals, jobs, functions, routes, services, auth, singles, blocks)
2. **Emits type interfaces** using `typeof` references (zero inference cost):
   - `AppCollections`, `AppGlobals`, `AppJobs`, `AppFunctions`, `AppRoutes`, `AppServices`, `AppBlocks`
3. **Module type extraction** — inline `_U2I` helper merges module contributions
4. **`declare module "questpie" { interface AppContext { ... } }`** — augments context with typed services
5. **`AppConfig`** — flat type for client APIs (`createClient<AppConfig>()`)
6. **`createApp()` call** — assembles the runtime app instance
7. **`createContext()`** — typed context factory for scripts

```ts
// .generated/index.ts (simplified)
import { createApp, extractAppServices, type AppContext } from "questpie";
import _runtime from "../questpie.config";
import _modules from "../modules";
import { posts as _coll_posts } from "../collections/posts";
import _auth from "../auth";
// ... more imports

// Types
export type AppCollections = _ModuleCollections & { posts: typeof _coll_posts };
export type AppGlobals = _ModuleGlobals & { siteSettings: typeof _glob_siteSettings };
// ...

// AppContext augmentation
declare module "questpie" {
  interface AppContext {
    db: _AppInternal["db"];
    queue: _AppInternal["queue"];
    email: _AppInternal["email"];
    // ... all services typed
    collections: _AppInternal["api"]["collections"];
    globals: _AppInternal["api"]["globals"];
    session: Awaited<ReturnType<_AppInternal["auth"]["api"]["getSession"]>> | null;
    t: (key: AppMessageKeys | (string & {}), params?: Record<string, unknown>) => string;
  }
}

// AppConfig — for client APIs
export type AppConfig = {
  collections: AppCollections;
  globals: AppGlobals;
  auth: typeof _auth;
};

// Runtime
export const app = createApp({ ... }, _runtime) as unknown as AppContext & {
  waitForInit(): Promise<void>;
  destroy(): Promise<void>;
};

// Context factory for scripts
export async function createContext(options?: {
  accessMode?: "system" | "user";
}): Promise<AppContext> { ... }

// Re-export factories
export { collection, global } from "./factories.js";
```

### `.generated/factories.ts`

Generated typed factory functions with plugin extensions:

1. **Core imports** — `CollectionBuilder`, `GlobalBuilder`
2. **Plugin imports** — types from `@questpie/admin` etc.
3. **Type augmentations** — `declare module "questpie"` for extension methods
4. **Extension registries** — `_collExt`, `_globExt` objects
5. **Proxy wrappers** — `_wrapColl()`, `_wrapGlob()` functions
6. **Factory functions** — `collection()`, `global()` that create wrapped builders

### `_AppInternal` — Internal Type Derivation

```ts
// NOT exported — internal only
type _AppInternal = Questpie<
	QuestpieConfig & {
		collections: AppCollections;
		globals: AppGlobals;
		jobs: AppJobs;
		functions: AppFunctions;
		routes: AppRoutes;
		services: AppServices;
		blocks: AppBlocks;
	}
>;
```

This type exists **only** in generated code for deriving typed service accessors (`_AppInternal["db"]`, `_AppInternal["queue"]`, etc.). It is **never exported**, **never visible** to users. User code never references `Questpie<>`.

---

## §8 Client APIs

### `createClient<AppConfig>()`

The typed HTTP client for frontend apps:

```ts
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

const client = createClient<AppConfig>({
	baseURL: "http://localhost:3000",
	basePath: "/api",
});

// Type-safe collections
const { docs, total } = await client.collections.posts.find({
	where: { status: "published" },
	with: { author: true },
	limit: 10,
});

// Type-safe functions
const stats = await client.rpc.getRevenueStats({ period: "month" });

// Type-safe globals
const settings = await client.globals.siteSettings.get();
```

### `createAdminAuthClient<AppConfig>()`

The typed Better Auth client for admin UI:

```ts
import { createAdminAuthClient } from "@questpie/admin/hooks";
import type { AppConfig } from "#questpie";

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL: "http://localhost:3000",
});

// Typed session, sign-in, sign-out
const { data: session } = authClient.useSession();
```

### `QuestpieApp` Constraint

Both client factories use a minimal type constraint:

```ts
// In questpie/client
export interface QuestpieApp {
	collections: Record<string, AnyCollectionOrBuilder>;
	globals?: Record<string, any>;
	auth?: any;
}

export function createClient<T extends QuestpieApp>(
	config: ClientConfig,
): QuestpieClient<T>;
```

`AppConfig` satisfies `QuestpieApp` because it has `collections`, `globals`, and `auth` — all flat, no nesting.

---

## §9 Module System

### Module Definition

Modules are static data objects. They contribute collections, globals, fields, views, jobs, functions, routes, services, sidebar, dashboard — anything.

```ts
// modules.ts
import { starter } from "questpie";
import { admin, audit } from "@questpie/admin";

export default [starter(), admin(), audit()];
```

Each module returns a `ModuleDefinition`:

```ts
interface ModuleDefinition {
	name: string;
	collections?: Record<string, AnyCollectionOrBuilder>;
	globals?: Record<string, AnyGlobal>;
	jobs?: Record<string, JobDefinition>;
	functions?: FunctionsTree;
	routes?: Record<string, RouteDefinition>;
	services?: Record<string, ServiceDefinition>;
	fields?: Record<string, FieldDefinition>; // ← field types
	listViews?: Record<string, ViewDefinition>; // ← view types
	editViews?: Record<string, ViewDefinition>; // ← view types
	components?: Record<string, ComponentDefinition>; // ← component types
	sidebar?: SidebarContribution[];
	dashboard?: DashboardContribution[];
	messages?: Record<string, Record<string, string>>;
	hooks?: GlobalHooks;
	defaultAccess?: AccessConfig;
	auth?: AuthConfig;
}
```

### Module Merge Order

Modules are merged depth-first, left-to-right. User entities always win:

```
starter()  →  admin()  →  audit()  →  user collections/globals/jobs/...
   ↓            ↓            ↓            ↓
  base      overrides     overrides    final override
```

For array-type contributions (sidebar, dashboard), values are concatenated — all modules contribute.

---

## §10 Runtime App Object

The `app` returned by `createApp()` is a simple extensible object:

```ts
// What `app` looks like at runtime:
{
  db,                    // Drizzle client
  queue,                 // QueueClient with typed jobs
  email,                 // MailerService
  storage,               // Flydrive StorageManager
  kv,                    // KVService
  logger,                // LoggerService
  search,                // SearchService
  realtime,              // RealtimeService
  api: {
    collections: { ... },  // CRUD APIs per collection
    globals: { ... },      // CRUD APIs per global
  },
  auth,                  // Better Auth instance
  functions,             // Functions tree
  config,                // Resolved configuration
  t,                     // i18n translator function
  waitForInit(),         // Wait for async initialization
  destroy(),             // Cleanup resources
}
```

No class. No `Questpie<>`. Just a flat object. Internally, `createApp()` still uses the `Questpie` class — but the returned type is cast to `AppContext & lifecycle`. Users never see the class.

---

## §11 File Convention Summary

```
src/questpie/server/
  questpie.config.ts          # runtimeConfig() — db, storage, email, queue, kv
  modules.ts                  # [starter(), admin(), audit()]
  auth.ts                     # Better Auth configuration
  locale.ts                   # Default locale, locale detection
  context.ts                  # Custom context resolver (multi-tenancy, etc.)

  collections/                # One file per collection
    posts.ts                  # export const posts = collection("posts").fields(...)
    categories.ts

  globals/                    # One file per global
    site-settings.ts          # export const siteSettings = global("siteSettings").fields(...)

  functions/                  # Nested → nested RPC namespace
    get-stats.ts              # → /rpc/getStats
    admin/
      get-users.ts            # → /rpc/admin/getUsers

  routes/                     # Raw HTTP handlers
    health.ts                 # GET /routes/health
    webhooks/
      stripe.ts               # POST /routes/webhooks/stripe

  jobs/                       # Background jobs
    send-notification.ts
    process-payment.ts

  services/                   # Singleton/request-scoped services
    stripe.ts
    analytics.ts

  messages/                   # i18n messages
    en.ts
    sk.ts

  blocks/                     # Rich-text blocks (admin plugin)
    hero.ts
    cta.ts

  sidebar.ts                  # Sidebar configuration
  dashboard.ts                # Dashboard configuration
  branding.ts                 # Admin branding
  admin-locale.ts             # Admin UI locale

  .generated/                 # Auto-generated (gitignored)
    index.ts                  # App entrypoint + types
    factories.ts              # collection(), global() with extensions
```

---

## §12 Verification Checklist

After implementation, verify:

1. **Zero `any` in context interfaces** — `HookContext`, `AccessContext`, `FunctionHandlerArgs`, `JobHandlerArgs`, `RouteHandlerArgs`, `BlockPrefetchContext` have no `any` typed properties
2. **Zero `Questpie<>` in user code** — no generated file exports `Questpie<>`, no user imports it
3. **Zero prototype patches** — generated `factories.ts` uses Proxy, no `.prototype` access
4. **AppContext augmented** — generated `index.ts` contains `declare module "questpie" { interface AppContext { ... } }`
5. **All tests pass** — unit tests, type tests
6. **TypeScript clean** — `tsc --noEmit` on core, admin, and all examples
7. **Fields from modules** — `builtinFields` is not a type-level fallback

---

## §13 Glossary

| Term               | Definition                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| **AppContext**     | Empty interface in core, augmented by generated code. Every handler extends it.                |
| **AppConfig**      | Flat type (`{ collections, globals, auth }`) for client APIs. Exported from generated code.    |
| **Function**       | Type-safe RPC — validated input, auto-serialized output. `POST /rpc/{name}`.                   |
| **Route**          | Raw HTTP handler — any method, full `Request`/`Response` control. Mounted at `/routes/{path}`. |
| **Job**            | Background task — queued, retried, schedulable. Dispatched via `queue.jobName.publish()`.      |
| **Service**        | Singleton or request-scoped dependency. Flat on AppContext.                                    |
| **Module**         | Static data object contributing collections, fields, views, etc. Merged by `createApp()`.      |
| **CodegenPlugin**  | Extension point for codegen — discovers files, registers builder extensions.                   |
| **Extension**      | Builder method added via `declare module` (types) + Proxy (runtime).                           |
| **`_AppInternal`** | Internal `Questpie<>` type in generated code. Never exported. Used only for type derivation.   |
