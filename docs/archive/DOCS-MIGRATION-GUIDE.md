# Documentation Migration Guide

> Instructions for AI agents updating the QUESTPIE documentation (`apps/docs/`) to reflect the file-convention codegen architecture.

---

## 1. What Changed — Old vs New

| Concept                | Old                                                        | New                                                                            |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| App composition        | `QuestpieBuilder` chain (`q().use().collection().build()`) | File convention + codegen (`questpie generate`)                                |
| Entity definition      | Inline in builder chain                                    | One file per entity (`collections/*.ts`, `globals/*.ts`, etc.)                 |
| Callback style         | Positional: `(f) =>`, `(f, a) =>`                          | Destructured object: `({ f }) =>`, `({ f, a }) =>`                             |
| RPC / functions        | `rpc()`, `r.fn()`, `r.router()`                            | `functions/` directory, `fn()` factory                                         |
| Modules                | Factory functions: `admin()`, `audit()`, `starter()`       | Static imports: `adminModule`, `auditModule`, `starterModule`                  |
| Module config          | Options passed to factory: `admin({ branding, sidebar })`  | Separate files: `branding.ts`, `sidebar.ts` discovered by plugin               |
| Config                 | `config({})` mixing entities + runtime                     | `runtimeConfig({})` for runtime + plugins only                                 |
| App access in handlers | `app` typed as `any`, `typedApp<App>(ctx.app)`             | `AppContext` — flat typed context (`{ db, collections, session, ... }`)        |
| Email templates        | `render` (React) + `subject` (sync)                        | `handler` returning `{ subject, html, text? }`                                 |
| Builder extensions     | Prototype mutation                                         | Proxy-based + `declare module` augmentation                                    |
| Imports                | `import { collection } from "questpie"`                    | `import { collection } from "#questpie"` (typed factories from generated code) |

---

## 2. Pattern Replacement Table

Use these mechanical replacements as a starting point. Each row shows the old pattern and its replacement.

### Entity definitions

| Old Pattern                                      | New Pattern                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `q().collection("name", (qb) => qb.fields(...))` | `collection("name").fields(...)` in `collections/name.ts`              |
| `qb.collection("name")`                          | `collection("name")`                                                   |
| `qb.global("name")`                              | `global("name")`                                                       |
| `qb.block("name")`                               | `block("name")`                                                        |
| `import { collection, global } from "questpie"`  | `import { collection, global } from "#questpie"` (for typed factories) |
| `import { block } from "@questpie/admin"`        | `import { block } from "#questpie"` (if admin plugin is active)        |

### Callback signatures

| Old Pattern                                      | New Pattern                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `.fields((f) => ({ ... }))`                      | `.fields(({ f }) => ({ ... }))`                      |
| `.fields((f, a) => ({ ... }))`                   | `.fields(({ f, a }) => ({ ... }))`                   |
| `.hooks({ beforeChange: [(data, app) => ...] })` | `.hooks({ beforeChange: [({ data, app }) => ...] })` |
| `.access({ read: (session) => ... })`            | `.access({ read: ({ session }) => ... })`            |
| `.admin((c) => ({ ... }))`                       | `.admin(({ c }) => ({ ... }))`                       |
| `.list((v, f) => ...)`                           | `.list(({ v, f }) => ...)`                           |
| `.form((v, f) => ...)`                           | `.form(({ v, f }) => ...)`                           |
| `.actions((a, c) => ...)`                        | `.actions(({ a, c }) => ...)`                        |
| `.title((f) => f.name)`                          | `.title(({ f }) => f.name)`                          |
| `.indexes((table) => [...])`                     | `.indexes(({ table }) => [...])`                     |

### RPC → Functions

| Old Pattern                                | New Pattern                                        |
| ------------------------------------------ | -------------------------------------------------- |
| `import { rpc } from "questpie"`           | Remove — no longer exists                          |
| `const r = rpc()`                          | Remove — use `functions/` directory                |
| `r.fn({ schema, handler })`                | `fn({ schema, handler })` in `functions/name.ts`   |
| `r.router({ a: fnA, b: fnB })`             | Nested folders: `functions/a.ts`, `functions/b.ts` |
| `handler: async (input) => ...`            | `handler: async ({ input, db, ... }) => ...`       |
| `createFetchHandler(app, { rpc: appRpc })` | `createFetchHandler(app)`                          |

### Modules

