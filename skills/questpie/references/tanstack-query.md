---
name: questpie-tanstack-query
description:
  QUESTPIE TanStack Query integration - createQuestpieQueryOptions option builders, useQuery useMutation queryOptions mutationOptions, collections globals routes, streamedQuery SSE realtime subscriptions, batch helpers, type inference AppConfig createClient, React data fetching caching, framework adapters TanStack Start Next.js Hono Elysia, frontend client SDK querying where orderBy pagination with select
  - questpie-core
---

## Overview

`@questpie/tanstack-query` provides type-safe TanStack Query option builders for QUESTPIE. It creates `queryOptions()` and `mutationOptions()` objects that you pass directly to `useQuery()` and `useMutation()`. Full type inference flows from your server schema to React components.

## Contents

- [Installation](#installation)
- [Setup](#setup), client, query options proxy, `QueryClientProvider`
- [Collection Queries](#collection-queries), find, find one, count, realtime
- [Collection Mutations](#collection-mutations), create, update, delete, bulk, versioning
- [Global Queries](#global-queries), get + update (note: `update` takes `{ data }`)
- [Routes](#routes), nested namespaces, query keys
- [Custom Queries](#custom-queries), escape hatch for non-standard calls
- [Key Builder](#key-builder), prefixed query keys
- [Query Operators (Where Clauses)](#query-operators-where-clauses), operators by field type, orderBy, pagination, select
- [Type Inference](#type-inference), `AppConfig` flow
- [Direct Client Usage (without TanStack Query)](#direct-client-usage-without-tanstack-query)
- [Realtime](#realtime), `{ realtime: true }`, adapters, topic builders
- [Channel Subscriptions](#channel-subscriptions), typed ordered application events
- [Framework Adapters](#framework-adapters), TanStack Start, Next.js, Hono, Elysia
- [Common Mistakes](#common-mistakes)

## Installation

```bash
bun add @questpie/tanstack-query @tanstack/react-query
```

## Setup

### 1. Create the QUESTPIE Client

```ts title="lib/client.ts"
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

export const client = createClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});
```

### 2. Create Query Options Proxy

```ts title="lib/queries.ts"
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { client } from "./client";

export const q = createQuestpieQueryOptions(client, {
	keyPrefix: ["questpie"], // optional, default: ["questpie"]
	locale: "en", // optional, sets locale for all queries
	stage: undefined, // optional, workflow stage filter
});
```

### 3. Wrap App with QueryClientProvider

```tsx title="app.tsx"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<YourApp />
		</QueryClientProvider>
	);
}
```

## Collection Queries

### Find (list)

```tsx
import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";

function PostList() {
	const { data, isLoading } = useQuery(
		q.collections.posts.find({
			where: { status: "published" },
			orderBy: { createdAt: "desc" },
			limit: 10,
			offset: 0,
		}),
	);

	if (isLoading) return <div>Loading...</div>;

	return (
		<ul>
			{data?.docs.map((post) => (
				<li key={post.id}>{post.title}</li>
			))}
			<p>Total: {data?.totalDocs}</p>
		</ul>
	);
}
```

### Find with Realtime

Pass `{ realtime: true }` as the second argument to enable SSE-based live updates via `streamedQuery`:

```tsx
function LivePostList() {
	const { data } = useQuery(
		q.collections.posts.find(
			{ where: { status: "published" }, limit: 20 },
			{ realtime: true },
		),
	);
	// data auto-updates when posts change on the server
	return (
		<ul>
			{data?.docs.map((p) => (
				<li key={p.id}>{p.title}</li>
			))}
		</ul>
	);
}
```

### Find One

```tsx
function PostDetail({ id }: { id: string }) {
	const { data: post } = useQuery(
		q.collections.posts.findOne({
			where: { id },
			with: { author: true, categories: true },
		}),
	);

	if (!post) return null;
	return <article>{post.title}</article>;
}
```

### Count

```tsx
const { data: count } = useQuery(
	q.collections.posts.count({ where: { status: "draft" } }),
);
```

## Collection Mutations

### Create

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";

function CreatePostForm() {
	const queryClient = useQueryClient();
	const create = useMutation({
		...q.collections.posts.create(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["questpie", "collections", "posts"],
			});
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				create.mutate({
					title: "New Post",
					body: "Content here",
					status: "draft",
				});
			}}
		>
			<button type="submit">Create</button>
		</form>
	);
}
```

### Update

```tsx
const update = useMutation(q.collections.posts.update());

update.mutate({ id: "post-id", data: { status: "published" } });
```

### Delete

```tsx
const remove = useMutation(q.collections.posts.delete());

remove.mutate({ id: "post-id" });
```

### Bulk Operations

```tsx
// Update many
const updateMany = useMutation(q.collections.posts.updateMany());
updateMany.mutate({ where: { status: "draft" }, data: { status: "archived" } });

// Delete many
const deleteMany = useMutation(q.collections.posts.deleteMany());
deleteMany.mutate({ where: { status: "archived" } });
```

### Versioning and Workflow Stages

```tsx
const { data: versions } = useQuery(
	q.collections.posts.findVersions({ id: "post-id", limit: 10 }),
);
const revert = useMutation(q.collections.posts.revertToVersion());
revert.mutate({ id: "post-id", version: 3 });
const transition = useMutation(q.collections.posts.transitionStage());
transition.mutate({ id: "post-id", stage: "published" });
```

## Global Queries

```tsx
function SiteSettings() {
	const { data: settings } = useQuery(q.globals.siteSettings.get());
	const update = useMutation(q.globals.siteSettings.update());

	return (
		<div>
			<h1>{settings?.shopName}</h1>
			<button onClick={() => update.mutate({ data: { shopName: "New Name" } })}>
				Update
			</button>
		</div>
	);
}
```

The globals `update` mutation takes `{ data: {...} }`, its `mutationFn` unwraps `variables.data`. This differs from the direct client (`client.globals.siteSettings.update({ shopName: "New Name" })`), which takes the data object directly.

### Globals with Realtime

```tsx
const { data } = useQuery(
	q.globals.siteSettings.get(undefined, { realtime: true }),
);
```

## Routes

Route calls support nested namespaces matching your `routes/` directory structure.

```tsx
// routes/get-stats.ts -> routes.getStats
const { data: stats } = useQuery(q.routes.getStats.query({ period: "week" }));

// routes/booking/create.ts -> routes.booking.create
const createBooking = useMutation(q.routes.booking.create.mutation());

createBooking.mutate({
	barberId: "abc",
	serviceId: "def",
	scheduledAt: "2025-03-15T10:00:00Z",
});
```

### Route Query Keys

Access query keys for manual invalidation:

```tsx
const queryClient = useQueryClient();

// Get the query key for a specific route call
const key = q.routes.getStats.key({ period: "week" });
queryClient.invalidateQueries({ queryKey: key });
```

## Custom Queries

For queries that don't fit the standard collection/global/route pattern:

```tsx
const { data } = useQuery(
	q.custom.query({
		key: ["custom", "analytics"],
		queryFn: () => fetch("/analytics").then((r) => r.json()),
	}),
);

const mutation = useMutation(
	q.custom.mutation({
		key: ["custom", "import"],
		mutationFn: (file: File) => uploadFile(file),
	}),
);
```

## Key Builder

Build prefixed query keys for manual cache operations:

```tsx
const key = q.key(["collections", "posts"]);
// -> ["questpie", "collections", "posts"]

queryClient.invalidateQueries({ queryKey: key });
```

## Query Operators (Where Clauses)

All operators are type-safe based on your field definitions:

```ts
// Equality
where: { status: "published" }

// Comparison
where: { price: { gt: 1000, lte: 5000 } }

// Date ranges
where: { createdAt: { gte: new Date("2025-01-01"), lte: new Date("2025-12-31") } }

// Text operations
where: { title: { contains: "hello" } }
where: { email: { startsWith: "john" } }

// In
where: { status: { in: ["draft", "published"] } }

// Relations
where: { author: "user-id-123" }
```

### Operators by Field Type

`where` operators are identical to the server CRUD API and fully type-safe from your field definitions. Full operator reference by field type: `references/query-operators.md`.

### OrderBy, Pagination, Relations, Select

```ts
// OrderBy
q.collections.posts.find({ orderBy: { createdAt: "desc" } });

// Pagination
q.collections.posts.find({ limit: 10, offset: 20 });

// Include relations
q.collections.posts.findOne({
	where: { id: "abc" },
	with: { author: true, comments: { with: { user: true } } },
});

// Select specific fields
q.collections.posts.find({
	select: { id: true, title: true, status: true },
});
```

## Type Inference

Types flow end-to-end: your field definitions are compiled by codegen into the generated `AppConfig` type (collections, globals, and routes, each with `select`/`insert`/`where`/`orderBy` shapes), and `createClient<AppConfig>()` threads them into `q.collections.posts.find()`, the `where` operators, and the returned `data`.

`AppConfig` is generated, import it from `#questpie`, never hand-write it:

```ts
import type { AppConfig } from "#questpie";
```

## Direct Client Usage (without TanStack Query)

The client can be used directly without the query options proxy:

```ts
const { docs, totalDocs } = await client.collections.posts.find({
	where: { status: "published" },
	orderBy: { createdAt: "desc" },
	limit: 10,
});
const post = await client.collections.posts.findOne({
	where: { id: "abc" },
	with: { author: true },
});
await client.collections.posts.create({ title: "Hello", status: "draft" });
await client.collections.posts.updateById({
	id: "abc",
	data: { status: "published" },
});
await client.collections.posts.deleteById({ id: "abc" });
const settings = await client.globals.siteSettings.get();
const result = await client.routes.createBooking({
	barberId: "abc",
	serviceId: "def",
});
client.setLocale("sk"); // Set locale for localized content
```

## Realtime

Pass `{ realtime: true }` as the **typed** second argument (`RealtimeQueryConfig`) to `find()`, `count()`, or `get()`. The stream supplies the initial value and later access-controlled snapshots, so there is no duplicate REST fetch. `findOne()` and `findVersions()` have no realtime form (a second argument there is a compile error). Realtime `count()` remains a scalar number.

```tsx
const { data } = useQuery(
	q.collections.posts.find(
		{ where: { status: "published" }, limit: 20 },
		{ realtime: true },
	),
);
```

Server realtime must be enabled. SSE is the default client transport; a normal Postgres URL auto-wires `pg_notify`, while setups without a push broker reconcile by polling every 2s. An explicit adapter can select a broker:

```ts
import { runtimeConfig } from "questpie/app";
import { pgNotifyAdapter } from "questpie/adapters/pg-notify";

export default runtimeConfig({
	realtime: {
		adapter: pgNotifyAdapter({ connectionString: process.env.DATABASE_URL }),
	},
});
```

Live-query subscriptions are query-shaped topic objects (`{ resourceType, resource, where?, with? }`), not application channel strings. Outside React, use the typed live form of the same query: `client.collections.posts.live(options, onSnapshot)` / `liveIter(options)` (see `references/realtime.md`).

To build those topic objects yourself, e.g. manual cache invalidation or a raw `client.realtime.subscribe` call that must match the topic a query subscribed with, use the exported builders instead of hand-writing the shape:

```ts
import {
	buildCollectionTopic,
	buildGlobalTopic,
} from "@questpie/tanstack-query"; // re-exported from questpie/client

const topic = buildCollectionTopic("posts", {
	where: { status: "published" },
	limit: 20,
});
const settingsTopic = buildGlobalTopic("siteSettings");
```

Push is a latency optimization; the transactional outbox and reconciliation poll recover missed broker wakes. See `references/realtime.md`.

## Channel Subscriptions

Generated channels expose an accumulating query option. Unlike live queries, ordered channel events are appended rather than reduced to the newest snapshot:

```tsx
const { data: messages = [] } = useQuery(
	q.channels.chatRoom.subscription({ roomId }),
);
```

The result is a typed array of `{ event, eventId, data }` unions. The query's abort signal closes the underlying channel iterator. Channel definition, authorization, server publish, and presence are covered in `references/channels.md`.

## Framework Adapters

**TanStack Start** (no adapter package needed):

```ts title="src/routes/api/$.ts"
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { createFetchHandler } from "questpie/http";
import { app } from "#questpie";
const handler = createFetchHandler(app, { basePath: "/api" });
export const Route = createAPIFileRoute("/api/$")({
	GET: ({ request }) => handler(request),
	POST: ({ request }) => handler(request),
});
```

**Next.js**: `import { questpieNextRouteHandlers } from "@questpie/next"` -- export `GET`, `POST`, `PATCH`, `DELETE` from `app/api/[...slug]/route.ts`. The lower-level `questpieNext(app, config)` returns a single fetch-style handler.

**Hono**: `import { questpieHono } from "@questpie/hono/server"` -- `server.route("/api", questpieHono(app))`.

**Elysia**: `import { questpieElysia } from "@questpie/elysia/server"` -- `.use(questpieElysia(app, { basePath: "/api" }))`.

For server-side calls in the same process (SSR loaders, tests), `createClientFromHono` (`@questpie/hono/client`) and `createClientFromEden` (`@questpie/elysia/client`) build the typed client over the live server instance instead of HTTP.

## Common Mistakes

### HIGH: Creating the QUESTPIE client without proper base URL

API calls fail silently or hit the wrong server. Always set `baseURL` correctly for both server and client environments:

```ts
// WRONG -- hardcoded localhost breaks in production
const client = createClient<AppConfig>({ baseURL: "http://localhost:3000" });

// CORRECT -- environment-aware
const client = createClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});
```

### HIGH: Not wrapping app with QueryClientProvider

Hooks throw "No QueryClient set" error. Always wrap your root component with `<QueryClientProvider client={new QueryClient()}>`.

### MEDIUM: Using raw fetch instead of the typed client

Loses type safety and auth handling:

```ts
// WRONG -- no types, no auth token forwarding
const posts = await fetch("/api/collections/posts").then((r) => r.json());

// CORRECT -- fully typed, auth handled
const { docs } = await client.collections.posts.find({ limit: 10 });
```

### MEDIUM: Forgetting to enable server realtime

`{ realtime: true }` is not a request to silently fall back to a normal query. Set `realtime: true` or a realtime object in server runtime config; otherwise the subscription reports an error.

### MEDIUM: Importing from `questpie/client` in server code or vice versa

Violates the server/client boundary. Server code should import from `questpie`, client code from `questpie/client`:

```ts
// WRONG -- client import in server handler
import { createClient } from "questpie/client";

// CORRECT -- server uses context-injected collections
handler: async ({ collections }) => {
	return await collections.posts.find({});
};
```
