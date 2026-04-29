# @questpie/openapi

Auto-generate an OpenAPI 3.1 spec from a QUESTPIE app instance and serve interactive API docs via Scalar UI.

## Installation

```bash
bun add @questpie/openapi
```

## Usage

Register `openApiModule` in your `modules.ts` file to add `/openapi.json` and `/docs` routes:

```ts
// src/questpie/server/modules.ts
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

export default [adminModule, openApiModule] as const;
```

Configure the OpenAPI module via `config/openapi.ts`:

```ts
// src/questpie/server/config/openapi.ts
import { openApiConfig } from "@questpie/openapi";

export default openApiConfig({
	info: { title: "My API", version: "1.0.0" },
	scalar: { theme: "purple" },
});
```

Your route handler stays clean — no wrapper needed:

```ts
// routes/api/$.ts
import { createFetchHandler } from "questpie";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
```

Once registered, the following endpoints are available:

```
GET /api/openapi.json → OpenAPI spec
GET /api/docs         → Scalar UI
```

## What Gets Documented

| Category        | Endpoints                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| **Collections** | List, create, findOne, update, delete, count, deleteMany, restore, versions, revert, upload, schema, meta |
| **Globals**     | Get, update, versions, revert, schema                                                                     |
| **Routes**      | All standalone routes, with input/output from Zod schemas                                                 |
| **Auth**        | Better Auth endpoints (sign-in, sign-up, session, sign-out)                                               |
| **Search**      | Full-text search and reindex                                                                              |

Routes with an explicit `outputSchema` get full request/response documentation. Routes without it fall back to `{ type: "object" }`.

## Standalone Spec Generation

Generate the spec without mounting routes:

```ts
import { generateOpenApiSpec } from "@questpie/openapi";

const spec = generateOpenApiSpec(app, {
	basePath: "/api",
	info: { title: "My API", version: "1.0.0" },
});
```

## Documentation

Full documentation: [https://questpie.com/docs/client/openapi](https://questpie.com/docs/client/openapi)

## License

MIT