| Old Pattern                                      | New Pattern                                                  |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `import { starter } from "questpie"`             | `import { starterModule } from "questpie"`                   |
| `import { admin, audit } from "@questpie/admin"` | `import { adminModule, auditModule } from "@questpie/admin"` |
| `starter()`                                      | `starterModule` (static object)                              |
| `admin({ branding: {...}, sidebar: ... })`       | `adminModule` + separate `branding.ts`, `sidebar.ts` files   |
| `audit({ dashboard: true })`                     | `auditModule` + `dashboard.ts` file                          |
| `.use(starterModule).use(adminModule)`           | `modules.ts`: `export default [starterModule, adminModule]`  |

### Config

| Old Pattern                    | New Pattern                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `config({ db, modules, ... })` | `runtimeConfig({ db, adapters, ... })` in `questpie.config.ts` |
| `q().use(module).build()`      | Codegen reads `modules.ts` + file convention                   |

### App access

| Old Pattern                   | New Pattern                                               |
| ----------------------------- | --------------------------------------------------------- |
| `typedApp<App>(ctx.app)`      | Just use `app` from context — already typed               |
| `const app: any`              | `{ app }` destructured from handler context               |
| `import { App } from "./app"` | `import type { AppConfig } from "#questpie"` (for client) |

### Email templates

| Old Pattern                                   | New Pattern                                          |
| --------------------------------------------- | ---------------------------------------------------- |
| `render: (props) => <Component {...props} />` | `handler: ({ input }) => ({ subject, html, text? })` |
| `subject: (ctx) => \`...\``                   | Include `subject` in handler return                  |
| `sendTemplate({ context: data })`             | `sendTemplate({ input: data })`                      |
| `InferEmailTemplateContext<T>`                | `InferEmailTemplateInput<T>`                         |

### Jobs

| Old Pattern                        | New Pattern                                        |
| ---------------------------------- | -------------------------------------------------- |
| `q.job({ name, schema, handler })` | `job({ name, schema, handler })` in `jobs/name.ts` |
| `handler: async (payload) => ...`  | `handler: async ({ payload, db, ... }) => ...`     |

---

## 3. Docs Needing Updates — By Priority

### HIGH — Core concepts that are fundamentally different

| File                                   | What needs changing                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/collections.mdx`               | All examples use `qb.collection()` with `(f) =>`. Rewrite to `collection()` from `#questpie` with `({ f }) =>`. Show file convention structure. |
| `server/globals.mdx`                   | Same as collections — `qb.global()` → `global()` with destructured callbacks.                                                                   |
| `server/field-types.mdx`               | All field examples use `(f) =>`. Change to `({ f }) =>`.                                                                                        |
| `server/field-builder.mdx`             | Same — positional callbacks throughout.                                                                                                         |
| `server/hooks-and-lifecycle.mdx`       | Hook examples use old callback signatures. Update to `({ data, app, operation }) =>`.                                                           |
| `server/rpc.mdx`                       | **Entire page needs rewrite or rename.** RPC is gone — rename to "Functions", rewrite all examples using `functions/` directory and `fn()`.     |
| `server/modules-and-extensions.mdx`    | Module factory pattern is gone. Rewrite to explain static modules + file convention + codegen.                                                  |
| `server/type-safe-contexts.mdx`        | `typedApp<App>` is gone. Rewrite to explain `AppContext` augmentation.                                                                          |
| `server/relations.mdx`                 | Relation examples use old callback style. Update `(f) =>` → `({ f }) =>`.                                                                       |
| `server/access-control.mdx`            | Access examples use old signatures. Update to `({ session }) =>`.                                                                               |
| `reference/q-builder-api.mdx`          | **Delete or redirect.** `QuestpieBuilder` no longer exists.                                                                                     |
| `reference/rpc-api.mdx`                | **Delete or redirect.** RPC API no longer exists.                                                                                               |
| `reference/collection-builder-api.mdx` | Update callback signatures throughout.                                                                                                          |
| `reference/global-builder-api.mdx`     | Update callback signatures throughout.                                                                                                          |
| `reference/hooks-api.mdx`              | Update hook context signatures.                                                                                                                 |
| `getting-started/`                     | Quickstart guides likely use old builder pattern. Full rewrite needed.                                                                          |
| `guides/build-a-booking-system.mdx`    | Full guide using old patterns. Rewrite with file convention.                                                                                    |

### MEDIUM — Partially affected or less central

