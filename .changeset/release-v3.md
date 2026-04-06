---
"questpie": major
"@questpie/admin": major
"@questpie/elysia": major
"@questpie/hono": major
"@questpie/next": major
"@questpie/openapi": major
"@questpie/tanstack-query": major
"create-questpie": major
---

# QuestPie v3

Full v3 architecture redesign — module system, core module extraction, service definitions, route conventions, and type-safe field methods.

## Breaking Changes

- **`QuestpieBuilder` removed** — `q()`, `.use()`, `.build()` chain replaced by file convention + `questpie generate`
- **RPC module removed** — replaced by `routes/*.ts` directory with `route()` builder
- **`app.api.*` removed** — use `app.collections` / `app.globals` direct getters
- **Positional callbacks → destructured** — `.fields((f) => ...)` → `.fields(({ f }) => ...)`
- **`contextResolver` removed** — session/locale are scoped CRUD context params
- **`RegisteredApp` type removed** — use `typedApp<App>(ctx.app)` instead
- **`fetchFn` → `loader`** on all dashboard widget types
- **Secure-by-default access** — authenticated session required when no access rules defined
- **Audit module opt-in** — `auditModule` must be explicitly added via `.use(auditModule)`

## New Features

- **Module system** — core infrastructure (search, realtime, auth, queue) wired as formal service definitions
- **`fieldType()` + `FieldWithMethods`** — type-safe field chain methods (`.manyToMany()`, `.trim()`, `.autoNow()`, etc.)
- **Hook type safety** — fully typed `ctx.data` in collection hooks, no more `{ [x: string]: any }` fallback
- **Route system** — file-path conventions, method chaining (`.get().post()`), priority matcher
- **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
- **Version history** — full versions/revert parity across stack with admin UI
- **Server actions** — real form field mapping, RPC execution, effects handling
- **Admin field meta augmentation** — all field types properly augmented with admin meta
