# @questpie/tanstack-query

Type-safe TanStack React Query integration for QUESTPIE.

## Features

- **Query Options Factory** - Pre-built query/mutation options using `queryOptions()` and `mutationOptions()` from TanStack Query
- **RPC Query Primitives** - Typed `query()` / `mutation()` helpers for `client.rpc.*` procedures
- **SSR Ready** - Prefetch data on server, hydrate on client
- **Type-Safe** - Full TypeScript inference from your CMS schema

## Installation

```bash
bun add @questpie/tanstack-query questpie @tanstack/react-query
```

## Quick Start

### 1. Create Query Options

```typescript
// src/lib/queries.ts
import { createClient } from "questpie/client";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import type { AppCMS, AppRpc } from "@/cms";

const cmsClient = createClient<AppCMS, AppRpc>({
  baseURL: "http://localhost:3000",
  basePath: "/api/cms",
});

export const cmsQueries = createQuestpieQueryOptions(cmsClient, {
  keyPrefix: ["cms"], // Optional: prefix for all query keys
});
```

### 2. Use in Components

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { cmsQueries } from "@/lib/queries"

function PostsList() {
  // Queries
  const { data: posts } = useQuery(cmsQueries.collections.posts.find({ limit: 10 }))

  // Mutations
  const queryClient = useQueryClient()

  const createPost = useMutation({
    ...cmsQueries.collections.posts.create(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms", "collections", "posts"] })
    },
  })

  return (
    <div>
      {posts?.docs.map((post) => (
        <div key={post.id}>{post.title}</div>
      ))}
      <button onClick={() => createPost.mutate({ title: "New Post" })}>
        Create Post
      </button>
    </div>
  )
}
```

## Query Options API

### Collections

```typescript
// Find many
cmsQueries.collections.posts.find({
  where: { published: { eq: true } },
  orderBy: { createdAt: "desc" },
  limit: 10,
  offset: 0,
  with: { author: true },
});

// Find one
cmsQueries.collections.posts.findOne({
  where: { id: "post-id" },
  with: { author: true, comments: true },
});

// Create
cmsQueries.collections.posts.create();
// Usage: mutation.mutate({ title: "...", content: "..." })

// Update
cmsQueries.collections.posts.update();
// Usage: mutation.mutate({ id: "...", data: { title: "..." } })

// Delete
cmsQueries.collections.posts.delete();
// Usage: mutation.mutate({ id: "..." })

// Restore (soft delete)
cmsQueries.collections.posts.restore();
// Usage: mutation.mutate({ id: "..." })
```

### Globals

```typescript
// Get
cmsQueries.globals.siteSettings.get();

// Update
cmsQueries.globals.siteSettings.update();
// Usage: mutation.mutate({ data: { siteName: "..." } })
```

### Custom Queries

```typescript
const searchQuery = cmsQueries.custom.query({
  key: ["search", query],
  queryFn: () => fetch(`/api/search?q=${query}`).then((r) => r.json()),
});

useQuery(searchQuery);
```

### RPC

```typescript
// Query options from RPC procedure
const statsQuery = cmsQueries.rpc.dashboard.getStats.query({ period: "week" });

// Mutation options from RPC procedure
const publishPost = useMutation(cmsQueries.rpc.posts.publish.mutation());
publishPost.mutate({ id: "post_123" });

// Stable key helper for invalidation/prefetch
queryClient.invalidateQueries({
  queryKey: cmsQueries.rpc.dashboard.getStats.key({ period: "week" }),
});
```

## SSR Prefetching

### TanStack Start

```typescript
// src/routes/posts.tsx
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { cmsQueries } from "@/lib/queries"

export const Route = createFileRoute("/posts")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      cmsQueries.collections.posts.find({ limit: 10 })
    )
  },
  component: PostsPage,
})

function PostsPage() {
  const { data: posts } = useSuspenseQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  )

  return (
    <ul>
      {posts.docs.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}
```

### Next.js

```typescript
// app/posts/page.tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query"
import { getQueryClient } from "@/lib/query-client"
import { cmsQueries } from "@/lib/queries"
import { PostsList } from "./posts-list"

export default async function PostsPage() {
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PostsList />
    </HydrationBoundary>
  )
}
```

## Optimistic Updates

```typescript
const queryClient = useQueryClient();

const updatePost = useMutation({
  ...cmsQueries.collections.posts.update(),
  onMutate: async ({ id, data }) => {
    await queryClient.cancelQueries({
      queryKey: ["cms", "collections", "posts"],
    });

    const previousPosts = queryClient.getQueryData([
      "cms",
      "collections",
      "posts",
    ]);

    queryClient.setQueryData(["cms", "collections", "posts"], (old) => ({
      ...old,
      docs: old.docs.map((post) =>
        post.id === id ? { ...post, ...data } : post,
      ),
    }));

    return { previousPosts };
  },
  onError: (err, variables, context) => {
    queryClient.setQueryData(
      ["cms", "collections", "posts"],
      context?.previousPosts,
    );
  },
  onSettled: () => {
    queryClient.invalidateQueries({
      queryKey: ["cms", "collections", "posts"],
    });
  },
});
```

## Infinite Queries

```typescript
import { useInfiniteQuery } from "@tanstack/react-query"
import { cmsClient } from "@/lib/cms-client"

function InfinitePosts() {
  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ["cms", "collections", "posts", "infinite"],
    queryFn: ({ pageParam = 0 }) =>
      cmsClient.collections.posts.find({
        limit: 10,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.flatMap((p) => p.docs).length
      return lastPage.docs.length === 10 ? totalFetched : undefined
    },
    initialPageParam: 0,
  })

  return (
    <div>
      {data?.pages.flatMap((page) =>
        page.docs.map((post) => <div key={post.id}>{post.title}</div>)
      )}
      {hasNextPage && (
        <button onClick={() => fetchNextPage()}>Load More</button>
      )}
    </div>
  )
}
```

## Query Key Structure

All query keys follow this structure:

```typescript
// Collections
[...keyPrefix, "collections", collectionName, "find", options]
[...keyPrefix, "collections", collectionName, "findOne", options]

// Globals
[...keyPrefix, "globals", globalName, "get", options]

// RPC
[...keyPrefix, "rpc", ...segments, "query", input]
[...keyPrefix, "rpc", ...segments, "mutation"]

// Custom
[...keyPrefix, ...customKey]
```

## TypeScript

Full type inference from your CMS schema:

```typescript
import type { CollectionSelect } from "questpie";
import type { AppCMS, AppRpc } from "@/cms";
import { createClient } from "questpie/client";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

const cmsClient = createClient<AppCMS, AppRpc>({
  baseURL: "http://localhost:3000",
  basePath: "/api/cms",
});

const cmsQueries = createQuestpieQueryOptions(cmsClient);

// Collection item type
type Post = CollectionSelect<AppCMS["config"]["collections"]["posts"]>;

// Query result types are automatically inferred
const { data } = useQuery(cmsQueries.collections.posts.find({ limit: 10 }));
//    ^? { docs: Post[], totalDocs: number, ... }
```

## Related Packages

- [`questpie`](../questpie) - Core CMS engine
- [`@questpie/hono`](../hono) - Hono adapter
- [`@questpie/elysia`](../elysia) - Elysia adapter
- [`@questpie/next`](../next) - Next.js adapter

## License

MIT
