# Export Redesign Master Plan

## Principles

1. **Server-first** — root path = server API, `/client/*` = client namespace
2. **No mega barrels** — split by concern, max ~15 exports per file
3. **Modules via `/modules/<name>`** — like adapters pattern
4. **Client modules via `/client/modules/<name>`** — symmetric with server
5. **Named exports only** — no default exports from package paths
6. **No wildcards** — remove `"./*"` from all packages
7. **No `export *`** — named re-exports only (tree-shaking)
8. **`sideEffects: false`** — everywhere except CSS
9. **Consistent conditions** — `{ types, default }` format in all packages

---

## New Export Map

### `questpie` (core)

```
BEFORE (1 mega barrel + wildcards):
"."          → 270 lines, 50× export *, pulls in EVERYTHING
"./*"        → exposes all internals

AFTER (split by concern):
"."                    → collection, global, field definitions (CORE factories only)
"./app"                → createApp, runtimeConfig, appConfig, authConfig, starterModule
"./modules/starter"    → { starterModule } (also re-exported from ./app for convenience)
"./services"           → service, job, seed, email, route, migration factories
"./queue"              → queue types, QueueClient, PublishOptions
"./mailer"             → mailer types, MailerService
"./realtime"           → realtime types, RealtimeAdapter, RealtimeChangeEvent
"./search"             → search adapter interface
"./storage"            → storage interface
"./kv"                 → KV interface
"./migration"          → migration utility, OperationSnapshot
"./errors"             → ApiError, QuestpieError
"./auth"               → AuthConfig, session types, access control
"./codegen"            → CodegenPlugin, CategoryDeclaration, CodegenTargetGenerateContext, etc.
"./types"              → AppContext, Registry, Questpie, QuestpieConfig, etc. (type-only)
"./builders"           → CollectionBuilder, GlobalBuilder, wrapBuilderWithExtensions
"./introspection"      → introspectCollection, introspectGlobal, introspectRoutes
"./reactive"           → reactive field utilities (serialize*, isReactivePropPlaceholder)
"./client"             → stays (browser client SDK)
"./shared"             → stays (i18n utils, universal)
"./drizzle"            → stays (version pin)
"./drizzle-pg-core"    → stays (version pin)
"./adapters/*"         → stays ✅ (already good)
"./cli"                → stays (CLI entry)
```

#### Root `"."` — Core factories only (~15 exports):
```ts
// src/exports/index.ts — ONLY core schema factories
export { collection } from "#questpie/server/collection/builder/collection-builder.js";
export { global } from "#questpie/server/global/builder/global-builder.js";
export { module } from "#questpie/server/modules/module-factory.js";

// Re-export drizzle basics users need in collection definitions
export { isNotNull, isNull, sql } from "drizzle-orm";
export { json, jsonb } from "drizzle-orm/pg-core";

// Field type definitions (for .fields(({ f }) => ...))
export type { FieldBuilderProxy, DefaultFieldState, FieldState } from "#questpie/...";
export type { CollectionInfer, CollectionSchema, GlobalSchema } from "#questpie/...";
```

#### `"./app"` — App bootstrap:
```ts
// src/exports/app.ts
export { createApp, createContextFactory } from "#questpie/server/app/create-app.js";
export { runtimeConfig } from "#questpie/server/config/runtime-config.js";
export { appConfig } from "#questpie/server/config/app-config.js";
export { authConfig } from "#questpie/server/config/auth-config.js";
export { starterModule } from "#questpie/server/modules/starter/index.js";

export type { AppDefinition, QuestpieConfig } from "#questpie/...";
export type { InferContextExtensionsFromAppConfig, InferSessionFromAuthConfig } from "#questpie/...";
```

#### `"./modules/starter"` — Starter module:
```ts
// src/exports/modules/starter.ts
export { starterModule } from "#questpie/server/modules/starter/index.js";
```

#### `"./services"` — Service factories:
```ts
// src/exports/services.ts
export { route } from "#questpie/server/routes/route-factory.js";
export { job } from "#questpie/server/queue/job-factory.js";
export { service } from "#questpie/server/services/service-factory.js";
export { seed } from "#questpie/server/seed/seed-factory.js";
export { email } from "#questpie/server/mailer/email-factory.js";
export { migration } from "#questpie/server/migration/migration-factory.js";
```

