# @questpie/elysia

Elysia adapter for QUESTPIE. Mounts CMS CRUD, auth, storage, RPC, and realtime routes on an Elysia instance with end-to-end type safety via Eden Treaty.

## Installation

```bash
bun add @questpie/elysia questpie elysia
```

## Server Setup

```ts
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia";
import { cms, appRpc } from "./cms";

const app = new Elysia()
  .use(questpieElysia(cms, { basePath: "/api/cms", rpc: appRpc }))
  .listen(3000);

export type App = typeof app;
```

## Client Setup

### Eden Treaty Client (Full Type Safety)

```ts
import { createClientFromEden } from "@questpie/elysia/client";
import type { App } from "./server";
import type { AppCMS, AppRpc } from "./cms";

const client = createClientFromEden<App, AppCMS, AppRpc>({
  server: "localhost:3000",
});

// CMS CRUD — fully typed
const { docs } = await client.collections.posts.find({ limit: 10 });

// RPC — fully typed
const stats = await client.rpc.getStats({ period: "week" });

// Custom Elysia routes — fully typed via Eden Treaty
const result = await client.api.custom.route.get();
```

### Generic HTTP Client

```ts
import { createClient } from "questpie/client";
import type { AppCMS, AppRpc } from "./cms";

const client = createClient<AppCMS, AppRpc>({
  baseURL: "http://localhost:3000",
  basePath: "/api/cms",
});
```

## Routes

The adapter automatically creates:

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

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
