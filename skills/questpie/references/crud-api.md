---
name: questpie-core/crud-api
description: QUESTPIE CRUD API find findOne create updateById updateMany updateBatch deleteById deleteMany restoreById count atomic conditional update claim optimistic locking query operators where filter sort orderBy pagination limit offset with select relations depth context accessMode collections globals client server typesafe
  - questpie-core
---

This skill builds on questpie-core.

## Two API Surfaces

QUESTPIE exposes CRUD operations in two ways depending on where you call them:

### 1. Handler Context (routes, hooks, jobs)

Inside any handler, `collections` and `globals` are injected via context. The current request context (session, locale, access mode) is implicit:

```ts
// routes/get-published.ts
import { route } from "questpie/services";
export default route()
	.get()
	.handler(async ({ collections }) => {
		const result = await collections.posts.find({
			where: { status: "published" },
			limit: 10,
			orderBy: { createdAt: "desc" },
		});
		return result.docs;
	});
```

### 2. App Instance (scripts, seeds, external)

Outside handlers, use `app.collections.*` and pass an explicit context as the second argument:

```ts
import { app } from "#questpie";

const ctx = await app.createContext({ accessMode: "system", locale: "en" });

const result = await app.collections.posts.find(
	{ where: { status: "published" }, limit: 10 },
	ctx,
);
```

## Collection Operations

One vocabulary on both surfaces (server CRUD and client SDK):

| Concept | Method | Returns |
| --- | --- | --- |
| list (paginated) | `find(options)` | `{ docs: T[], totalDocs: number }` |
| single by query | `findOne(options)` | `T \| null` |
| count | `count(options)` | `number` |
| create | `create(data)` | `T` |
| update by id | `updateById({ id, data })` | `T` (throws notFound) |
| bulk update by where | `updateMany({ where, data })` | `T[]` (winners) |
| per-record batch | `updateBatch({ updates })` | `T[]` |
| delete by id | `deleteById({ id })` | `{ success }` (throws notFound) |
| bulk delete by where | `deleteMany({ where })` | `{ success, count }` |
| restore by id | `restoreById({ id })` | `T` (softDelete only) |

Deprecated aliases (removed in v4): server `update`/`delete` = bulk (`updateMany`/`deleteMany`); client `update`/`delete`/`restore` = by-id (`updateById`/`deleteById`/`restoreById`). Avoid them — the same names mean different things on each surface. Accessing a method that does not exist on server CRUD throws a `TypeError` listing valid methods (it does NOT return `undefined`).

### `find(options)`

List documents with filtering, sorting, and pagination.

```ts
const result = await collections.posts.find({
	where: { status: "published", price: { gte: 1000 } },
	orderBy: { createdAt: "desc" },
	limit: 20,
	offset: 0,
	with: { author: true, category: true },
	select: { title: true, status: true, createdAt: true },
});
// result: { docs: T[], totalDocs: number }
```

**Return type:** `{ docs: T[], totalDocs: number }`

### `findOne(options)`

Fetch a single document. Returns `null` if not found.

```ts
const post = await collections.posts.findOne({
	where: { slug: "hello-world" },
	with: { author: true },
});
// post: T | null
```

### `create(data)`

Create a new document. Pass field values as a flat object.

```ts
const post = await collections.posts.create({
	title: "Hello World",
	body: "Content here",
	status: "draft",
	author: "user-id-123",
});
// post: T (created record with id)
```

### `updateById(options)`

Update a single document by id. Returns the updated record; throws `notFound` if the record does not exist (or vanished concurrently).

```ts
const updated = await collections.posts.updateById({
	id: "abc-123",
	data: { status: "published" },
});
// updated: T (updated record)
```

### `updateMany(options)`

Bulk update all documents matching `where`. Returns an **array** of the updated records — never a single object.

```ts
const updated = await collections.posts.updateMany({
	where: { status: "draft" },
	data: { status: "archived" },
});
// updated: T[] — exactly the rows that were written
```

`updateMany` is claim-checked: inside the write transaction the matched rows are locked and `where` is re-evaluated, so rows changed by a concurrent writer are skipped instead of silently overwritten. The returned array reports exactly the winners.

#### Atomic conditional updates (claims, optimistic locking)

Use a conditional `where` + the array length as the win/lose signal:

```ts
// Claim: of two parallel claims, EXACTLY ONE wins
const claimed = await collections.event_members.updateMany(
	{
		where: { id: memberId, user: { isNull: true } },
		data: { user: newUserId },
	},
	{ accessMode: "system" },
);
if (claimed.length === 0) {
	// Lost the race (or row vanished) — handle explicitly
}

// Optimistic concurrency: write only if the revision is unchanged
const bumped = await collections.documents.updateMany(
	{ where: { id, revision: doc.revision }, data: { body, revision: doc.revision + 1 } },
	ctx,
);
if (bumped.length === 0) throw new Error("Conflict — reload and retry");
```

