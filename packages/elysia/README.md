# @questpie/elysia

Elysia adapter for QUESTPIE. Mounts CRUD, auth, storage, RPC, and realtime routes on an Elysia instance with end-to-end type safety via Eden Treaty.

## Installation

```bash
bun add @questpie/elysia questpie elysia
```

## Server Setup

```ts
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia";
import { app, appRpc } from "./questpie";

const app = new Elysia()
  .use(questpieElysia(app, { basePath: "/api", rpc: appRpc }))
  .listen(3000);

export type App = typeof app;
```

## Client Setup

### Eden Treaty Client (Full Type Safety)

```ts
import { createClientFromEden } from "@questpie/elysia/client";
import type { App } from "./server";
import type { App, AppRpc } from "./questpie";

const client = createClientFromEden<App, App, AppRpc>({
  server: "localhost:3000",
});

// CRUD — fully typed
const { docs } = await client.collections.posts.find({ limit: 10 });

// RPC — fully typed
const stats = await client.rpc.getStats({ period: "week" });

// Custom Elysia routes — fully typed via Eden Treaty
const result = await client.api.custom.route.get();
```

### Generic HTTP Client

```ts
import { createClient } from "questpie/client";
import type { App, AppRpc } from "./questpie";

const client = createClient<App, AppRpc>({
  baseURL: "http://localhost:3000",
  basePath: "/api",
});
```

## Routes

The adapter automatically creates:

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

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