#### `"./codegen"` — Codegen types (for plugin authors):
```ts
// src/exports/codegen.ts
export type {
  CodegenPlugin,
  CodegenResult,
  CrossTargetValidator,
  CategoryDeclaration,
  CodegenTargetGenerateContext,
  CodegenTargetOutput,
  DiscoveredFile,
  ProjectionError,
} from "#questpie/cli/codegen/types.js";
```

#### `"./types"` — Framework types (large type-only export):
```ts
// src/exports/types.ts
export type { Questpie, QuestpieConfig, AppContext, RequestContext } from "#questpie/...";
export type { Registry, ModuleDefinition } from "#questpie/...";
export type { CollectionAPI, AnyCollectionOrBuilder, AnyGlobalOrBuilder } from "#questpie/...";
export type { RouteParamsFromKey, RouteWithParams, RoutesTree } from "#questpie/...";
export type { DrizzleClientFromQuestpieConfig, TablesFromConfig } from "#questpie/...";
export type { ServiceCustomNamespaceInstances, ServiceInstanceOf, ... } from "#questpie/...";
export type { ExtractModuleProp, UnionToIntersection } from "#questpie/...";
export type { MailerService, QueueClient, PublishOptions } from "#questpie/...";
// ... all type-only exports
```

---

### `@questpie/admin`

```
BEFORE:
"."              → re-exports all of /client (React!) + augmentation side-effect
"./server"       → mega barrel (240 lines, modules + factories + routes + auth)
"./client"       → large barrel (450 lines named exports — OK for UI lib)
"./client-module"→ default export of client module
"./plugin"       → adminPlugin (lightweight)
"./shared"       → preview utils
"./*"            → wildcard

AFTER:
"."                        → adminModule + auditModule (server-first, ROOT = server)
"./modules/admin"          → { adminModule }
"./modules/audit"          → { auditModule }
"./factories"              → view(), block(), component(), adminConfig()
"./fields"                 → admin field type factories (richText, blocks)
"./plugin"                 → stays ✅
"./shared"                 → stays ✅
"./client"                 → stays (React UI barrel — OK, it's a UI lib)
"./client/modules/admin"   → { adminClientModule } (named export)
"./client/styles/base.css" → stays
"./client/styles/index.css"→ stays
```

**REMOVE:** `"./*"` wildcard, `"./server"` mega barrel, `"./client-module"` (moved to `/client/modules/admin`)

#### Root `"."` — Server modules (server-first):
```ts
// src/exports/index.ts
export { adminModule } from "../server/modules/admin/index.js";
export { auditModule } from "../server/modules/audit/index.js";
export type { AdminModule } from "../server/modules/admin/index.js";
export type { AuditModule } from "../server/modules/audit/index.js";
```

#### `"./modules/admin"`:
```ts
// src/exports/modules/admin.ts
export { adminModule } from "../../server/modules/admin/index.js";
export type { AdminModule, AdminCollections } from "../../server/modules/admin/index.js";
```

#### `"./modules/audit"`:
```ts
// src/exports/modules/audit.ts
export { auditModule } from "../../server/modules/audit/index.js";
export type { AuditModule } from "../../server/modules/audit/index.js";
export { logAuditEntry } from "../../server/modules/audit/index.js";
export type { LogAuditEntryOptions, AuditContext } from "../../server/modules/audit/index.js";
```

#### `"./factories"`:
```ts
// src/exports/factories.ts
export { view } from "../server/augmentation/view.js";
export { block, BlockBuilder } from "../server/block/index.js";
export { component } from "../server/augmentation/component.js";
export { adminConfig } from "../server/augmentation.js";
export { createViewCallbackProxy, createComponentCallbackProxy, createActionCallbackProxy } from "../server/augmentation/proxies.js";

export type { ViewDefinition, AdminCollectionConfig, AdminGlobalConfig } from "../server/augmentation.js";
export type { ListViewConfig, FormViewConfig, PreviewConfig, ServerActionsConfig } from "../server/augmentation.js";
export type { AdminConfigInput, DashboardContribution, SidebarContribution } from "../server/augmentation.js";
export type { FilterViewsByKind, ListViewConfigContext, FormViewConfigContext, ActionsConfigContext, AdminConfigContext } from "../server/augmentation.js";
```

