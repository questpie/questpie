# @questpie/openapi

Auto-generate OpenAPI 3.1 spec from QuestPie CMS runtime metadata and serve interactive docs via Scalar UI.

## Usage

```ts
import { createFetchHandler } from "questpie";
import { withOpenApi } from "@questpie/openapi";
import { cms, appRpc } from "./cms";

const handler = withOpenApi(
  createFetchHandler(cms, { basePath: "/api/cms", rpc: appRpc }),
  {
    cms,
    rpc: appRpc,
    basePath: "/api/cms",
    info: { title: "My API", version: "1.0.0" },
    scalar: { theme: "purple" },
  },
);

// GET /api/cms/openapi.json → spec JSON
// GET /api/cms/docs         → Scalar UI
// Everything else           → CMS routes
```

## What gets documented

- **Collections** — CRUD endpoints (list, create, findOne, update, delete, count, delete-many, restore, upload, schema, meta)
- **Globals** — get, update, schema
- **RPC functions** — traverses the RPC router tree, documents input/output from Zod schemas
- **Auth** — Better Auth endpoints (sign-in, sign-up, session, sign-out)
- **Search** — full-text search and reindex

## Roadmap

### Phase 2: Automatic output schema inference via Vite plugin

RPC functions that declare `outputSchema` get full request/response documentation today. Functions without it fall back to `{ type: "object" }`.

Phase 2 will add a **Vite plugin** (+ standalone CLI) that uses `ts-morph` to automatically infer output schemas from handler return types — no manual `outputSchema` needed.

#### How it works

1. Point the plugin at your RPC router file
2. It uses ts-morph to statically analyze each `fn({ handler })` return type
3. Converts TS types → JSON Schema
4. Writes a `.generated.ts` file that the runtime spec generator picks up
5. In dev mode, re-runs automatically on file change (HMR-friendly)

#### Planned API

```ts
// vite.config.ts
import { questpieOpenApi } from "@questpie/openapi/codegen";

export default {
  plugins: [
    questpieOpenApi({
      // Path to the file that exports your RPC router
      rpcEntry: "./src/questpie/server/cms.ts",
      // Name of the exported RPC router variable
      rpcExport: "appRpc",
      // Where to write generated schemas (auto-imported at runtime)
      output: "./src/questpie/server/openapi.generated.ts",
    }),
  ],
};
```

```ts
// CLI alternative (for non-Vite setups)
questpie openapi generate \
  --rpc-entry ./src/questpie/server/cms.ts \
  --rpc-export appRpc \
  --output ./src/questpie/server/openapi.generated.ts
```

#### Generated output

```ts
// openapi.generated.ts (auto-generated, do not edit)
export const rpcOutputSchemas = {
  rpc_getActiveBarbers_Output: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        // ... inferred from handler return type
      },
    },
  },
  // ...
};
```

The runtime spec generator merges these with any explicit `outputSchema` definitions (explicit always wins).
