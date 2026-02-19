# @questpie/next

Next.js App Router adapter for QUESTPIE. Exports catch-all route handlers that mount CRUD, auth, storage, RPC, and realtime routes.

## Installation

```bash
bun add @questpie/next questpie
```

## Setup

### 1. Route Handler

```ts
// app/api/[...path]/route.ts
import { questpieNextRouteHandlers } from "@questpie/next";
import { app, appRpc } from "@/questpie/server/app";

export const { GET, POST, PUT, PATCH, DELETE } = questpieNextRouteHandlers(app, {
  basePath: "/api",
  rpc: appRpc,
});

export const dynamic = "force-dynamic";
```

### 2. Client

```ts
// lib/client.ts
import { createClient } from "questpie/client";
import type { App, AppRpc } from "@/questpie/server/app";

export const appClient = createClient<App, AppRpc>({
  baseURL: process.env.NEXT_PUBLIC_URL!,
  basePath: "/api",
});
```

### 3. Server Component

```tsx
// app/posts/page.tsx
import { appClient } from "@/lib/client";

export default async function PostsPage() {
  const { docs } = await appClient.collections.posts.find({
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
import { appClient } from "@/lib/client";

const appQueries = createQuestpieQueryOptions(appClient);

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

import { app } from "@/questpie/server/app";
import { revalidatePath } from "next/cache";

export async function createPost(formData: FormData) {
  const post = await app.api.collections.posts.create({
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
| GET    | `/api/collections/:name`             | List items           |
| POST   | `/api/collections/:name`             | Create item          |
| GET    | `/api/collections/:name/:id`         | Get item             |
| PATCH  | `/api/collections/:name/:id`         | Update item          |
| DELETE | `/api/collections/:name/:id`         | Delete item          |
| POST   | `/api/collections/:name/:id/restore` | Restore soft-deleted |
| GET    | `/api/collections/:name/:id/versions` | List item versions   |
| POST   | `/api/collections/:name/:id/revert`   | Revert item version  |
| GET    | `/api/globals/:name`                 | Get global           |
| PATCH  | `/api/globals/:name`                 | Update global        |
| GET    | `/api/globals/:name/versions`         | List global versions |
| POST   | `/api/globals/:name/revert`           | Revert global version |
| POST   | `/api/collections/:name/upload`      | Upload file          |
| ALL    | `/api/auth/*`                        | Better Auth routes   |
| POST   | `/api/rpc/*`                         | RPC procedures       |
| GET    | `/api/collections/:name/subscribe`   | SSE realtime         |

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
