# @questpie/hono

Hono adapter for QUESTPIE. Mounts CMS CRUD, auth, storage, RPC, and realtime routes on a Hono instance with a unified client combining CMS operations and Hono RPC.

## Installation

```bash
bun add @questpie/hono questpie hono
```

## Server Setup

```ts
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";
import { cms, appRpc } from "./cms";

const app = new Hono()
  .route("/", questpieHono(cms, { basePath: "/api/cms", rpc: appRpc }));

export default { port: 3000, fetch: app.fetch };
export type AppType = typeof app;
```

## Client Setup

### Hono RPC Client (Unified)

```ts
import { createClientFromHono } from "@questpie/hono/client";
import type { AppType } from "./server";
import type { AppCMS, AppRpc } from "./cms";

const client = createClientFromHono<AppType, AppCMS, AppRpc>({
  baseURL: "http://localhost:3000",
});

// CMS CRUD — fully typed
const { docs } = await client.collections.posts.find({ limit: 10 });

// RPC — fully typed
const stats = await client.rpc.getStats({ period: "week" });

// Custom Hono routes — via Hono RPC
const result = await client.api.custom.route.$get();
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
