---
"questpie": major
"@questpie/admin": major
"create-questpie": major
"@questpie/openapi": patch
---

# File-Convention Architecture with Plugin-Driven Codegen

Replace the manual `QuestpieBuilder` chain with automatic file-convention + codegen. Each entity lives in its own file, `questpie generate` produces typed entrypoints, and codegen is fully plugin-driven — no hardcoded categories, extensions, or type registries in the CLI.

## Breaking Changes

- **`QuestpieBuilder` removed** — `q()`, `.use()`, `.build()` chain replaced by file convention + `questpie generate`
- **RPC module removed** — `rpc()`, `r.fn()`, `r.router()` replaced by `routes/*.ts` directory with `route()` builder
- **Positional callbacks → destructured** — `.fields((f) => ...)` → `.fields(({ f }) => ...)`
- **`createFetchHandler`** — `rpc` option removed, functions auto-discovered
- **Module factories removed** — `admin()`, `starter()` → static `adminModule`, `starterModule` imports in `modules.ts`
- **Email templates** — `render`/`subject` replaced with `handler` receiving full `AppContext`

## File Convention

```
src/questpie/server/
├── questpie.config.ts        # Runtime config (db, plugins)
├── modules.ts                # Module imports
├── collections/*.ts          # One per file
├── globals/*.ts
├── routes/*.ts
├── jobs/*.ts
├── blocks/*.ts               # Admin plugin
├── routes/*.ts
├── services/*.ts
├── messages/*.ts
├── auth.ts / locale.ts
├── sidebar.ts / dashboard.ts / branding.ts  # Admin plugin
└── .generated/
    ├── index.ts              # App entrypoint
    └── factories.ts          # Typed builders with extensions
```

## Plugin-Driven Codegen

All entity categories, builder extensions, callback proxies, and type registries are declared by `CodegenPlugin` instances — the CLI has zero hardcoded knowledge of admin views, components, or blocks.

- **Core plugin** — declares collections, globals, jobs, routes, messages, services, emails, migrations, seeds + singleton factories (locale, hooks, access, context) + `f` callback param
- **Admin plugin** — declares views, components, blocks, sidebar, dashboard, branding, adminLocale + collection/global extensions (`.admin()`, `.list()`, `.form()`, `.preview()`, `.actions()`) + `v`, `c`, `a` callback params
- **`ModuleRegistryConfig`** — `placeholder` for string union keys, `recordPlaceholder` for full typed records, optional `typeRegistry` for `declare module` augmentations

## Typed View Configs

`ViewDefinition<TName, TKind, TConfig>` carries a phantom `~config` type. Per-view config flows through codegen into `_ListViewsRecord` / `_EditViewsRecord` type aliases, so `.list(({ v }) => v.table({ columns: [...] }))` type-checks `columns` against `ListViewConfig` specifically.

## Typed Component Props

`ComponentDefinition<TName, TProps>` carries a phantom `~props` type. Per-component props flow through codegen into `_ComponentsRecord`, so `c.icon("ph:users")` accepts `string` while `c.badge({ text: "New" })` requires `{ text: string; color?: string }`.

## What Didn't Change

CollectionBuilder/GlobalBuilder field system, auth, migrations, HTTP adapters, admin UI client code, and CRUD API are all unchanged.
