# @questpie/elysia

Elysia adapter for QUESTPIE. Mounts CRUD, auth, storage, custom app routes, and realtime routes on an Elysia instance with end-to-end type safety via Eden Treaty.

## Installation

```bash
bun add @questpie/elysia questpie elysia
```

## Server Setup

```ts
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia/server";
import { app } from "./questpie";

const app = new Elysia()
	.use(questpieElysia(app, { basePath: "/api" }))
	.listen(3000);

export type App = typeof app;
```

## Client Setup

### Eden Treaty Client (Full Type Safety)

```ts
import { createClientFromEden } from "@questpie/elysia/client";
import type { App } from "./server";
import type { AppConfig } from "./questpie";

const client = createClientFromEden<App, AppConfig>({
	server: "localhost:3000",
});

// CRUD — fully typed
const { docs } = await client.collections.posts.find({ limit: 10 });

// App routes — fully typed
const stats = await client.routes.getStats({ period: "week" });

// Custom Elysia routes — fully typed via Eden Treaty
const result = await client.api.custom.route.get();
```

### Generic HTTP Client

```ts
import { createClient } from "questpie/client";
import type { AppConfig } from "./questpie";

const client = createClient<AppConfig>({
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