#### `"./client/modules/admin"`:
```ts
// src/exports/client/modules/admin.ts
export { default as adminClientModule } from "../../server/modules/admin/client/index.js";
export type { AdminModule as AdminClientModule } from "../../server/modules/admin/client/.generated/module.js";
```

---

### `@questpie/workflows`

```
BEFORE:
"."          → workflow() factory + types (good, small)
"./server"   → workflowsModule + engine + redundant export * from index
"./client"   → workflowsClientModule + page components

AFTER:
"."                            → workflow() factory + types (stays ✅)
"./modules/workflows"          → { workflowsModule }
"./server"                     → engine, cron, config (WITHOUT module, WITHOUT export *)
"./client"                     → page components (WITHOUT module)
"./client/modules/workflows"   → { workflowsClientModule }
"./plugin"                     → { workflowsPlugin } (NEW, separated from server)
```

#### `"./modules/workflows"`:
```ts
// src/exports/modules/workflows.ts
export { workflowsModule } from "../server/modules/workflows/index.js";
export type { WorkflowsModule } from "../server/modules/workflows/index.js";
```

#### `"./client/modules/workflows"`:
```ts
// src/exports/client/modules/workflows.ts
export { default as workflowsClientModule } from "../client/.generated/module.js";
export type { WorkflowsClientModule } from "../client/.generated/module.js";
```

#### `"./server"` (slimmed, no module):
```ts
// src/exports/server.ts — engine + utils, NOT the module itself
export { createWorkflowClient } from "../server/client.js";
export { defaultWorkflowAccess, workflowsConfig } from "../server/config.js";
export { parseCron } from "../server/cron/cron-parser.js";
// ... engine types, compensation, etc.
// NO export * from "./index.js" — removed
```

---

### `@questpie/mcp`

```
BEFORE (already clean):
"."        → mcpModule, mcpConfig, mcpTool, createMcpServer
"./plugin" → mcpPlugin
"./stdio"  → startStdioServer

AFTER (split module out):
"."                    → mcpConfig, mcpTool, createMcpServer (factories/config)
"./modules/mcp"        → { mcpModule }
"./plugin"             → stays ✅
"./stdio"              → stays ✅
```

---

### `@questpie/openapi`

```
BEFORE:
"."        → openApiModule + openApiConfig
"./plugin" → openApiPlugin

AFTER:
"."                    → openApiConfig (config only)
"./modules/openapi"    → { openApiModule }
"./plugin"             → stays ✅
```

---

### HTTP Adapter packages (elysia, hono, next)

Already clean ✅ — no changes needed.

---

### `@questpie/tanstack-query`

```
BEFORE:
"." → createQuestpieQueryOptions + re-exports from questpie/client

AFTER:
"." → createQuestpieQueryOptions ONLY (remove re-exports from questpie/client)
```

Users who need `buildCollectionTopic` etc. import from `questpie/client` directly.

---

## Codegen Changes

### 1. `packages/questpie/src/cli/codegen/template.ts` (root app .generated/index.ts)

**Current imports generated:**
```ts
import { createApp, createContextFactory, type ... } from "questpie";
```

**New imports generated:**
```ts
import { createApp, createContextFactory } from "questpie/app";
import type { AppDefinition, QuestpieConfig, ... } from "questpie/types";
import type { ExtractModuleProp, UnionToIntersection, ... } from "questpie/types";
import type { CollectionAPI, AnyCollectionOrBuilder, ... } from "questpie/types";
import type { DrizzleClientFromQuestpieConfig, ... } from "questpie/types";
import type { MailerService, QueueClient, ... } from "questpie/types";
import type { ServiceCustomNamespaceInstances, ... } from "questpie/types";
import type { RouteParamsFromKey, RouteWithParams } from "questpie/types";
import type { TablesFromConfig } from "questpie/types";
```

### 2. `packages/questpie/src/cli/codegen/factory-template.ts` (.generated/factories.ts)

**Current:**
```ts
import { CollectionBuilder, GlobalBuilder, builtinFields, ... } from "questpie";
```

**New:**
```ts
import { CollectionBuilder, GlobalBuilder, builtinFields } from "questpie/builders";
import { collection, global } from "questpie";
```

### 3. `packages/questpie/src/cli/codegen/module-template.ts` (.generated/module.ts for packages)

**Current:**
```ts
import type { RouteParamsFromKey, RouteWithParams } from "questpie";
```

