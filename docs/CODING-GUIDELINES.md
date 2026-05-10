# Coding Guidelines

Conventions and patterns for the QuestPie CMS monorepo. Applies to both human contributors and AI agents.

---

## Package Exports

### Principles

1. **Server-first** — Root/default export path = server API. Client code lives under `/client/*`.
2. **Focused files** — Each export file covers one concern, max ~15 exports. No mega barrels.
3. **Named exports only** — No default exports from package entry points.
4. **No `export *`** — Always re-export named symbols explicitly (tree-shaking).
5. **No wildcards** — Never use `"./*"` in package.json exports. Only explicit paths.
6. **`sideEffects: false`** — Declared in every package.json (except CSS: `["**/*.css"]`).

### Directory Structure

```
packages/<name>/
├── src/
│   └── exports/              ← PUBLIC API (each file = one export path)
│       ├── index.ts          ← Root "." export (core concern only)
│       ├── <concern>.ts      ← e.g. factories.ts, auth.ts, types.ts
│       ├── modules/
│       │   └── <name>.ts     ← Server module: "@pkg/modules/<name>"
│       ├── client/
│       │   └── modules/
│       │       └── <name>.ts ← Client module: "@pkg/client/modules/<name>"
│       └── adapters/         ← (questpie core only)
│           └── <name>.ts     ← "@pkg/adapters/<name>"
└── tsdown.config.ts
```

### Naming Convention

| Concept | Export path | Example |
|---------|------------|---------|
| Core API (server) | `.` (root) | `import { collection } from "questpie"` |
| Server module | `./modules/<name>` | `import { adminModule } from "@questpie/admin/modules/admin"` |
| Client module | `./client/modules/<name>` | `import { adminClientModule } from "@questpie/admin/client/modules/admin"` |
| Factories | `./factories` | `import { view, block } from "@questpie/admin/factories"` |
| Adapters | `./adapters/<name>` | `import { resendMailer } from "questpie/adapters/resend"` |
| Client UI | `./client` | `import { AdminLayout } from "@questpie/admin/client"` |
| Types only | `./types` | `import type { AppContext } from "questpie/types"` |
| Plugin | `./plugin` | `import { adminPlugin } from "@questpie/admin/plugin"` |
| Shared (universal) | `./shared` | `import { resolveI18nText } from "questpie/shared"` |

### Rules

**DO:**
```ts
// Focused, named re-exports
export { adminModule } from "../../server/modules/admin/index.js";
export type { AdminModule } from "../../server/modules/admin/index.js";
```

**DON'T:**
```ts
// Mega barrel with export *
export * from "../server/modules/admin/index.js";
export * from "../server/modules/audit/index.js";
export * from "../server/block/index.js";
export * from "../server/fields/index.js";
// ... 50 more lines
```

### tsdown Config Pattern

```ts
// tsdown.config.ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/exports/*.ts",
    "src/exports/modules/*.ts",
    "src/exports/client/modules/*.ts",  // if package has client modules
    "src/exports/adapters/*.ts",         // if package has adapters
  ],
  format: ["esm"],
  unbundle: true,
  exports: { all: true, devExports: true },
});
```

Filename becomes export key: `src/exports/factories.ts` → `"./factories"` in package.json.

### When to Create a New Export File

- New concern that doesn't fit existing files (e.g. new adapter, new module)
- Group of related symbols used together (> 3 symbols that always co-import)
- Runtime boundary (server-only vs client-only vs universal)

### When NOT to Create a New Export File

- Single type that belongs to an existing concern
- Internal utility used only within the package
- Something only consumed by codegen (use internal `#alias` paths)

---

## Module System

### Server Modules

Each module is a self-contained unit with file-convention discovery:

```
packages/<pkg>/src/server/modules/<name>/
├── .generated/
│   └── module.ts         ← AUTO-GENERATED (questpie generate --module)
├── collections/          ← Named exports, one per file
├── routes/
├── views/
├── components/
├── config/
│   └── admin.ts          ← adminConfig({...})
├── modules.ts            ← Sub-module dependencies array
└── index.ts              ← Public API + attach plugin
```

**Export from package:**
```ts
// src/exports/modules/admin.ts
export { adminModule } from "../../server/modules/admin/index.js";
export type { AdminModule, AdminCollections } from "../../server/modules/admin/index.js";
```

**Use in app:**
```ts
// app/server/modules.ts
import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { workflowsModule } from "@questpie/workflows/modules/workflows";

export default [adminModule, auditModule, workflowsModule] as const;
```

