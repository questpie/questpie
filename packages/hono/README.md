# @questpie/hono

Hono adapter for QUESTPIE CMS with unified client combining CMS CRUD operations and Hono RPC.

## Features

- 🔒 **Type Safety**: Type-safe CMS CRUD operations
- 🚀 **High Performance**: Built on Hono's fast framework
- 🎯 **Unified Client**: Single client for CMS CRUD and custom routes
- 📦 **Zero Config**: Works out of the box with minimal setup

## Installation

```bash
bun add @questpie/hono @questpie/cms hono
```

## Quick Start

### Server Setup

```typescript
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";
import { cms } from "./cms";

const app = new Hono()
	.route("/", questpieHono(cms))
	.listen(3000);

export type AppType = typeof app;
```

### Client Setup with Unified Client

```typescript
import { createClientFromHono } from "@questpie/hono/client";
import { cms } from "./cms";
import type { AppType } from "./server";

// IMPORTANT: Use `typeof cms` directly (not a type alias) for proper type inference
const client = createClientFromHono<AppType, typeof cms>({
	baseURL: "http://localhost:3000",
});

// ✨ Use CMS CRUD operations (fully typed!)
const posts = await client.collections.posts.find({ limit: 10 });

// ✨ Use Hono RPC for custom routes
const result = await client.api.custom.route.$get();
```

## Configuration

### Custom Options

```typescript
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono";
import { cms } from "./cms";

const app = new Hono().route(
	"/",
	questpieHono(cms, {
		basePath: "/cms-api", // Default: '/api'
		cors: {
			origin: "https://example.com",
			credentials: true,
		},
	}),
);
```

### Disable CORS

```typescript
const app = new Hono().route(
	"/",
	questpieHono(cms, {
		cors: false, // Disable CORS middleware
	}),
);
```

## API Routes

The adapter automatically creates the following routes:

### Collections

- `GET /api/cms/:collection` - Find all items
- `POST /api/cms/:collection` - Create item
- `GET /api/cms/:collection/:id` - Find one item
- `PATCH /api/cms/:collection/:id` - Update item
- `DELETE /api/cms/:collection/:id` - Delete item

### Globals

- `GET /api/cms/globals/:global` - Get global settings
- `PATCH /api/cms/globals/:global` - Update global settings

### Storage

- `POST /api/storage/upload` - Upload file

### Authentication

- `ALL /api/auth/*` - Better Auth routes

## Unified Client Examples

### CRUD Operations

```typescript
import { createClientFromHono } from "@questpie/hono/client";
import type { AppType } from "./server";
import type { cms } from "./cms";

const client = createClientFromHono<AppType, typeof cms>({
	baseURL: "http://localhost:3000",
});

// CMS CRUD operations
const posts = await client.collections.posts.find({
	where: { published: true },
	limit: 10,
	orderBy: { createdAt: "desc" },
});

const newPost = await client.collections.posts.create({
	title: "New Post",
	content: "Content here",
});

const updated = await client.collections.posts.update("123", {
	title: "Updated Title",
});

await client.collections.posts.delete("123");
```

### With Relations

```typescript
const post = await client.collections.posts.findOne({
	where: { id: "123" },
	with: {
		author: true,
		comments: true,
	},
});
```

### Custom Routes with Hono RPC

```typescript
// Custom business logic routes using Hono RPC
const availability = await client.api.barbers[":barberId"].availability.$get({
	param: { barberId: "barber-123" },
	query: { date: "2025-01-15", serviceId: "service-456" },
});

if (availability.ok) {
	const data = await availability.json();
	console.log("Available slots:", data.availableSlots);
}

const booking = await client.api.appointments.book.$post({
	json: {
		barberId: "123",
		serviceId: "456",
		scheduledAt: "2025-01-15T10:00:00Z",
	},
});
```

### File Upload

```typescript
const formData = new FormData();
formData.append("file", file);

const response = await fetch(`${baseURL}/api/storage/upload`, {
	method: "POST",
	body: formData,
});

const asset = await response.json();
```

## Generic HTTP Client

If you prefer a pure HTTP client without Hono RPC, use the shared client from `@questpie/cms`:

```typescript
import { createQCMSClient } from "@questpie/cms/client";
import type { cms } from "./server";

const client = createQCMSClient<typeof cms>({
	baseURL: "http://localhost:3000",
	basePath: "/api",
});

// Type-safe CMS CRUD only (no custom routes)
const posts = await client.collections.posts.find({ limit: 10 });
```

## Advantages

- **Unified Client**: Single client instance for both CMS CRUD and custom routes
- **Type Safety**: Strongly typed CMS operations with auto-complete
- **Hono RPC**: Access custom routes using Hono's native RPC client
- **Simple Setup**: No need to manage multiple client instances

## License

MIT