**New:**
```ts
import type { RouteParamsFromKey, RouteWithParams } from "questpie/types";
```

### 4. `packages/questpie/src/cli/codegen/index.ts` (scaffold templates)

Scaffolds for job, service, email, route, seed, migration currently import from `"questpie"`.
**Change to:** import from `"questpie/services"` for factories.

### 5. `packages/questpie/src/server/migration/generator.ts`

**Current:**
```ts
// generates: import { migration } from "questpie";
// generates: import type { OperationSnapshot } from "questpie";
```

**New:**
```ts
// generates: import { migration } from "questpie/services";
// generates: import type { OperationSnapshot } from "questpie/migration";
```

### 6. `packages/admin/src/server/plugin.ts` (admin codegen plugin)

Scaffold templates reference:
- `"@questpie/admin/server"` → split to `"@questpie/admin/factories"`
- `"@questpie/admin/client"` → stays (UI components)

Plugin `factoryImports` declarations:
```ts
factoryImports: [
  { name: "adminFields", from: "@questpie/admin/fields" },  // was /server
],
```

Scaffold templates:
```ts
// view scaffold
`import { view } from "@questpie/admin/factories";`  // was @questpie/admin/server

// component scaffold
`import { component } from "@questpie/admin/factories";`  // was @questpie/admin/server
```

### 7. `packages/admin/src/server/codegen/admin-client-template.ts`

**Major change:** Must handle array-style modules.ts instead of single pre-merged object.

**Current behavior:**
- Imports `modules.ts` as a single object
- Spreads `_modules.views`, `_modules.fields`, etc.

**New behavior:**
- Imports `modules.ts` as an array
- Generates merge: `..._modules[0].views, ..._modules[1].views, ...`
- OR generates a helper call: `mergeClientModules(_modules)`

```ts
// Generated output when modules.ts exports an array:
import _modules from "../modules";
import _view_custom from "../views/custom";

const admin = {
  views: { ..._modules[0].views, ..._modules[1].views, [_view_custom.name]: _view_custom },
  fields: { ..._modules[0].fields, ..._modules[1].fields },
  components: { ..._modules[0].components, ..._modules[1].components },
  pages: { ..._modules[0].pages, ..._modules[1].pages },
  widgets: { ..._modules[0].widgets, ..._modules[1].widgets },
  blocks: { ..._modules[0].blocks, ..._modules[1].blocks },
};

export default admin;
```

### 8. `packages/workflows/src/server/plugin.ts`

Scaffold templates import from `"@questpie/workflows"` — stays (root still has workflow factory).

### 9. `packages/mcp/src/server/plugin.ts`

Scaffold templates import from `"@questpie/mcp"` — stays (root still has mcpTool, mcpConfig).

### 10. `packages/create-questpie/src/scaffolder.ts`

Must update ALL generated import paths:
- `"questpie"` → mostly stays for `collection`, `global`
- `"@questpie/admin/server"` → `"@questpie/admin/modules/admin"` for module, `"@questpie/admin/factories"` for factories
- `"@questpie/admin/client-module"` → `"@questpie/admin/client/modules/admin"`
- `"@questpie/workflows/server"` → `"@questpie/workflows/modules/workflows"`
- `"@questpie/workflows/client"` → `"@questpie/workflows/client/modules/workflows"`

---

## App-Level Changes

### `apps/autopilot/src/questpie/server/modules.ts`

**Before:**
```ts
import { adminModule, auditModule } from "@questpie/admin/server";
import { workflowsModule } from "@questpie/workflows/server";
export default [adminModule, auditModule, workflowsModule] as const;
```

**After:**
```ts
import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { workflowsModule } from "@questpie/workflows/modules/workflows";
export default [adminModule, auditModule, workflowsModule] as const;
```

### `apps/autopilot/src/questpie/admin/modules.ts`

**Before (manual merge):**
```ts
import adminClientModule from "@questpie/admin/client-module";
import { workflowsClientModule } from "@questpie/workflows/client";
export default {
  ...adminClientModule,
  pages: { ...adminClientModule.pages, ...workflowsClientModule.pages },
  widgets: { ...adminClientModule.widgets, ...workflowsClientModule.widgets },
  views: { ...adminClientModule.views, ...workflowsClientModule.views },
  components: { ...adminClientModule.components, ...workflowsClientModule.components },
  fields: { ...adminClientModule.fields, ...workflowsClientModule.fields },
  blocks: { ...adminClientModule.blocks, ...workflowsClientModule.blocks },
};
```