### Client Modules

Client modules define admin UI contributions (fields, views, pages, widgets, blocks, components):

```
packages/<pkg>/src/server/modules/<name>/client/
├── .generated/
│   └── module.ts         ← AUTO-GENERATED (questpie generate --module)
├── fields/               ← Field components
├── views/                ← View components
├── pages/                ← Page components
├── widgets/              ← Widget components
├── components/           ← Generic components
└── index.ts              ← Re-exports .generated/module.ts
```

**Export from package:**
```ts
// src/exports/client/modules/admin.ts
export { default as adminClientModule } from "../../../server/modules/admin/client/index.js";
export type { AdminModule as AdminClientModule } from "../../../server/modules/admin/client/.generated/module.js";
```

**Use in app (array pattern, codegen merges):**
```ts
// app/admin/modules.ts
import { adminClientModule } from "@questpie/admin/client/modules/admin";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";

export default [adminClientModule, workflowsClientModule] as const;
```

Codegen automatically generates the merge logic — no manual spreading.

---

## Import Conventions

### Internal (within a package)

Always use the package's internal alias:
```ts
// Inside packages/questpie/src/
import { something } from "#questpie/server/some/module.js";

// Inside packages/admin/src/
import { something } from "#questpie/admin/server/some/module.js";
```

Never import from the package's own public exports:
```ts
// BAD — circular, breaks build
import { collection } from "questpie";  // inside questpie package!

// GOOD
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
```

### External (cross-package)

Always import from public export paths:
```ts
// GOOD — uses public API
import { adminModule } from "@questpie/admin/modules/admin";
import { view, block } from "@questpie/admin/factories";
import type { AppContext } from "questpie/types";

// BAD — never import from internal src/ paths
// import { something } from "@questpie/pkg/src/internal/deep/path";
```

### Import Organization

Order imports by distance:
```ts
// 1. Node/runtime builtins
import { readFile } from "node:fs/promises";

// 2. External packages
import { eq, sql } from "drizzle-orm";

// 3. Monorepo packages (public exports)
import { collection } from "questpie";
import { adminConfig } from "@questpie/admin/factories";

// 4. Internal alias imports
import { something } from "#questpie/server/internal.js";

// 5. Relative imports
import { helper } from "./utils.js";
```

---

## Collections

### File Convention

One collection per file in `collections/` directory. Named export matching the collection slug:

```ts
// collections/projects.ts
import { collection } from "questpie";

export const projects = collection("projects")
  .fields(({ f }) => ({
    name: f.text().required().label({ en: "Name" }),
    slug: f.text().required(),
  }))
  .title(({ f }) => f.name)
  .admin(({ c }) => ({
    label: { en: "Projects" },
    icon: c.icon("ph:folder-notch"),
  }))
  .list(({ v }) => v.collectionTable({}))
  .form(({ v, f }) => v.collectionForm({
    fields: [f.name, f.slug],
  }));
```

### Rules

- **Named export** (not default): `export const projects = collection("projects")`
- **One collection per file**: filename should match slug (`projects.ts` → `"projects"`)
- **Chain methods** in order: `.fields()` → `.title()` → `.admin()` → `.list()` → `.form()` → `.actions()` → `.indexes()`

---

## Generated Code

### Never Edit `.generated/` Files

All files in `.generated/` directories are auto-generated by `questpie generate`. They are:
- Regenerated on every codegen run
- Committed to git (source of truth for types)
- Never manually edited

### Exposing Generated Code

To make generated code importable, create a barrel in `src/exports/`:
```ts
// src/exports/client-module.ts
export { default as adminClientModule } from "../server/modules/admin/client/index.js";
```

---

## Build & Tooling

- **TypeScript check**: `bunx tsc --noEmit --project packages/<name>/tsconfig.json`
- **Linting**: oxlint (`.oxlintrc.json`)
- **Formatting**: oxfmt (`.oxfmtrc.json`)
- **Package manager**: bun (use `bunx` not `npx`)
- **Build**: tsdown (config per package)
- **Codegen**: `questpie generate` (regenerates .generated/ files)

---

## General Rules

- **No `export * from` barrels** inside packages — only in `src/exports/` directories for public API
- **No default exports** from package entry points — always named
- **No co-authored-by** in git commits
- **Fix everything** found during testing — never dismiss as "pre-existing"
- **Server-first** — default assumption is server code unless explicitly under `/client`
- **Declarative over imperative** — configuration as data, not conditional code
