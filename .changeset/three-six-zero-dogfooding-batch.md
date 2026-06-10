---
"questpie": minor
"@questpie/tanstack-query": minor
"@questpie/admin": patch
"create-questpie": patch
---

The 3.6.0 dogfooding batch — fixes and primitives surfaced by building a real app (jubli) on the framework.

**Correctness**

- `/health` no longer reports `search: degraded` forever — `SearchService.isInitialized()` exists now.
- Multi-field `orderBy` applies every field (drizzle's `.orderBy()` replaces, so clauses are collected into one call); keyset pagination with tiebreaks is correct.
- System timestamps use millisecond precision (`timestamp(3)`) — a `Date` you read equals the value stored; ms-boundary keyset cursors no longer skip rows.
- Conditional updates are atomic: `update()`/`updateMany()` lock candidate rows and re-check the `where` inside the transaction, returning the winners array — parallel claims can no longer both succeed. `updateMany` is the canonical bulk name and unknown CRUD methods fail loud with suggestions instead of `undefined is not a function`.
- `questpie push` works on the default bun-sql driver — driver results are normalized at one seam.
- Server-side validation enforces field-level zod schemas (`.zod()` transforms, email format, select enums, array shapes) on create/update — previously they only drove admin forms and OpenAPI.

**Access control**

- Deny-all means deny-all: the `visibility: "public"` upload read short-circuit is gone. New `serve` access kind separates listing rows from fetching bytes by key (signed-token check for private files still always applies), and the new `introspect` kind gates `/{schema,meta}` through the normal access system.
- Access rules are typed per operation: `create` rules get a typed `input`, `update`/`delete`/`transition` rules get a non-optional typed `data` (and `update` a typed patch `input`).

**Composition**

- `.fields()` on collections and globals is cumulative — it adds and overrides by key, never wipes builder state, so `collection("user").merge(starterModule.collections.user).fields(...)` keeps the whole starter model. `.merge()` preserves unresolved relation fields from both sides.
- Typed field escape hatches: `.zod()` propagates the returned schema's output into the field's value type, `.$type<T>()` sets it explicitly with zero runtime effect, and `.drizzle()` remains the raw column hatch (constraints/defaults land in DDL) with `$type` propagation.

**New primitives**

- **Request context**: the `appConfig({ context })` resolver result travels with the request — typed and available in access rules, hooks, route handlers, field access, search, and `getContext()`.
- **Env**: `env.ts` convention validates at boot (before adapters/auth/db init) with aggregate errors and framework base vars; `env.client.ts` + codegen emit per-bundler client env modules with literal `process.env.PREFIX_*` references — server keys are physically absent from client artifacts.
- **Realtime client contract**: typed `live()`/`liveIter()` mirror `find()` typing on the client; `{ realtime: true }` is part of the public @questpie/tanstack-query types; the wire payload is a documented, stable contract.
- **Infer-first types**: codegen auto-populates names-only key registries — `f.relation("…")` autocompletes collection keys (plain strings keep compiling). The generated index exports `AccessRuleContext<K>`, `HookRuleContext<K>`, `CollectionDoc<K>`, `GlobalDoc<K>`, `AppSession`, `AppSessionUser`, and `ctx.app` is fully typed on every handler context. `InferRouteInput/Output/Params` exported for tRPC-style standalone inference.

**Codegen + teaching**

- Codegen templates fixed: builder augmentations merge cleanly (identical type parameter lists), job handler `collections` typing no longer collapses in module graphs, and `.test.`/`.spec.`/`__tests__` files are never discovered as conventions.
- Docs and the shipped skill teach all of the above — including the type-inference map (`references/type-inference.md`), Better Auth callback context facts, and ~20 previously undocumented primitives — with a repeatable skill-coverage gate (`scripts/skill-coverage.ts`).
- All teaching examples use `relation("user")` (the starter key); the Better Auth anonymous-plugin recipe is documented.
