---
name: questpie-core-rules
description:
  QUESTPIE access control hooks validation lifecycle beforeValidate beforeChange afterChange beforeDelete afterDelete access rules field-level row-level secure-by-default Zod schema refinements collection global
  - questpie-core
---

# QUESTPIE Rules, Access Control, Hooks, Validation

This skill builds on questpie-core. It covers collection/global access control, lifecycle hooks, and validation, the three rule layers that govern data flow.

## Contents

- [Access Control](#access-control), defaults, collection/global access, row-level, context, system mode
- [Hooks](#hooks), lifecycle order, defining hooks, hook context, context-first pattern
- [Validation](#validation), field constraints, input modifier, custom validation via hooks
- [Common Mistakes](#common-mistakes)
- [Access Control for Preview Sessions](#access-control-for-preview-sessions)

## Access Control

Access rules are defined per-collection via `.access()`. Each operation accepts a static `boolean` or a function receiving `AppContext` that returns `boolean` or a where clause (row-level filtering).

### Default Behavior

When no `.access()` is defined, all operations default to `({ session }) => !!session`, **authenticated users only**. You must explicitly set `read: true` for public collections.

Every operation resolves through the same chain, with no hidden framework grants above your config:

1. Collection/global `.access()` rule for that operation
2. App-level `defaultAccess` (`appConfig({ access })` in `config/app.ts`)
3. Framework fallback: require session

A deny-all `defaultAccess` (`{ read: false, create: false, update: false, delete: false }`) closes the entire REST surface, including upload-row listing and schema/meta introspection, until collections opt in.

### Collection Access

```ts
// collections/posts.ts
import { collection } from "#questpie/factories";

export default collection("posts")
	.fields(({ f }) => ({
		title: f.text().label("Title").required(),
		content: f.richText().label("Content"),
		author: f.relation("user"),
	}))
	.access({
		read: true, // Public read
		create: ({ session }) => !!session, // Authenticated
		update: ({ session }) => session?.user?.role === "admin", // Admin only
		delete: ({ session }) => session?.user?.role === "admin",
	});
```

### Operations

| Operation    | When checked                                             |
| ------------ | -------------------------------------------------------- |
| `read`       | Listing and fetching records                             |
| `create`     | Creating new records                                     |
| `update`     | Updating existing records                                |
| `delete`     | Deleting records                                         |
| `transition` | Workflow stage transitions (falls back to `update`)      |
| `serve`      | Upload file bytes by key (`GET /:collection/files/:key`) |
| `introspect` | Schema/meta routes (`GET /:collection/{schema,meta}`)    |

`serve` and `introspect` resolve through their own rule (not `read`): `serve` falls back to explicit collection `read` then `defaultAccess.serve`; `introspect` is visible iff at least one CRUD operation is allowed for the current user. `f.upload()` fields populate through the PARENT row's read decision, so a publicly readable gallery shows its assets (with `url`) even when the assets collection itself is unlistable.

### Global Access

Globals support `read` and `update` only (singletons have no create/delete):

```ts
// globals/site-settings.ts
import { global } from "#questpie/factories";

export default global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text().label("Site Name").required(),
		logo: f.upload().label("Logo"),
	}))
	.access({
		read: true,
		update: ({ session }) => session?.user?.role === "admin",
	});
```

### Row-Level Access (AccessWhere)

Return a where clause object instead of a boolean to restrict operations to matching rows:

```ts
.access({
  read: true,
  update: ({ session }) => {
    if (!session) return false;
    // Only allow updating own records
    return { author: session.user.id };
  },
})
```

### Access Function Context

Access functions receive `AppContext` with these properties:

| Property      | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `session`     | Current auth session (null if unauthed)                             |
| `db`          | Database instance                                                   |
| `collections` | Typed collection API                                                |
| `request`     | Current HTTP `Request` (headers, URL)                               |
| `data`        | The existing row, typed, non-optional in `update`/`delete` rules    |
| `input`       | Typed insert shape in `create` rules; typed patch in `update` rules |
| _extensions_  | Keys returned by `appConfig({ context })`, flat (see below)         |

`data`/`input` are typed **per operation** by the builder, no casts, no annotations inside the defining collection. For shared rule helpers and every other "I need type X" case, see `references/type-inference.md`.

### Derived Request Context in Rules

`appConfig({ context })` runs once per HTTP request; its result arrives **flat** on every access rule ctx (collections, globals, routes, field access, transitions), typed by inference:

```ts
// config/app.ts
export default appConfig({
	context: async ({ request }) => ({
		workspaceId: request.headers.get("x-workspace") || null,
	}),
});

// collections/projects.ts, destructure flat, narrow before use
.access({
	read: ({ workspaceId }) =>
		workspaceId ? { workspace: workspaceId } : false,
})
```

Extensions are typed `Partial<…>`, absent for non-HTTP contexts (jobs, seeds, system scripts), so rules must handle `undefined`. See `references/multi-tenancy.md` for the full pattern (membership validation, closure memoization, scope UI).

Access functions may be async. Use `request` for request-scoped checks such as headers, tenant scope, CAPTCHA tokens, or signed public form tokens:

```ts
import type { AccessContext } from "questpie";
import { ApiError } from "questpie/errors";
import { isAdminRequest } from "@questpie/admin/shared";

// AccessContext is the sanctioned shared-helper param, never hand-roll a
// structural ctx type (see references/type-inference.md)
async function canCreatePublicSubmission({ request, session }: AccessContext) {
	if (session?.user) return true;
	if (request && isAdminRequest(request)) {
		throw ApiError.unauthorized();
	}

	const token = request?.headers.get("x-captcha-token");
	const valid = token ? await verifyCaptchaToken(token) : false;
	if (valid) return true;

	throw ApiError.forbidden({
		operation: "create",
		resource: "public_submissions",
		reason: "CAPTCHA verification failed",
	});
}

export default collection("public_submissions")
	.fields(({ f }) => ({
		message: f.textarea().required(),
	}))
	.access({
		read: false,
		create: canCreatePublicSubmission,
	});
```

For public anti-abuse checks, bypass already authenticated users before requiring a CAPTCHA token. Admin-origin requests should not be asked for CAPTCHA either, but remember that `isAdminRequest()` is a caller-intent signal, not authentication; if an admin-origin request reaches this rule without a session, fail it as unauthorized instead of accepting it.

Prefer throwing `ApiError.*` from access rules when callers need a specific structured error response. Returning `false` is fine for generic denial, but it produces the default forbidden message.

### System Access Mode

Server-side code can bypass all access checks:

```ts
const ctx = await app.createContext({ accessMode: "system" });
const allPosts = await app.collections.posts.find({}, ctx);
```

HTTP requests always use session-based access. System mode is for background jobs, seeds, and internal server logic only.

## Hooks

Hooks run logic at specific points in the collection lifecycle. They receive the full typed `AppContext` through context injection.

### Lifecycle Order

For create/update:

```text
API Request
  |
beforeValidate   -- Modify/validate data before schema validation
  |
Schema Validation -- Zod validation from field definitions
  |
beforeChange     -- Transform data before database write
  |
Database Write   -- Insert or update
  |
afterChange      -- Side effects after successful write
```

For delete:

```text
beforeDelete --> Database Delete --> afterDelete
```

### Defining Hooks

```ts
// collections/appointments.ts
import { collection } from "#questpie/factories";

export default collection("appointments")
	.fields(({ f }) => ({
		customer: f.relation("user"),
		barber: f.relation("barbers"),
		service: f.relation("services"),
		scheduledAt: f.datetime().required(),
		status: f.select([
			{ value: "pending", label: "Pending" },
			{ value: "confirmed", label: "Confirmed" },
			{ value: "cancelled", label: "Cancelled" },
		]),
		slug: f.text().required().inputOptional(),
		name: f.text().required(),
	}))
	.hooks({
		beforeValidate: async (ctx) => {
			if (ctx.data.name && !ctx.data.slug) {
				ctx.data.slug = slugify(ctx.data.name);
			}
		},

		beforeChange: async ({ data, operation }) => {
			if (operation === "create") {
				// Set defaults on create
			}
			if (operation === "update") {
				// Derive fields from the incoming patch (`original` is NOT
				// available here, use afterChange to compare against it)
			}
		},

		afterChange: async ({ data, operation, original, queue }) => {
			// Queue publish joins the hook transaction. Direct email/HTTP calls
			// still belong in onAfterCommit.
			if (operation === "create") {
				await queue.sendAppointmentConfirmation.publish(
					{
						appointmentId: data.id,
						customerId: data.customer,
					},
					{ idempotencyKey: `appointment-confirmed:${data.id}` },
				);
			}
			if (operation === "update" && data.status === "cancelled") {
				await queue.sendAppointmentCancellation.publish(
					{
						appointmentId: data.id,
						customerId: data.customer,
					},
					{ idempotencyKey: `appointment-cancelled:${data.id}` },
				);
			}
		},

		beforeDelete: async ({ data }) => {
			// `data` is the record being deleted, use data.id to clean up
		},

		afterDelete: async ({ data }) => {
			// Clean up related data keyed by data.id
		},
	});
```

Each hook accepts a single function **or an array of functions** (executed in order):

```ts
.hooks({
	beforeChange: [normalizeSlug, stampAuthor],
})
```

### Transaction-bound Hooks

`afterChange`, `afterDelete`, and `afterPurge` run inside the owning mutation
transaction. Their `db` and injected services share that scope. A thrown error
propagates and rolls back the mutation plus transaction-joined work:

```ts
.hooks({
	afterChange: async ({ data, channels }) => {
		await channels.publish("postActivity", {
			params: { postId: data.id },
			event: "changed",
			data: { id: data.id },
		});
	},
})
```

`afterChange` covers create/update, including restore and version revert;
`afterDelete` covers soft and hard delete; `afterPurge` runs after physical
removal and before commit. `updateMany` and `deleteMany` run once per winning
row, sequentially in deterministic order, with bulk metadata. `updateBatch`
runs once per successful item. An already-active no-op restore runs nothing.

Use these hooks for transaction-aware database, Queue/outbox, or typed-channel
work. Direct email/HTTP work cannot join the transaction and belongs in a
durable job or `onAfterCommit`.

### Hook Context Properties

| Property        | Available in                                                         | Description                                                                  |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `data`          | beforeValidate, beforeChange, afterChange, beforeDelete, afterDelete | Record being written (delete hooks: the record being deleted, use `data.id`) |
| `operation`     | beforeChange, afterChange                                            | `"create"` or `"update"`                                                     |
| `original`      | afterChange (update only)                                            | Previous record state                                                        |
| `onAfterCommit` | All hooks                                                            | Queue a side effect (`(cb) => void`) to run after the tx commits             |
| `collections`   | All hooks                                                            | Typed collection API                                                         |
| `globals`       | All hooks                                                            | Typed globals API                                                            |
| `queue`         | All hooks                                                            | Queue client for publishing jobs                                             |
| `email`         | All hooks                                                            | Email service                                                                |
| `db`            | All hooks                                                            | Database instance                                                            |
| `session`       | All hooks                                                            | Current auth session                                                         |
| `services`      | All hooks                                                            | Custom services from `services/`                                             |
| _extensions_    | All hooks                                                            | `appConfig({ context })` result, flat (HTTP requests only)                   |

Derived request context also reaches hooks and any nested code via `getContext<App>()`, including CRUD calls a hook triggers (AsyncLocalStorage carries it):

```ts
.hooks({
  beforeChange: async ({ data, operation, workspaceId }) => {
    if (operation === "create" && workspaceId) data.workspace = workspaceId;
  },
})
```

### Context-First Pattern

All dependencies come through destructuring. No need to import the app instance:

```ts
.hooks({
  beforeChange: async ({ data, services }) => {
    const { blog } = services;
    data.slug = blog.generateSlug(data.title);
    data.readingTime = blog.computeReadingTime(data.content);
  },

  afterChange: async ({ data, operation, original, queue }) => {
    if (
      operation === "update" &&
      original?.status !== "published" &&
      data.status === "published"
    ) {
      await queue.notifyBlogSubscribers.publish(
        {
          postId: data.id,
          title: data.title,
        },
        { idempotencyKey: `blog-published:${data.id}` },
      );
    }
  },
})
```

## Validation

QUESTPIE validates at three levels: field constraints, auto-generated Zod schemas, and custom hooks.

### Field-Level Constraints

Built-in constraints on field definitions generate Zod schemas automatically:

```ts
.fields(({ f }) => ({
  name: f.text(255).required(),
  email: f.email().required(),
  website: f.url(),
  rating: f.number().min(1).max(5),
  tags: f.text().array().maxItems(10),
}))
```

| Constraint  | Fields             | Description             |
| ----------- | ------------------ | ----------------------- |
| `required`  | All                | Field must have a value |
| `maxLength` | `text`, `textarea` | Maximum string length   |
| `min`/`max` | `number`           | Numeric range           |
| `maxItems`  | `array`            | Maximum array length    |
| `mimeTypes` | `upload`           | Allowed file types      |
| `maxSize`   | `upload`           | Max file size in bytes  |

### Input Modifier

The `input` option controls API input behavior for fields computed by hooks:

```ts
slug: f.text().required().inputOptional(),
```

### Custom Validation via Hooks

Use `beforeValidate` to transform data or reject operations:

```ts
.hooks({
  beforeValidate: async ({ data, operation }) => {
    // Transform data before validation
    if (operation === "create" && !data.slug) {
      data.slug = slugify(data.name);
    }
  },
})
```

To reject an operation, throw an error:

```ts
.hooks({
  beforeValidate: async ({ data }) => {
    if (data.scheduledAt && new Date(data.scheduledAt) < new Date()) {
      throw new Error("Cannot schedule appointments in the past");
    }
  },
})
```

## Common Mistakes

1. **HIGH: Forgetting default access is `!!session`.**
   Collections without `.access()` require authentication for all operations. For public read access, explicitly set `read: true`.

2. **HIGH: Using `accessMode: "system"` in HTTP handlers.**
   System mode bypasses all access checks. Only use it for background jobs, seeds, and internal server scripts, never in request handlers.

3. **MEDIUM: Mutating `data` in `afterChange` hooks.**
   Changes to `data` in `afterChange` are NOT persisted to the database. Only mutations in `beforeValidate` and `beforeChange` are saved.

4. **MEDIUM: Not awaiting async access control functions.**
   Access functions can be async and must return `boolean` or a where clause object (`AccessWhere`).

5. **HIGH: Wrong context usage in access rules.**
   Use the destructured `session` parameter from `AppContext`, not a standalone import. Access functions receive `({ session, db, collections })`.

## Access Control for Preview Sessions

Live preview sessions use token-based authentication. When a preview iframe loads, it receives a short-lived preview token that authorizes read access to the collection being previewed.

### Key Points

- Preview tokens are scoped to a specific collection and record, they do not grant broad access.
- Preview does **not** bypass access rules. The token resolves to a session with the same permissions as the user who initiated the preview.
- Access rules (`.access()`) still apply to all data fetched during preview, including prefetched relations and block data.
- Row-level access (AccessWhere) filters are enforced even in preview context, a user cannot preview records they cannot read.

### Workflow Published Reads

For publishable collections that use workflow stages, do not use `read: true` when public client or HTTP access is available. Gate anonymous reads to the published stage:

```ts
.access({
	read: ({ session, input }) => {
		if (session?.user) return true;
		return input?.stage === "published";
	},
	create: ({ session }) => !!session?.user,
	update: ({ session }) => !!session?.user,
	delete: ({ session }) => !!session?.user,
	transition: ({ session }) => !!session?.user,
})
```

Public frontend code must pass `stage: "published"`. Preview/draft-mode reads may omit `stage` only when the request has an authorized editor session.

### System Access and Preview

Do not use `accessMode: "system"` to serve preview data. Preview requests should go through normal session-based access, with the preview token resolving to the editor's session. This ensures previewed content respects the same visibility rules as the final published page.