| File                                         | What needs changing                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/validation.mdx`                      | May reference old callback styles.                                           |
| `server/localization.mdx`                    | May use old config pattern. Update to `locale.ts` file convention.           |
| `server/versioning.mdx`                      | Hook examples may use old signatures.                                        |
| `server/soft-delete.mdx`                     | Hook examples may use old signatures.                                        |
| `server/reactive-fields.mdx`                 | May use old callback style.                                                  |
| `infrastructure/email.mdx`                   | **Already partially updated.** Verify handler-based API is fully documented. |
| `infrastructure/queue-and-jobs.mdx`          | Job examples may use old `q.job()` pattern.                                  |
| `infrastructure/authentication.mdx`          | Auth config location changed — now `auth.ts` file.                           |
| `infrastructure/database-and-migrations.mdx` | May reference old config shape.                                              |
| `guides/build-a-page-builder.mdx`            | Block examples may use old `qb.block()`.                                     |
| `guides/custom-field-type.mdx`               | Extension mechanism changed (proxy-based).                                   |
| `guides/builder-extension-packages.mdx`      | Extension mechanism fundamentally different.                                 |
| `reference/cli.mdx`                          | Add `questpie generate` and `questpie dev` commands.                         |
| `reference/field-api.mdx`                    | Callback signatures in field definitions.                                    |
| `reference/adapter-api.mdx`                  | `createFetchHandler` `rpc` option removed.                                   |
| `reference/infrastructure-api.mdx`           | May reference old config patterns.                                           |
| `reference/registry-api.mdx`                 | Registry concept expanded — update with codegen-generated Registry.          |

### LOW — Minimal or no changes needed

| File                            | Notes                                  |
| ------------------------------- | -------------------------------------- |
| `infrastructure/storage.mdx`    | Storage API unchanged.                 |
| `infrastructure/kv-store.mdx`   | KV API unchanged.                      |
| `infrastructure/logger.mdx`     | Logger API unchanged.                  |
| `infrastructure/realtime.mdx`   | Realtime API unchanged.                |
| `infrastructure/search.mdx`     | Search API unchanged.                  |
| `reference/crud-api.mdx`        | CRUD API unchanged.                    |
| `reference/query-operators.mdx` | Query operators unchanged.             |
| `reference/error-codes.mdx`     | Error codes unchanged.                 |
| `admin/` directory              | Admin UI docs unchanged (client-side). |
| `client/` directory             | Client SDK unchanged.                  |
| `reference/qa-builder-api.mdx`  | Admin builder (`qa`) unchanged.        |

---

## 4. What's Already Updated

These files have already been touched in this branch:

- `apps/docs/content/docs/guides/build-a-booking-system.mdx` — minor fix
- `apps/docs/content/docs/infrastructure/email.mdx` — handler-based API documented
- `apps/docs/content/docs/infrastructure/queue-and-jobs.mdx` — minor fix
- `apps/docs/content/docs/reference/infrastructure-api.mdx` — minor fix
- `apps/docs/content/docs/reference/q-builder-api.mdx` — minor fix
- `apps/docs/content/docs/server/type-safe-contexts.mdx` — minor fix
- `apps/docs/src/components/landing/workflow-steps.ts` — landing page code snippet updated to `runtimeConfig()`
- `apps/docs/src/routeTree.gen.ts` — auto-generated route tree

Most of these were minor/partial fixes. The substantive content updates are still needed.

---

## 5. How to Approach Each Doc

### Mechanical replacements (do first)

For every `.mdx` file in the HIGH and MEDIUM lists:

1. **Grep for stale patterns** — run these searches across `apps/docs/`:

   ```
   grep -rn "qb\." apps/docs/content/
   grep -rn "(f) =>" apps/docs/content/
   grep -rn "(f," apps/docs/content/
   grep -rn "r\.fn\|r\.router\|rpc()" apps/docs/content/
   grep -rn "typedApp" apps/docs/content/
   grep -rn "\.use(" apps/docs/content/
   grep -rn "q()" apps/docs/content/
   grep -rn "starter()\|admin()\|audit()" apps/docs/content/
   grep -rn "config({" apps/docs/content/
   ```

2. **Apply pattern replacements** from the table in Section 2.

3. **Verify each code block compiles mentally** — ensure imports are correct (`#questpie` vs `questpie`).

### Conceptual rewrites (do second)

These pages need more than find-and-replace:

1. **`server/rpc.mdx`** — Rename to `server/functions.mdx`, rewrite entirely:
   - Explain `functions/` directory convention
   - Show `fn()` factory with schema + handler
   - Show nested routes via folder structure
   - Show how functions are called from client (`client.functions.search()`)
   - Show access control on functions

