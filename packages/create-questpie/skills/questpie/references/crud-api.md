---
name: questpie-core/crud-api
description: QUESTPIE CRUD API find findOne create update delete count updateMany deleteMany query operators where filter sort orderBy pagination limit offset with select relations depth context accessMode collections globals client server typesafe
  - questpie-core
---

This skill builds on questpie-core.

## Two API Surfaces

QUESTPIE exposes CRUD operations in two ways depending on where you call them:

### 1. Handler Context (routes, hooks, jobs)

Inside any handler, `collections` and `globals` are injected via context. The current request context (session, locale, access mode) is implicit:

```ts
// routes/get-published.ts
import { route } from "questpie";

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

### `update(options)`

Update a document matching `where`. Pass changed fields in `data`.

```ts
const updated = await collections.posts.update({
	where: { id: "abc-123" },
	data: { status: "published" },
});
// updated: T (updated record)
```

### `delete(options)`

Delete documents matching `where`.

```ts
await collections.posts.delete({
	where: { id: "abc-123" },
});
```

### `count(options)`

Count documents matching a filter.

```ts
const total = await collections.posts.count({
	where: { status: "published" },
});
// total: number
```

### `updateMany(options)`

Bulk update all documents matching `where`.

```ts
await collections.posts.updateMany({
	where: { status: "draft" },
	data: { status: "archived" },
});
```

### `deleteMany(options)`

Bulk delete all documents matching `where`.

```ts
await collections.posts.deleteMany({
	where: { status: "archived" },
});
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

## Pagination

Use `limit` and `offset`:

```ts
const page2 = await collections.posts.find({
	limit: 20,
	offset: 20,
});
// page2.totalDocs = total count across all pages
```

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

The client SDK mirrors server operations:

```ts
const posts = await client.collections.posts.find({ limit: 10 });
const post = await client.collections.posts.findOne({ where: { id: "abc" } });
const created = await client.collections.posts.create({ title: "New" });
const updated = await client.collections.posts.update({
	id: "abc",
	data: { title: "Updated" },
});
await client.collections.posts.delete({ id: "abc" });
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

### MEDIUM: Wrong create() signature

`create()` takes a flat data object, NOT `{ data: {...} }`:

```ts
// WRONG
await collections.posts.create({ data: { title: "Hello" } });

// CORRECT
await collections.posts.create({ title: "Hello", body: "World" });
```

Note: `update()` DOES use `{ where, data }` -- only `create()` is flat.