Hook timing: `beforeValidate`/`beforeChange` run before the transaction on candidates (intent — may fire for losers); `afterChange`, versioning, and the return value are winners-only (fact).

### `updateBatch(options)`

Distinct data per record, one transaction.

```ts
const updated = await collections.posts.updateBatch({
	updates: [
		{ id: "a", data: { order: 1 } },
		{ id: "b", data: { order: 2 } },
	],
});
// updated: T[]
```

### `deleteById(options)`

Delete a single document by id (soft delete when enabled). Throws `notFound` if missing.

```ts
await collections.posts.deleteById({ id: "abc-123" });
// { success: true }
```

### `deleteMany(options)`

Bulk delete all documents matching `where`. Claim-checked like `updateMany` — `count` is the number of rows that still matched at delete time.

```ts
const result = await collections.posts.deleteMany({
	where: { status: "archived" },
});
// result: { success: true, count: number }
```

### `restoreById(options)`

Restore a soft-deleted document (collections with `softDelete: true`).

```ts
const restored = await collections.posts.restoreById({ id: "abc-123" });
// restored: T
```

### `count(options)`

Count documents matching a filter.

```ts
const total = await collections.posts.count({
	where: { status: "published" },
});
// total: number
```

## Global Operations

Globals have only two operations:

```ts
// Read global
const settings = await globals.siteSettings.get({});

// Update global
const updated = await globals.siteSettings.update({
	siteName: "New Name",
});
```

Via app instance:

```ts
const settings = await app.globals.siteSettings.get({}, ctx);
await app.globals.siteSettings.update(
	{ siteName: "New Name" },
	ctx,
);
```

## Query Operators

Operators are always nested inside field objects in `where`. See `references/query-operators.md` for the full reference.

```ts
// Multiple fields = AND
where: {
  status: "published",           // equality shorthand
  price: { gte: 1000, lt: 5000 }, // range (AND within same field)
  title: { contains: "guide" },  // substring
  category: { in: ["news", "blog"] }, // one-of
}
```

### Equality Shorthand

All field types support direct equality:

```ts
where: {
	status: "published";
}
// equivalent to: where: { status: { eq: "published" } }
```

## Sorting

Use `orderBy` with `"asc"` or `"desc"`:

```ts
const result = await collections.posts.find({
	orderBy: { createdAt: "desc" },
});
```

Multi-field sorting: order determines priority (first = primary sort). All
three syntaxes work, including inside relation `with` options:

```ts
// Array syntax (preferred for explicit priority)
orderBy: [{ status: "desc" }, { createdAt: "desc" }]

// Object syntax (key order = priority)
orderBy: { status: "desc", createdAt: "desc" }

// Function syntax
orderBy: (table, { asc, desc }) => [desc(table.status), asc(table.title)]
```

## Pagination

Use `limit` and `offset`:

```ts
const page2 = await collections.posts.find({
	limit: 20,
	offset: 20,
});
// page2.totalDocs = total count across all pages
```

### Keyset (cursor) pagination

For stable pagination over changing data, use a tuple cursor of
`(createdAt, id)` with a matching multi-field `orderBy`. System timestamps
are stored with millisecond precision (`timestamp(3)`), so a `Date` you read
back equals the stored value exactly — cursor comparisons are exact:

```ts
const page = await collections.posts.find({
	where: cursor
		? {
				OR: [
					{ createdAt: { lt: cursor.createdAt } },
					{
						AND: [
							{ createdAt: { eq: cursor.createdAt } },
							{ id: { lt: cursor.id } },
						],
					},
				],
			}
		: undefined,
	orderBy: [{ createdAt: "desc" }, { id: "desc" }],
	limit: 20,
});
const last = page.docs.at(-1);
const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
```

Always use the explicit `{ eq: ... }` operator for `Date` cursor values —
do not pass a bare `Date` as an equality shorthand.

## Relations

Relations are NOT populated by default. Use `with` to eager-load:

```ts
const post = await collections.posts.findOne({
	where: { id: "abc" },
	with: { author: true, category: true },
});
// post.author is now the full author object, not just an ID
```

Use `select` to pick specific fields:

```ts
const posts = await collections.posts.find({
	select: { title: true, status: true },
});
```

## Context and Access Modes

### In Handlers

Context is automatic. The current user's session determines access:

```ts
export default route()
	.get()
	.handler(async ({ collections, session }) => {
		// Access control is enforced based on session
		const posts = await collections.posts.find({});
		return posts;
	});
```

### In Scripts / Seeds

Create an explicit context with `app.createContext()`:

```ts
// System mode -- bypasses all access control
const ctx = await app.createContext({ accessMode: "system", locale: "en" });

// User mode -- enforces access control (requires session)
const ctx = await app.createContext({ accessMode: "user" });
```

## Client API

The client SDK uses the same vocabulary:

```ts
const posts = await client.collections.posts.find({ limit: 10 });
const post = await client.collections.posts.findOne({ where: { id: "abc" } });
const created = await client.collections.posts.create({ title: "New" });
const updated = await client.collections.posts.updateById({
	id: "abc",
	data: { title: "Updated" },
});
await client.collections.posts.deleteById({ id: "abc" });
const many = await client.collections.posts.updateMany({
	where: { status: "draft" },
	data: { status: "review" },
});
await client.collections.posts.deleteMany({ where: { status: "archived" } });
const count = await client.collections.posts.count({
	where: { status: "draft" },
});
```

### Upload (Client Only)

For upload collections:

```ts
const asset = await client.collections.assets.upload(file, {
	onProgress: (percent) => console.log(`${percent}%`),
});

const assets = await client.collections.assets.uploadMany(files, {
	onProgress: (percent) => console.log(`${percent}%`),
});
```

## Common Mistakes

### CRITICAL: Missing context in app.collections calls

When using `app.collections.*` outside handlers, you MUST pass a context. Without it, the call has no session, no locale, and no access mode.

```ts
// WRONG -- no context
const posts = await app.collections.posts.find({});

// CORRECT -- explicit context
const ctx = await app.createContext({ accessMode: "system" });
const posts = await app.collections.posts.find({}, ctx);
```

Inside handlers (route handlers, hooks, jobs), context is injected automatically -- use `collections.*` directly.

### HIGH: Expecting find() to return an array

`find()` returns `{ docs: T[], totalDocs: number }`, not an array.

```ts
// WRONG
const posts = await collections.posts.find({});
posts.forEach((p) => console.log(p.title)); // TypeError

// CORRECT
const { docs, totalDocs } = await collections.posts.find({});
docs.forEach((p) => console.log(p.title));
```

### HIGH: Relations not populated

Relations return only the ID by default. Use `with` to populate:

```ts
// Returns { author: "user-id-123" }
const post = await collections.posts.findOne({ where: { id: "abc" } });

// Returns { author: { id: "user-id-123", name: "John", ... } }
const post = await collections.posts.findOne({
	where: { id: "abc" },
	with: { author: true },
});
```

### MEDIUM: Using accessMode "system" in HTTP handlers

System mode bypasses all access control. Only use it in background jobs, seeds, and scripts -- never in request handlers.

```ts
// WRONG -- in an HTTP route handler
export default route()
	.get()
	.handler(async ({ app }) => {
		const ctx = await app.createContext({ accessMode: "system" });
		return app.collections.posts.find({}, ctx); // bypasses access control!
	});

// CORRECT -- use injected collections (respects session access rules)
export default route()
	.get()
	.handler(async ({ collections }) => {
		return collections.posts.find({});
	});
```

### HIGH: Expecting updateMany() to return a single record

Server bulk update returns an **array** of updated records:

```ts
// WRONG -- updateMany returns T[], not T
const updated = await collections.posts.updateMany({
	where: { id: "abc" },
	data: { status: "published" },
});
console.log(updated.status); // undefined!

// CORRECT
const [updated] = await collections.posts.updateMany({
	where: { id: "abc" },
	data: { status: "published" },
});
// or, for a single record by id:
const updated2 = await collections.posts.updateById({
	id: "abc",
	data: { status: "published" },
});
```

### HIGH: `update`/`delete` mean different things on server vs client

On server CRUD, `update`/`delete` are deprecated aliases of the BULK operations (`{ where, data }` → `T[]`). On the client SDK they are by-id operations (`{ id, data }` → `T`). Always use the unambiguous names: `updateById`/`deleteById`/`restoreById` for single records, `updateMany`/`deleteMany` for bulk. Calling a method that does not exist (e.g. a typo) on server CRUD throws a `TypeError` listing the valid methods.

### MEDIUM: Wrong create() signature

`create()` takes a flat data object, NOT `{ data: {...} }`:

```ts
// WRONG
await collections.posts.create({ data: { title: "Hello" } });

// CORRECT
await collections.posts.create({ title: "Hello", body: "World" });
```

Note: `updateById()`/`updateMany()` DO use `{ id/where, data }` -- only `create()` is flat.
