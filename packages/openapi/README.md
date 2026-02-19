# @questpie/openapi

Auto-generate an OpenAPI 3.1 spec from a QUESTPIE app instance and serve interactive API docs via Scalar UI.

## Installation

```bash
bun add @questpie/openapi
```

## Usage

Wrap your fetch handler with `withOpenApi` to add `/openapi.json` and `/docs` routes:

```ts
import { createFetchHandler } from "questpie";
import { withOpenApi } from "@questpie/openapi";
import { app, appRpc } from "./questpie";

const handler = withOpenApi(
  createFetchHandler(app, { basePath: "/api", rpc: appRpc }),
  {
    app,
    rpc: appRpc,
    basePath: "/api",
    info: { title: "My API", version: "1.0.0" },
    scalar: { theme: "purple" },
  },
);

// GET /api/openapi.json → OpenAPI spec
// GET /api/docs         → Scalar UI
// Everything else           → routes
```

## What Gets Documented

| Category        | Endpoints                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| **Collections** | List, create, findOne, update, delete, count, deleteMany, restore, versions, revert, upload, schema, meta |
| **Globals**     | Get, update, versions, revert, schema                                                   |
| **RPC**         | All procedures from the RPC router tree, with input/output from Zod schemas             |
| **Auth**        | Better Auth endpoints (sign-in, sign-up, session, sign-out)                             |
| **Search**      | Full-text search and reindex                                                            |

RPC functions with an explicit `outputSchema` get full request/response documentation. Functions without it fall back to `{ type: "object" }`.

## Standalone Spec Generation

Generate the spec without mounting routes:

```ts
import { generateOpenApiSpec } from "@questpie/openapi";

const spec = generateOpenApiSpec(app, appRpc, {
  basePath: "/api",
  info: { title: "My API", version: "1.0.0" },
});
```

## Documentation

Full documentation: [https://questpie.com/docs/client/openapi](https://questpie.com/docs/client/openapi)

## License

MIT
