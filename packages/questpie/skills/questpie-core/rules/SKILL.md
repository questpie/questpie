---
name: questpie-core-rules
description: QUESTPIE access control hooks validation lifecycle beforeValidate beforeChange afterChange beforeDelete afterDelete access rules field-level row-level secure-by-default Zod schema refinements collection global
type: sub-skill
requires:
  - questpie-core
---

# QUESTPIE Rules — Access Control, Hooks, Validation

This skill builds on questpie-core. It covers collection/global access control, lifecycle hooks, and validation — the three rule layers that govern data flow.

## Access Control

Access rules are defined per-collection via `.access()`. Each operation accepts a static `boolean` or a function receiving `AppContext` that returns `boolean` or a where clause (row-level filtering).

### Default Behavior

When no `.access()` is defined, all operations default to `({ session }) => !!session` — **authenticated users only**. You must explicitly set `read: true` for public collections.

### Collection Access

```ts
// collections/posts.collection.ts
import { collection } from "questpie";

export default collection("posts")
	.fields(({ f }) => ({
		title: f.text({ label: "Title", required: true }),
		content: f.richText({ label: "Content" }),
		author: f.relation({ to: "users" }),
	}))
	.access({
		read: true, // Public read
		create: ({ session }) => !!session, // Authenticated
		update: ({ session }) => session?.user?.role === "admin", // Admin only
		delete: ({ session }) => session?.user?.role === "admin",
	});
```

### Operations

| Operation | When checked                 |
| --------- | ---------------------------- |
| `read`    | Listing and fetching records |
| `create`  | Creating new records         |
| `update`  | Updating existing records    |
| `delete`  | Deleting records             |

### Global Access

Globals support `read` and `update` only (singletons have no create/delete):

```ts
// globals/site-settings.global.ts
import { global } from "questpie";

export default global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text({ label: "Site Name", required: true }),
		logo: f.upload({ label: "Logo" }),
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

| Property      | Description                             |
| ------------- | --------------------------------------- |
| `session`     | Current auth session (null if unauthed) |
| `db`          | Database instance                       |
| `collections` | Typed collection API                    |

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
// collections/appointments.collection.ts
import { collection } from "questpie";

export default collection("appointments")
	.fields(({ f }) => ({
		customer: f.relation({ to: "users" }),
		barber: f.relation({ to: "barbers" }),
		service: f.relation({ to: "services" }),
		scheduledAt: f.dateTime({ required: true }),
		status: f.select({ options: ["pending", "confirmed", "cancelled"] }),
		slug: f.text({ required: true, input: "optional" }),
		name: f.text({ required: true }),
	}))
	.hooks({
		beforeValidate: async (ctx) => {
			if (ctx.data.name && !ctx.data.slug) {
				ctx.data.slug = slugify(ctx.data.name);
			}
		},

		beforeChange: async ({ data, operation, original }) => {
			if (operation === "create") {
				// Set defaults on create
			}
			if (operation === "update" && original) {
				// Compare with original data
			}
		},

		afterChange: async ({ data, operation, original, queue }) => {
			if (operation === "create") {
				await queue.sendAppointmentConfirmation.publish({
					appointmentId: data.id,
					customerId: data.customer,
				});
			}
			if (operation === "update" && data.status === "cancelled") {
				await queue.sendAppointmentCancellation.publish({
					appointmentId: data.id,
					customerId: data.customer,
				});
			}
		},

		beforeDelete: async ({ id }) => {
			// Prevent deletion or clean up
		},

		afterDelete: async ({ id }) => {
			// Clean up related data
		},
	});
```

### Hook Context Properties

| Property      | Available in                              | Description                      |
| ------------- | ----------------------------------------- | -------------------------------- |
| `data`        | beforeValidate, beforeChange, afterChange | The record data being written    |
| `operation`   | beforeChange, afterChange                 | `"create"` or `"update"`         |
| `original`    | beforeChange, afterChange (update)        | Previous record state            |
| `id`          | beforeDelete, afterDelete                 | ID of record being deleted       |
| `collections` | All hooks                                 | Typed collection API             |
| `globals`     | All hooks                                 | Typed globals API                |
| `queue`       | All hooks                                 | Queue client for publishing jobs |
| `email`       | All hooks                                 | Email service                    |
| `db`          | All hooks                                 | Database instance                |
| `session`     | All hooks                                 | Current auth session             |
| `services`    | All hooks                                 | Custom services from `services/` |

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
      await queue.notifyBlogSubscribers.publish({
        postId: data.id,
        title: data.title,
      });
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
  name: f.text({ required: true, maxLength: 255 }),
  email: f.email({ required: true }),
  website: f.url(),
  rating: f.number({ min: 1, max: 5 }),
  tags: f.array({ of: f.text(), maxItems: 10 }),
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
slug: f.text({
  required: true,      // Required in DB
  input: "optional",   // Optional in API input (auto-generated by hook)
}),
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
   System mode bypasses all access checks. Only use it for background jobs, seeds, and internal server scripts — never in request handlers.

3. **MEDIUM: Mutating `data` in `afterChange` hooks.**
   Changes to `data` in `afterChange` are NOT persisted to the database. Only mutations in `beforeValidate` and `beforeChange` are saved.

4. **MEDIUM: Not awaiting async access control functions.**
   Access functions can be async and must return `boolean` or a where clause object (`AccessWhere`).

5. **HIGH: Wrong context usage in access rules.**
   Use the destructured `session` parameter from `AppContext`, not a standalone import. Access functions receive `({ session, db, collections })`.

## Access Control for Preview Sessions

Live preview sessions use token-based authentication. When a preview iframe loads, it receives a short-lived preview token that authorizes read access to the collection being previewed.

### Key Points

- Preview tokens are scoped to a specific collection and record — they do not grant broad access.
- Preview does **not** bypass access rules. The token resolves to a session with the same permissions as the user who initiated the preview.
- Access rules (`.access()`) still apply to all data fetched during preview, including prefetched relations and block data.
- Row-level access (AccessWhere) filters are enforced even in preview context — a user cannot preview records they cannot read.

### System Access and Preview

Do not use `accessMode: "system"` to serve preview data. Preview requests should go through normal session-based access, with the preview token resolving to the editor's session. This ensures previewed content respects the same visibility rules as the final published page.
