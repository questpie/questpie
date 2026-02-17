# @questpie/next

Next.js App Router adapter for QUESTPIE. Exports catch-all route handlers that mount CMS CRUD, auth, storage, RPC, and realtime routes.

## Installation

```bash
bun add @questpie/next questpie
```

## Setup

### 1. Route Handler

```ts
// app/api/cms/[...path]/route.ts
import { questpieNextRouteHandlers } from "@questpie/next";
import { cms, appRpc } from "@/questpie/server/cms";

export const { GET, POST, PUT, PATCH, DELETE } = questpieNextRouteHandlers(cms, {
  basePath: "/api/cms",
  rpc: appRpc,
});

export const dynamic = "force-dynamic";
```

### 2. Client

```ts
// lib/cms-client.ts
import { createClient } from "questpie/client";
import type { AppCMS, AppRpc } from "@/questpie/server/cms";

export const cmsClient = createClient<AppCMS, AppRpc>({
  baseURL: process.env.NEXT_PUBLIC_URL!,
  basePath: "/api/cms",
});
```

### 3. Server Component

```tsx
// app/posts/page.tsx
import { cmsClient } from "@/lib/cms-client";

export default async function PostsPage() {
  const { docs } = await cmsClient.collections.posts.find({
    where: { published: { eq: true } },
    orderBy: { publishedAt: "desc" },
    limit: 10,
  });

  return (
    <ul>
      {docs.map((post) => <li key={post.id}>{post.title}</li>)}
    </ul>
  );
}
```

### 4. Client Component with TanStack Query

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { cmsClient } from "@/lib/cms-client";

const cmsQueries = createQuestpieQueryOptions(cmsClient);

export function PostsList() {
  const { data } = useQuery(
    cmsQueries.collections.posts.find({ limit: 10 })
  );

  return (
    <ul>
      {data?.docs.map((post) => <li key={post.id}>{post.title}</li>)}
    </ul>
  );
}
```

### 5. Server Actions

```ts
"use server";

import { cms } from "@/questpie/server/cms";
import { revalidatePath } from "next/cache";

export async function createPost(formData: FormData) {
  const post = await cms.api.collections.posts.create({
    title: formData.get("title") as string,
    content: formData.get("content") as string,
  });
  revalidatePath("/posts");
  return post;
}
```

## Routes

The adapter creates catch-all handlers under your base path:

| Method | Route                                    | Description          |
| ------ | ---------------------------------------- | -------------------- |
| GET    | `/api/cms/collections/:name`             | List items           |
| POST   | `/api/cms/collections/:name`             | Create item          |
| GET    | `/api/cms/collections/:name/:id`         | Get item             |
| PATCH  | `/api/cms/collections/:name/:id`         | Update item          |
| DELETE | `/api/cms/collections/:name/:id`         | Delete item          |
| POST   | `/api/cms/collections/:name/:id/restore` | Restore soft-deleted |
| GET    | `/api/cms/globals/:name`                 | Get global           |
| PATCH  | `/api/cms/globals/:name`                 | Update global        |
| POST   | `/api/cms/collections/:name/upload`      | Upload file          |
| ALL    | `/api/cms/auth/*`                        | Better Auth routes   |
| POST   | `/api/cms/rpc/*`                         | RPC procedures       |
| GET    | `/api/cms/collections/:name/subscribe`   | SSE realtime         |

## Environment Variables

```env
DATABASE_URL=postgresql://...
NEXT_PUBLIC_URL=http://localhost:3000
AUTH_SECRET=your-secret-key
```

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