**After (array, codegen merges):**
```ts
import { adminClientModule } from "@questpie/admin/client/modules/admin";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";
export default [adminClientModule, workflowsClientModule] as const;
```

### `apps/autopilot/src/questpie/server/.generated/factories.ts`

Will be regenerated by codegen — imports change from `"questpie"` to split paths.

### `apps/autopilot/src/questpie/admin/.generated/client.ts`

Will be regenerated by codegen — new merge logic for array modules.

---

## Plugin Changes

### `packages/workflows/questpie.config.ts`

**Before:**
```ts
import { adminPlugin } from "@questpie/admin/plugin";
```

**After:** stays ✅ (plugin path unchanged)

### `packages/admin/src/server/plugin.ts` — internal changes

The plugin declares `factoryImports` for codegen:
```ts
// BEFORE:
factoryImports: [{ name: "adminFields", from: "@questpie/admin/server" }]

// AFTER:
factoryImports: [{ name: "adminFields", from: "@questpie/admin/fields" }]
```

Scaffold template strings:
```ts
// BEFORE:
`import { view } from "@questpie/admin/server";`
`import { component } from "@questpie/admin/server";`

// AFTER:
`import { view } from "@questpie/admin/factories";`
`import { component } from "@questpie/admin/factories";`
```

---

## Cross-Package Consumer Migration

### `packages/admin/src/server/` (~40 files import from "questpie")

Most import `collection`, `global`, schema types. These stay importing from `"questpie"` root.

Files importing CodegenPlugin types:
```ts
// BEFORE: import type { CodegenPlugin, ... } from "questpie";
// AFTER:  import type { CodegenPlugin, ... } from "questpie/codegen";
```

Files importing `createApp` or app bootstrap:
```ts
// BEFORE: import { createApp } from "questpie";
// AFTER:  import { createApp } from "questpie/app";
```

### `packages/workflows/src/server/` (~20 files import from "questpie")

Same pattern — factories from root, types from `/types`, codegen from `/codegen`.

### `packages/admin/src/server/` imports from `"@questpie/admin/server"`

Internal cross-reference within admin package. These use `#questpie/admin/*` internal alias — NOT affected by public export changes.

### `packages/workflows/src/` imports from `"@questpie/admin/server"`

```ts
// BEFORE: import { adminConfig, view } from "@questpie/admin/server";
// AFTER:  import { adminConfig, view } from "@questpie/admin/factories";

// BEFORE: import type { DashboardContribution, SidebarContribution } from "@questpie/admin/server";
// AFTER:  import type { DashboardContribution, SidebarContribution } from "@questpie/admin/factories";
```

---

## tsdown.config.ts Changes

### All packages — entry pattern:

```ts
// BEFORE (questpie, admin):
entry: ["src/exports/*.ts", "src/exports/adapters/*.ts"],

// AFTER (questpie):
entry: [
  "src/exports/*.ts",
  "src/exports/adapters/*.ts",
  "src/exports/modules/*.ts",
],

// AFTER (admin):
entry: [
  "src/exports/*.ts",
  "src/exports/modules/*.ts",
  "src/exports/client/modules/*.ts",
],

// AFTER (workflows):
entry: [
  "src/exports/*.ts",
  "src/exports/modules/*.ts",
  "src/exports/client/modules/*.ts",
],
```

### Remove wildcard in customExports:

```ts
// Remove "./*": "./*" from all packages that have it
```

### Add sideEffects:

```json
// All packages get:
"sideEffects": false

// Admin package (with CSS):
"sideEffects": ["**/*.css"]
```

---

## File System Changes Summary

### New files to create:

