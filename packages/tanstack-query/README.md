# @questpie/tanstack-query

Type-safe TanStack Query option builders for QUESTPIE — collections, globals, RPC procedures, and realtime streaming.

## Features

- **Query Options Factory** — Pre-built `queryOptions()` and `mutationOptions()` for all CRUD operations
- **RPC Query Options** — Typed `query()` / `mutation()` builders for standalone RPC procedures with nested router support
- **Realtime Streaming** — `streamedQuery`-based options for SSE live updates on collections and globals
- **Batch Operations** — `updateMany` and `deleteMany` mutation builders
- **SSR Ready** — Prefetch data on the server, hydrate on the client
- **Full Type Inference** — Types flow from your app schema through to query results

## Installation

```bash
bun add @questpie/tanstack-query questpie @tanstack/react-query
```

## Quick Start

### 1. Create Query Options

```ts
import { createClient } from "questpie/client";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import type { App, AppRpc } from "@/questpie/server/app";

const appClient = createClient<App, AppRpc>({
  baseURL: "http://localhost:3000",
  basePath: "/api",
});

export const appQueries = createQuestpieQueryOptions(appClient);
```

### 2. Use in Components

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cmsQueries } from "@/lib/queries";

function PostsList() {
  const { data } = useQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  );

  const queryClient = useQueryClient();
  const createPost = useMutation({
    ...cmsQueries.collections.posts.create(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cmsQueries.collections.posts.key() });
    },
  });

  return (
    <div>
      {data?.docs.map((post) => <div key={post.id}>{post.title}</div>)}
      <button onClick={() => createPost.mutate({ title: "New Post" })}>
        Create
      </button>
    </div>
  );
}
```

## Collections

```ts
// Find many (paginated)
cmsQueries.collections.posts.find({
  where: { published: { eq: true } },
  orderBy: { createdAt: "desc" },
  limit: 10,
  offset: 0,
  with: { author: true },
})

// Find one
cmsQueries.collections.posts.findOne({
  where: { id: "post-id" },
  with: { author: true },
})

// Count
cmsQueries.collections.posts.count({
  where: { published: { eq: true } },
})

// Create (mutation)
cmsQueries.collections.posts.create()

// Update (mutation)
cmsQueries.collections.posts.update()

// Delete (mutation)
cmsQueries.collections.posts.delete()

// Update many (mutation)
cmsQueries.collections.posts.updateMany()

// Delete many (mutation)
cmsQueries.collections.posts.deleteMany()

// Restore soft-deleted (mutation)
cmsQueries.collections.posts.restore()

// Query key for invalidation
cmsQueries.collections.posts.key()
```

## Globals

```ts
// Get global value
cmsQueries.globals.siteSettings.get()

// Update global (mutation)
cmsQueries.globals.siteSettings.update()

// Query key
cmsQueries.globals.siteSettings.key()
```

## RPC

Full type-safe query/mutation options for standalone RPC procedures:

```ts
// Query options from RPC procedure
const { data } = useQuery(
  cmsQueries.rpc.dashboard.getStats.query({ period: "week" })
);

// Mutation options from RPC procedure
const publish = useMutation(
  cmsQueries.rpc.posts.publish.mutation()
);
publish.mutate({ id: "post_123" });

// Query key for invalidation/prefetch
queryClient.invalidateQueries({
  queryKey: cmsQueries.rpc.dashboard.getStats.key({ period: "week" }),
});
```

## Realtime Streaming

Collection queries support SSE-based live updates via `streamedQuery`:

```ts
// Enable realtime on a query
const { data } = useQuery(
  cmsQueries.collections.posts.find(
    { limit: 10 },
    { realtime: true }
  )
);
```

Topic helpers for manual subscription:

```ts
import { buildCollectionTopic, buildGlobalTopic } from "@questpie/tanstack-query";

const postsTopic = buildCollectionTopic("posts");
const settingsTopic = buildGlobalTopic("siteSettings");
```

## SSR Prefetching

### TanStack Start

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { cmsQueries } from "@/lib/queries";

export const Route = createFileRoute("/posts")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      cmsQueries.collections.posts.find({ limit: 10 })
    );
  },
  component: PostsPage,
});

function PostsPage() {
  const { data } = useSuspenseQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  );
  return (
    <ul>
      {data.docs.map((post) => <li key={post.id}>{post.title}</li>)}
    </ul>
  );
}
```

### Next.js

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { cmsQueries } from "@/lib/queries";

export default async function PostsPage() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  );
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PostsList />
    </HydrationBoundary>
  );
}
```

## Query Key Structure

```ts
// Collections
["collections", collectionName, "find", options]
["collections", collectionName, "findOne", options]
["collections", collectionName, "count", options]

// Globals
["globals", globalName, "get"]

// RPC
["rpc", ...segments, "query", input]
["rpc", ...segments, "mutation"]
```

## Documentation

Full documentation: [https://questpie.com/docs/client/tanstack-query](https://questpie.com/docs/client/tanstack-query)

## License

MIT
