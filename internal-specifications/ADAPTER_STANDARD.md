# Adapter Standard (HTTP)

This document defines the shared contract for HTTP adapters that expose QUESTPIE CMS APIs over web frameworks.

## Purpose

- Keep all framework adapters behaviorally compatible.
- Centralize parsing, context creation, and error handling.
- Provide a single e2e compatibility test suite.

## Reference Implementation

Use the shared adapter core in `packages/cms/src/server/adapters/http.ts`:

- `createCMSAdapterContext`
- `createCMSAdapterRoutes`
- `createCMSFetchHandler`

Adapters should delegate to these helpers rather than re-implementing logic.

## Base Path

- Default `basePath` is `/cms`.
- `basePath` is the CMS root (no extra `/cms` segment).
- For fullstack apps, use `/api/cms`.
- Legacy `{basePath}/cms/*` is still accepted for backwards compatibility.

## Routes

### Auth
- `ALL {basePath}/auth/*`

Delegates to `cms.auth.handler(request)`.

### Storage
- `POST {basePath}/storage/upload`

Accepts `multipart/form-data` with a `file` field. Returns the created `assets` record.

### Collections
- `GET {basePath}/:collection`
- `POST {basePath}/:collection`
- `GET {basePath}/:collection/:id`
- `PATCH {basePath}/:collection/:id`
- `DELETE {basePath}/:collection/:id`
- `POST {basePath}/:collection/:id/restore`

Supported query params on `GET`:
- `limit`, `offset`, `page`
- `where`, `orderBy`, `with`
- `includeDeleted`

### Globals
- `GET {basePath}/globals/:global`
- `PATCH {basePath}/globals/:global`

### Realtime (SSE)
- `GET {basePath}/realtime/:collection`
- `GET {basePath}/realtime/globals/:global`

## Request Context

- Use `createCMSAdapterContext` to build `cmsContext`.
- `accessMode` defaults to `"user"` for HTTP requests.
- Locale is derived from the `Accept-Language` header (or CMS defaults).
- Auth session is resolved via `cms.auth.api.getSession` when available.

## Serialization

The adapter supports both standard JSON and SuperJSON serialization:

- **Standard JSON** (default): Compatible with all REST clients (curl, Postman, mobile apps, etc.)
- **SuperJSON** (opt-in): Enhanced serialization supporting `Date`, `Map`, `Set`, `BigInt`, `undefined`, `RegExp`, etc.

### Enabling SuperJSON

Clients can enable SuperJSON by including one of:
- Header: `X-SuperJSON: 1`
- Header: `Content-Type: application/superjson+json`
- Header: `Accept: application/superjson+json`

When SuperJSON is detected, the server will:
1. Parse request bodies using `superjson.parse()`
2. Serialize responses using `superjson.stringify()`
3. Set `Content-Type: application/superjson+json` in responses

### Client SDK

The official `@questpie/cms` client automatically uses SuperJSON by default:

```typescript
import { createCMSClient } from "@questpie/cms/client";

const client = createCMSClient({
  baseURL: "http://localhost:3000",
  useSuperJSON: true, // default, enables enhanced types
});

// Now you can use native Date objects
await client.collections.posts.create({
  title: "My Post",
  publishedAt: new Date(), // Serialized as Date, not string
});
```

To disable SuperJSON (for maximum compatibility):

```typescript
const client = createCMSClient({
  baseURL: "http://localhost:3000",
  useSuperJSON: false, // standard JSON only
});
```

## Error Responses

- JSON shape: `{ "error": "..." }`
- Errors respect the same serialization mode as requests (SuperJSON or standard JSON)
- Status codes:
  - `404` for missing collection/global or missing records
  - `400` for invalid JSON or mutation errors
  - `500` for unexpected errors

## Compatibility Test Suite

Run the adapter compatibility tests from:

```
packages/adapter-compat
```

Command:

```
bun test
```

The suite validates CRUD, globals, and storage routes across all adapters.