```
packages/questpie/src/exports/
├── app.ts                    (NEW)
├── services.ts               (NEW)
├── queue.ts                  (NEW)
├── mailer.ts                 (NEW)
├── realtime.ts               (NEW)
├── search.ts                 (NEW)
├── storage.ts                (NEW)
├── kv.ts                     (NEW)
├── migration.ts              (NEW)
├── errors.ts                 (NEW)
├── auth.ts                   (NEW)
├── codegen.ts                (NEW)
├── types.ts                  (NEW)
├── builders.ts               (NEW)
├── introspection.ts          (NEW)
├── reactive.ts               (NEW)
├── modules/
│   └── starter.ts            (NEW)

packages/admin/src/exports/
├── modules/
│   ├── admin.ts              (NEW)
│   └── audit.ts              (NEW)
├── factories.ts              (NEW)
├── fields.ts                 (NEW)
├── client/
│   └── modules/
│       └── admin.ts          (NEW — replaces client-module.ts)

packages/workflows/src/exports/
├── modules/
│   └── workflows.ts          (NEW)
├── client/
│   └── modules/
│       └── workflows.ts      (NEW)
├── plugin.ts                  (NEW)

packages/mcp/src/exports/
├── modules/
│   └── mcp.ts                (NEW)
```

### Files to delete:

```
packages/admin/src/exports/client-module.ts   (moved to client/modules/admin.ts)
```

### Files to heavily rewrite:

```
packages/questpie/src/exports/index.ts         (from 270 lines → ~15 lines)
packages/admin/src/exports/index.ts            (from client re-export → server modules)
packages/admin/src/exports/server.ts           (DELETE or keep as deprecated re-export barrel)
packages/workflows/src/exports/server.ts       (remove export * from index, remove module)
packages/workflows/src/exports/client.ts       (remove module, keep page components)
packages/mcp/src/exports/index.ts              (remove module, keep factories)
```

---

## Migration Strategy

### Phase 1: Create new export files (non-breaking)
- Add all new `src/exports/` files
- Add new entries to tsdown config
- Keep old barrels intact (they still work)
- Run build, verify types

### Phase 2: Update codegen templates
- Update `template.ts`, `factory-template.ts`, `module-template.ts`
- Update `admin-client-template.ts` (array modules support)
- Update all scaffold templates in plugins
- Update `create-questpie` scaffolder
- Regenerate all `.generated/` files

### Phase 3: Migrate internal consumers
- Update `packages/workflows/src/` imports from `@questpie/admin/server`
- Update `packages/admin/src/` imports from `"questpie"` (split to specific paths)
- Update `packages/workflows/src/` imports from `"questpie"` (split to specific paths)

### Phase 4: Migrate app consumers
- Update `apps/autopilot/` imports
- Change `admin/modules.ts` to array pattern
- Regenerate codegen

### Phase 5: Remove old barrels
- Delete `@questpie/admin/server` barrel (or deprecate)
- Slim down `questpie` root barrel
- Remove `"./*"` wildcards
- Remove `@questpie/admin/client-module`
- Add `sideEffects: false`

### Phase 6: Verify
- Full TypeScript check
- Build all packages
- Run all tests
- Verify tree-shaking with bundle analyzer

---

## Backward Compatibility Notes

- `@questpie/admin/server` could remain as a deprecated re-export barrel for one version
- `@questpie/admin/client-module` can remain temporarily pointing to new location
- `questpie` root can keep exporting everything for one version (with console.warn at build time?)
- Clean break is preferred given this is pre-1.0

---

## End Result — User Experience

```ts
// ═══════════════════════════════════════════
// SERVER — app/modules.ts
// ═══════════════════════════════════════════
import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { workflowsModule } from "@questpie/workflows/modules/workflows";
import { mcpModule } from "@questpie/mcp/modules/mcp";
export default [adminModule, auditModule, workflowsModule, mcpModule] as const;

// ═══════════════════════════════════════════
// CLIENT — admin/modules.ts (array, codegen merges!)
// ═══════════════════════════════════════════
import { adminClientModule } from "@questpie/admin/client/modules/admin";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";
export default [adminClientModule, workflowsClientModule] as const;

// ═══════════════════════════════════════════
// COLLECTIONS — clean, minimal imports
// ═══════════════════════════════════════════
import { collection } from "questpie";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

export const posts = collection("posts")
  .fields(({ f }) => ({ title: f.text().required() }));

// ═══════════════════════════════════════════
// CONFIG — focused imports
// ═══════════════════════════════════════════
import { runtimeConfig } from "questpie/app";
import { resendMailer } from "questpie/adapters/resend";
import { bullmqQueue } from "questpie/adapters/bullmq";

// ═══════════════════════════════════════════
// ADMIN EXTENSIONS — from /factories, not /server barrel
// ═══════════════════════════════════════════
import { adminConfig, view } from "@questpie/admin/factories";
import type { DashboardContribution } from "@questpie/admin/factories";
```
