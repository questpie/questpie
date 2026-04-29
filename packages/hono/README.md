# @questpie/hono

Hono adapter for QUESTPIE. Mounts CRUD, auth, storage, custom app routes, and realtime routes on a Hono instance with a unified client combining QUESTPIE operations and Hono RPC.

## Installation

```bash
bun add @questpie/hono questpie hono
```

## Server Setup

```ts
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono/server";
import { app } from "./questpie";

const app = new Hono().route("/", questpieHono(app, { basePath: "/api" }));

export default { port: 3000, fetch: app.fetch };
export type AppType = typeof app;
```

## Client Setup

### Hono RPC Client (Unified)

```ts
import { createClientFromHono } from "@questpie/hono/client";
import type { AppType } from "./server";
import type { App } from "./questpie";

const client = createClientFromHono<AppType, App>({
	baseURL: "http://localhost:3000",
});

// CRUD — fully typed
const { docs } = await client.collections.posts.find({ limit: 10 });

// App routes — fully typed
const stats = await client.routes.getStats({ period: "week" });

// Custom Hono routes — via Hono RPC
const result = await client.api.custom.route.$get();
```

### Generic HTTP Client

```ts
import { createClient } from "questpie/client";
import type { App } from "./questpie";

const client = createClient<App>({
	baseURL: "http://localhost:3000",
	basePath: "/api",
});
```

## Routes

The adapter automatically creates:

| Method | Route                                 | Description           |
| ------ | ------------------------------------- | --------------------- |
| GET    | `/api/collections/:name`              | List items            |
| POST   | `/api/collections/:name`              | Create item           |
| GET    | `/api/collections/:name/:id`          | Get item              |
| PATCH  | `/api/collections/:name/:id`          | Update item           |
| DELETE | `/api/collections/:name/:id`          | Delete item           |
| POST   | `/api/collections/:name/:id/restore`  | Restore soft-deleted  |
| GET    | `/api/collections/:name/:id/versions` | List item versions    |
| POST   | `/api/collections/:name/:id/revert`   | Revert item version   |
| GET    | `/api/globals/:name`                  | Get global            |
| PATCH  | `/api/globals/:name`                  | Update global         |
| GET    | `/api/globals/:name/versions`         | List global versions  |
| POST   | `/api/globals/:name/revert`           | Revert global version |
| POST   | `/api/collections/:name/upload`       | Upload file           |
| ALL    | `/api/auth/*`                         | Better Auth routes    |
| ANY    | `/api/:route*`                        | Custom app routes     |
| GET    | `/api/collections/:name/subscribe`    | SSE realtime          |

## Documentation

Full documentation: [https://questpie.com/docs](https://questpie.com/docs)

## License

MIT