2. **`server/modules-and-extensions.mdx`** — Rewrite to cover:
   - What a module is (static object with collections, functions, jobs, etc.)
   - How modules are registered (`modules.ts`)
   - How codegen generates module definitions for npm packages
   - How to create a custom module
   - Plugin system (`CodegenPlugin`, `adminPlugin()`, `openapiPlugin()`)

3. **`server/type-safe-contexts.mdx`** — Rewrite to cover:
   - `AppContext` interface and how codegen augments it
   - Every handler gets flat typed context
   - `defineService()` and custom services
   - No more `typedApp<>()` or type assertions

4. **`reference/q-builder-api.mdx`** — Either delete entirely or convert to a "Config API" reference covering `runtimeConfig()` and `questpie.config.ts`.

5. **`reference/rpc-api.mdx`** — Either delete entirely or convert to a "Functions API" reference covering `fn()`, `FunctionDefinition`, and `functions/` directory.

6. **`getting-started/`** — The quickstart must show:
   - File structure with `questpie.config.ts`, `collections/`, `modules.ts`
   - Running `questpie generate`
   - Importing from `#questpie`

### New pages to consider adding

- **File Convention** — reference page explaining all file patterns, discovery rules, by-type vs by-feature layout
- **Codegen** — how `questpie generate` works, what `.generated/` contains, watch mode
- **Services** — `defineService()`, custom services on context

---

## 6. Key Examples to Reference

When updating docs, reference these fully migrated examples for correct patterns:

### Barbershop example (`examples/tanstack-barbershop/src/questpie/server/`)

```
questpie.config.ts              # runtimeConfig() with plugins
modules.ts                      # [starterModule, adminModule, auditModule]
branding.ts                     # { name: "Barbershop" }
sidebar.ts                      # ({ s, c }) => [...]
dashboard.ts                    # ({ d, c, a }) => ({ metadata: {...}, sections: [...] })
locale.ts                       # content locale config
admin-locale.ts                 # admin UI locale config
auth.ts                         # auth configuration (if present)
collections/barbers.ts          # collection("barbers").fields(({ f }) => ...)
collections/services.ts         # collection("services").fields(({ f }) => ...)
collections/appointments.ts     # with hooks, access, workflow
globals/site-settings.ts        # global("site-settings").fields(({ f }) => ...)
functions/create-booking.ts     # fn({ schema, handler })
functions/get-active-barbers.ts # fn({ schema, handler })
jobs/send-appointment-confirmation.ts  # job({ name, schema, handler })
blocks/services.ts              # block("services").fields(({ f }) => ...)
emails/appointment-confirmation.ts     # email({ name, schema, handler })
services/                       # defineService() examples (if present)
.generated/index.ts             # auto-generated app entrypoint
.generated/factories.ts         # auto-generated typed factories
```

### City Portal example (`examples/city-portal/src/questpie/server/`)

Similar structure — good for showing a different project using the same conventions.

### Create-questpie template (`packages/create-questpie/templates/tanstack-start/src/questpie/server/`)

The starter template — shows the minimal file convention setup.

---

## 7. Verification

After updating docs, verify correctness:

1. **Grep for remaining stale patterns:**

   ```bash
   # These should return zero results in docs content:
   grep -rn "QuestpieBuilder" apps/docs/content/
   grep -rn "qb\.\(collection\|global\|block\)" apps/docs/content/
   grep -rn "r\.fn\|r\.router" apps/docs/content/
   grep -rn "rpc()" apps/docs/content/
   grep -rn "typedApp" apps/docs/content/
   grep -rn "starter()\b" apps/docs/content/    # starter() function call, not starterModule
   grep -rn "admin()\b" apps/docs/content/      # admin() function call, not adminModule
   grep -rn "\.use(starter\|\.use(admin\|\.use(audit" apps/docs/content/
   ```

2. **Check callback style** — `(f) =>` in code blocks should be `({ f }) =>`:

   ```bash
   # Look for positional callbacks in code blocks:
   grep -n "\.fields((f)" apps/docs/content/
   grep -n "\.fields((f," apps/docs/content/
   ```

3. **Build the docs site:**

   ```bash
   cd apps/docs && bun run build
   ```

   Fix any broken links or build errors.

4. **Spot-check code examples** — ensure imports use `#questpie` for `collection`/`global`/`block` and `"questpie"` for framework utilities like `fn`, `job`, `email`, `defineService`.

5. **Check meta.json files** — if pages were renamed (e.g., `rpc.mdx` → `functions.mdx`), update the corresponding `meta.json` navigation entries.
