# @questpie/tanstack-query

## 3.28.6

## 3.28.5

## 3.28.4

## 3.28.3

## 3.28.2

## 3.28.1

## 3.28.0

## 3.27.1

## 3.27.0

## 3.26.2

## 3.26.1

## 3.26.0

## 3.25.3

## 3.25.2

## 3.25.1

## 3.25.0

## 3.24.0

## 3.23.0

## 3.22.0

## 3.21.1

## 3.21.0

## 3.20.1

## 3.20.0

## 3.19.2

## 3.19.1

## 3.19.0

### Minor Changes

- [#204](https://github.com/questpie/questpie/pull/204) [`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Concurrency control, transactional integrity, channel authority, secret queue
  payloads, observability, and a productionalization pass over the framework.

  **Released as a minor despite the removals below.** There are no published
  consumers yet, so removals are folded in rather than held for a major. They are
  still listed in full — a changelog that hides a removal to keep a version number
  tidy is worse than the version number being surprising.

  ## Canonical revisions and optimistic concurrency

  Framework-owned canonical revisions reach collection and Global CRUD, clients,
  REST/OpenAPI, TanStack Query and Admin mutation flows. `revision` is distinct
  from version-history sequencing and from CRDT clocks; history snapshots record
  `sourceRevision`; stale and incomplete bulk preconditions fail atomically before
  any durable effect; owner-derived history access closes cross-tenant reads.

  Optimistic delete hooks run inside the revision-checked transaction and
  revalidate the locked row before committing. Collections without optimistic
  concurrency keep their established pre-claim delete-hook ordering, including
  TOCTOU-aware hooks, without self-deadlocking on the framework row lock.

  ## Transaction-bound hooks fail atomically

  Errors from `afterChange`, `afterDelete` and purge hooks now propagate and roll
  back the owning mutation together with nested CRUD, Queue, Channels and realtime
  ledger work. Previously they were caught, logged and swallowed, so a failed hook
  left a committed write behind.

  ## Channel authority revocation

  Durable, provider-neutral revocation of channel authority, with exact SSE
  fencing and signed-user Pusher reconnect reauthorization.

  ## Secret queue dispatches

  Short-lived secret payloads can be dispatched transactionally. Payloads are
  envelope-encrypted before durable storage or broker publication, wrapped data
  keys are erased after durable completion or an unclaimed broker-terminal
  outcome, and applications can read a payload-free queued/completed/failed
  receipt by stable dispatch id.

  pg-boss is qualified through durable broker-state reconciliation. Secret
  publication **fails closed** on BullMQ, Cloudflare Queues and unqualified custom
  adapters. Deploy the additive Queue ledger migration before enabling secret
  dispatches; existing rows remain ordinary non-secret dispatches.

  ## Observability

  Tracing and metrics through a framework seam plus the new
  `@questpie/observability` package: database query and transaction spans on every
  `db` variant, metrics and logs signals, and inbound trace-context continuation.

  ## Admin

  Per-field component slots — `.admin({ components: { field, cell } })` lets one
  field instance point at its own components without registering a whole new field
  type. The value is a registry key, not a component, because `.admin()` is
  serialized from the server through field introspection; an unrecognised key
  falls back to the by-type component rather than rendering nothing.

  ## Removed

  - `createAdapterRoutes` and the legacy route closure factories — routes are
    defined with `route()`; the framework no longer ships two ways to mount a
    handler.
  - `client.crdt` — use `createCrdtClient(client)` from `questpie/crdt`.
  - `AdminTypeRegistry` and the four `Registered*` types. The interface was never
    exported, so no application could reach it to augment; every derived type
    resolved to a constant and every consumer conditional was a dead branch. Two
    READMEs documented the augmentation and promised inference it could not
    deliver.
  - The last `@deprecated` API in `questpie` and `@questpie/admin`. Internal
    imports of the framework's own deprecated API are now **zero**, down from 166.

  ## Fixed

  - **Builders lost the app field map on every derivation.** `_fieldDefs` was
    assigned once in `create()` and carried by none of the nineteen derivation
    sites, so `collection("posts").admin({…}).fields(({ f }) => f.richText())`
    fell back to the builtins and threw, while the type still advertised
    `richText`. Both builders now derive through one helper that carries all
    private state.
  - **`.validation()` silently narrowed what a collection accepted.** It built its
    own schema without the id, timestamp and soft-delete columns the constructor
    adds; because both paths end in a stripping Zod object the loss threw nothing.
    Calling it removed the ability to pass a custom id on create and made
    restore's `deletedAt` write a no-op.
  - **Collection access rules now fail closed** on a rule shape the type system
    does not admit. Both evaluators previously ended in an unconditional allow —
    one of them on the enforcement path.
  - A global access rule returning a non-boolean now denies.
  - `f.upload().multiple()` returned a field with no state, losing its type,
    metadata and target collection.
  - `crdt`, `observability` and `executor` config leaked into `app.state`.
  - Observability never flushed on shutdown; the last batch of spans, metrics and
    logs was lost on every clean exit. It was also silently dropped from the
    runtime config entirely.
  - `questpie dev` stripped module-contributed codegen on every save, and
    `questpie generate` silently repaired it.
  - The `locale` and `localeFallback` options were declared and then ignored.
  - Globals had no field-schema overlay, so `f.email()` published as a bare string
    while the identical field on a collection published the format.
  - Custom dashboard widgets rendered "component not found"; the workflows sidebar
    and its widgets were missing.
  - `{{ param }}` with spaces now interpolates in server messages.
  - `generateModule` is now actually exported from `questpie/codegen`.
  - OpenAPI schema component names match the rest of the framework.

  ## Performance

  - Field builder chains typecheck **about twice as fast** — field methods moved
    onto the class instead of a 27-key mapped type.
  - The client no longer bundles `qs`: **−90 KB** from the browser bundle.

  ## Internal

  CI ratchets that keep the cleanup from rotting: `dead-modules`, `lint-census`,
  `deprecated-imports`, `clone-census`, alongside the existing any-census,
  type-budget and size budgets. Each fails on an increase, so every count above
  can only go down.

## 3.18.0

## 3.17.0

### Minor Changes

- [#188](https://github.com/questpie/questpie/pull/188) [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the Realtime v3 snapshot/delta event contract, opt-in native SSE row deltas,
  transaction-id reconciliation, TanStack Query delta reduction, and the new
  TanStack DB collection package.

  - Add collection- and application-level row-live-query policies, bounded
    server-only subscription scopes and access-equivalence keys, conservative
    three-valued topic routing, structured classifier diagnostics, high-fanout
    observability, and deterministic 100k-subscription benchmark scenarios.
    Unsupported or ambiguous predicates remain candidates; only a proven miss
    suppresses refresh.
  - Keep disabled row live queries isolated from collection dependency capture,
    application channels, CRDT notices, and broker coordination, and reject them
    before allocating subscription state.
  - Preserve `Date` identity and exact epoch milliseconds across official typed
    CRUD, realtime, Channels, replay, presence, TanStack hydration, and
    reconciliation paths through one versioned exact-path wire contract. Keep
    `f.date()` as an exact `YYYY-MM-DD` string, require explicit RFC 3339 zones
    for external datetime input, and emit accurate OpenAPI `date`/`date-time`
    schemas.
  - Publish every fixed-group companion against the current Questpie minor train
    instead of retaining a `^3.16.0` peer floor.
  - Database startup now enforces QUESTPIE's documented PostgreSQL 15 minimum; the
    realtime xid8 schema still has its explicit PostgreSQL 13 capability preflight.
  - Make the existing typed Queue `publish(payload, options)` operation
    ambient-transaction-aware without adding a public outbox API. pg-boss inserts
    through the current Drizzle transaction; BullMQ, Cloudflare Queues, and custom
    external adapters use the framework-owned `questpie_queue_dispatch` ledger
    with leased crash recovery. Deploy the generated migration before this
    version.
  - Add portable `idempotencyKey` and stable logical `dispatchId` metadata,
    retain adapter-portable idempotency receipts, reject ambiguous
    `idempotencyKey` + `singletonKey` combinations, explicitly settle pg-boss
    `runOnce()` jobs, and keep Cloudflare poison or exhausted-retry messages
    observable for platform failure/DLQ handling. Queue delivery remains
    at-least-once, and `publish()` now returns the logical dispatch UUID for all
    built-in adapters instead of an adapter-specific physical id or `null`.
  - Bound Queue relay recovery to 25 adapter-publication attempts, expose terminal
    counts and payload-free structured errors through `queue.drain()`, and allow
    bounded multi-batch recovery through `maxBatches`. pg-boss deployments using
    a separate database must set `useApplicationTransaction: false`.

- [#188](https://github.com/questpie/questpie/pull/188) [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a separately authorized physical-purge lifecycle for soft-delete collections.
  - Expose capability-aware `purgeById` server, HTTP, browser client, OpenAPI, and TanStack Query surfaces without adding a force-delete alias.
  - Require an explicit `purge` access rule, reject active rows, hide denied or missing targets behind the same not-found result, and run dedicated fatal purge hooks transactionally.
  - Strictly prevalidate purge `AccessWhere` trees so unknown or unsupported leaves, including leaves nested below `NOT`, fail closed.
  - Block retained collection/global relations and concurrent foreign-key DDL instead of converting soft-delete cascades into destructive cascades. Declared relation writes to a missing registered target now fail with bad request so a writer delayed behind purge cannot commit a dangling reference.
  - Serialize purge per collection behind a PostgreSQL schema fence, bound relation-lock waits to three seconds, and return a retryable conflict on contention.
  - Add two mandatory core tables, `questpie_storage_cleanup` and `questpie_storage_object_key`. Every application with upload collections must generate and deploy the migration before its next upload metadata create/key change, even when purge and the durable cleanup worker are not enabled yet.
  - Preserve upload bytes through soft delete/restore. Replaced upload keys and committed purge now depend on the existing API/queue worker running the durable `storageCleanup` job; provider failures and crashes retain leased retry work. Hard-delete uploads remain post-commit but now use the same reference-aware key fence, and missing provider objects converge without leaking coordination rows.
  - Reject upload metadata creation or key replacement when the provider object does not exist, with a bounded provider existence check.
  - Integrate committed purge with audit, realtime, Search, and CRDT retention. Expired CRDT epochs, bindings, and the final retired identity tombstone are removed after the recovery window.
  - Preserve the original active-row `deletedAt` index and add a partial `(deletedAt, id)` index for bounded retention keysets.
  - Correct polymorphic relation persistence so public `{ type, id }` values map to both physical discriminator/id columns on create and update, reads and versions restore the public shape, and purge inspects every discriminator. Applications using polymorphic relations must review and deploy the generated schema migration, backfill legacy discriminator/id pairs, and verify that no retained reference has a null discriminator before enabling purge.
  - Keep framework-derived upload `key`, sanitized `filename`, MIME type, size, and configured visibility authoritative over `additionalData`; validate upload keys against the provider and relation targets against registered rows before writing. These checks add one bounded provider lookup or target-row lock to affected writes.
  - Make PostgreSQL queue `runOnce()` explicitly complete/fail fetched jobs and settle every fetched sibling before surfacing the first handler error.
  - Add a bounded high-water/keyset retention recipe, a relation-bearing real PostgreSQL benchmark harness, and a mandatory CI concurrency/key-reuse contract.

## 3.16.0

## 3.15.2

## 3.15.1

## 3.15.0

### Minor Changes

- [#163](https://github.com/questpie/questpie/pull/163) [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Ship Realtime v2 and typed application channels as one transport-agnostic realtime system.

  - Add transaction-bound realtime capture, durable reconciliation, resumable live-query topics, per-session refresh sharing, snapshot suppression, admission and backpressure limits, structured observations, and hardened pg-notify, Redis, and Cloudflare broker paths.
  - Add file-convention `channel()` definitions, generated server and client types, per-verb subscribe/publish authorization, Zod-validated events, ordered replay with explicit gap handling, and typed TanStack Query channel subscriptions.
  - Add transport-independent live presence with `subscribePresence()`, `presenceIter()`, and TanStack latest-roster queries; SSE uses cross-instance Postgres leases with principal aggregation and crash expiry, while Pusher/Soketi uses native provider membership behind the same client API.
  - Add the zero-infrastructure SSE preset and the optional Pusher/Soketi preset without changing consumer APIs, plus dynamic auth headers across data, upload, SSE, and WebSocket requests.
  - Add compatibility rollout modes, operational limits, migration and rollback documentation, reactive React performance guidance, cross-driver integration coverage, and existing admin/workflow consumer regression coverage.

  Migration note: bulk update and bulk delete now produce one logical realtime event per operation instead of one event per affected record. Adapter consumers must handle `bulk_update` and `bulk_delete` and use `payload.count` plus `payload.recordIds`. Follow the Realtime v2 migration guide for canary, dual-run, schema migration, and config-only rollback steps.

## 3.14.0

## 3.13.0

## 3.12.0

## 3.11.0

## 3.10.0

## 3.9.1

## 3.9.0

## 3.8.0

## 3.7.0

### Minor Changes

- [#101](https://github.com/questpie/questpie/pull/101) [`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Wave A type quick wins — the probe-validated half of the type-supremacy audit.

  **Client & routes**

  - The routes client is typed end-to-end: `ExpandRoutes` is wired into `client.routes` (nested literal keys, phantom route names error) and the `& Record<string, any>` poison is gone. `AppConfig` no longer carries collection/global index-signature intersections — typo'd keys error on the client.
  - Route outputs are typed from `.outputSchema()`: it compile-checks the handler return and `InferRouteOutput<typeof def>` resolves through the definition (full handler-return inference deferred — a generic `.handler<TResult>()` provably re-enters the generated module graph; Wave B layered emission unblocks it).
  - `app: any` is gone from route handler args — `ctx.app` is fully typed via the AppContext augmentation (core module routes use an internal accessor).
  - @questpie/tanstack-query `find`/`findOne`/`get` are generic per call — results stop collapsing to `PaginatedResult<{}>`; global `columns` options are `Record<string, boolean>` instead of `any`.

  **Generated types**

  - Module codegen emits `type` aliases for category maps — module `interface` maps lacked implicit index signatures, failing the `Record` constraint and collapsing every `with`-populated relation to `{}` app-wide. Populated relations are real row types again (committed tripwire test guards the constraint).
  - Job/workflow contexts get typed `db`/`session`/`globals`/`kv`/`logger` members and a typed `workflows: WorkflowClient<AppWorkflows>` — bogus workflow names and wrong payloads error.

  **Field & input integrity**

  - `.default()` is constrained to the field's value type (`f.boolean().default("yes")` is now a compile error), field hooks receive typed values, and where-operator maps are sealed — unknown operators (`fuzzyMatch`, `eqq`) and wrong value types error instead of passing as `any`.
  - `create({})` errors again on collections without relations (the empty-relations fallback no longer optionalizes every key), and `columns: { x: false }` omission mode types the result correctly (it was inverted).

  **Type performance & CI**

  - Variance annotations on the hot field/CRUD aliases: flagship app check time drops ~13-30% (city-portal 10.6s → 7.4s) with byte-identical error sets.
  - New CI gates: `scripts/type-budget.ts` (instantiation budget per package/example, fails on >10% regression), `scripts/any-census.ts` (type-escape ratchet — counts can only go down), alongside the dist-types gate.

## 3.6.1

## 3.6.0

### Minor Changes

- [#97](https://github.com/questpie/questpie/pull/97) [`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81) Thanks [@drepkovsky](https://github.com/drepkovsky)! - The 3.6.0 dogfooding batch — fixes and primitives surfaced by building a real app (jubli) on the framework.

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

## 3.5.6

## 3.5.5

## 3.5.4

## 3.5.3

## 3.5.2

## 3.5.1

## 3.5.0

## 3.4.1

## 3.4.0

## 3.3.0

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.0

## 3.0.9

## 3.0.8

## 3.0.7

## 3.0.6

## 3.0.5

## 3.0.4

## 3.0.3

## 3.0.2

## 3.0.1

## 3.0.0

### Major Changes

- [`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78) Thanks [@drepkovsky](https://github.com/drepkovsky)! - # QuestPie v3

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
  - **Route system** — file-path conventions, method-specific route definitions, priority matcher
  - **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
  - **Version history** — full versions/revert parity across stack with admin UI
  - **Server actions** — real form field mapping, RPC execution, effects handling
  - **Admin field meta augmentation** — all field types properly augmented with admin meta

### Patch Changes

- Updated dependencies [[`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78)]:
  - questpie@3.0.0

## 2.0.0

### Major Changes

- [#16](https://github.com/questpie/questpie/pull/16) [`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - ## Ship field builder platform, server-driven admin, and standalone RPC API

  ### `questpie` (core)

  #### Field Builder System (NEW)

  Replace raw Drizzle column definitions with a type-safe field builder. Collections and globals now define fields via a callback that receives a field builder proxy `f`:

  ```ts
  // Before
  collection("posts").fields({
    title: varchar("title", { length: 255 }),
    content: text("content"),
  });

  // After
  q.collection("posts").fields((f) => ({
    title: f.text({ required: true }),
    content: f.textarea({ localized: true }),
    publishedAt: f.datetime(),
  }));
  ```

  Built-in field types: `text`, `textarea`, `number`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `select`, `upload`, `json`, `object`, `array`, `relation`. Each field produces Drizzle columns, Zod validation schemas, typed operators for filtering, and serializable metadata for admin introspection — all from a single declaration.

  **Custom field types** — define your own field types with the `field<TConfig, TValue>()` factory. A custom field implements `toColumn` (Drizzle column), `toZodSchema` (validation), `getOperators` (query filtering), and `getMetadata` (introspection). Register custom fields on the builder via `q.fields({ myField })` and they become available as `f.myField()` in all collections:

  ```ts
  const slugField = field<SlugFieldConfig, string>()({
    type: "slug",
    _value: undefined as unknown as string,
    toColumn: (name, config) => varchar(name, { length: 255 }),
    toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
    getOperators: (config) => ({
      column: stringColumnOperators,
      jsonb: stringJsonbOperators,
    }),
    getMetadata: (config) => ({
      type: "slug",
      label: config.label,
      required: config.required ?? false,
      localized: false,
      readOnly: false,
      writeOnly: false,
    }),
  });

  // Register:
  const app = q({ name: "app" }).fields({ slug: slugField });
  // Use:
  collection("pages").fields((f) => ({ slug: f.slug({ required: true }) }));
  ```

  **Custom operators** — the `operator<TValue>()` helper creates typed filter functions from `(column, value, ctx) => SQL`. Each field's `getOperators` returns context-aware operator sets for both column and JSONB access. Operators are automatically used by the query builder and exposed via the client SDK's `where` parameter.

  #### Reactive Field System (NEW)

  Server-evaluated reactive behaviors on fields via `meta.admin`:

  - **`hidden`** / **`readOnly`** / **`disabled`** — conditionally toggle field state based on form data
  - **`compute`** — auto-compute values from other fields
  - **Dynamic `options`** — load select/relation options on the server with dependency tracking and debounce

  Reactive handlers run server-side with full access to `ctx.db`, `ctx.user`, `ctx.req`. A proxy-based dependency tracker automatically detects which form fields each handler reads and serializes that info to the client for efficient re-evaluation.

  #### Standalone RPC API (NEW)

  New `q.rpc()` builder for defining type-safe remote procedures outside collection/global CRUD. RPC procedures are routed through the HTTP adapter at `/rpc/<path>` with nested routers, access control, and full type inference on the client SDK.

  ```ts
  const r = q.rpc<typeof app>();
  export const dashboardRouter = r.router({
    stats: r.fn({
      handler: async ({ app }) => {
        /* ... */
      },
    }),
  });
  ```

  Collections and globals also support scoped `.functions()` for entity-specific RPC, routed at `/collections/:slug/rpc/:name` and `/globals/:slug/rpc/:name`.

  #### Callable `q` Builder

  The `q` export is now a callable builder: use `q({ name: "my-app" })` to create a fresh `QuestpieBuilder`, or access `q.collection()`, `q.global()`, `q.job()` etc. as methods. Default field types are auto-registered. Standalone function exports (`collection`, `global`, `job`, `fn`, `email`, `auth`, `config`, `rpc`) are are also re-exported.

  #### Introspection API (NEW)

  Full server-side introspection of collection and global schemas for admin consumption: field metadata, access permissions, relation info, reactive config, validation schemas — all serialized from builder state. Admin UI consumes this directly instead of relying on client-side config.

  #### Queue Runtime Redesign (BREAKING)

  - Redesigned `QueueService` with proper lifecycle (`start`/`stop`/`drain`), graceful shutdown, and health checks
  - New Cloudflare Queues adapter alongside pg-boss
  - Worker handlers now receive `{ payload, app }` instead of `(payload, ctx)`
  - Workflow builder API refined with better type inference

  #### Realtime Pipeline Hardening (BREAKING)

  - `PgNotifyAdapter`: proper connection lifecycle, idempotent `start`/`stop`, owned vs shared client tracking, handler cleanup
  - `RedisStreamsAdapter`: graceful error handling in read loop, no longer auto-disconnects client on `stop()`
  - `streamedQuery` from `@tanstack/react-query` integrated as first-class citizen in collection query options

  #### Access Control (BREAKING)

  - **Removed** `access.fields` from collection/global builder — field-level access is now defined per-field via `access: { read, update }` in the field definition itself
  - CRUD generator evaluates field-level access at runtime, filtering output and validating input per field

  #### CRUD API Alignment (BREAKING)

  - Client SDK `update`/`delete`/`restore` now accept object params `{ id, data }` instead of positional args
  - Relation field names are automatically transformed to FK columns in create/update operations
  - `updateMany` and `deleteMany` added to HTTP adapter, client SDK, and tanstack-query
  - Better Auth drizzle adapter now correctly uses transactions

  #### Server-Driven Admin Config

  Admin configuration (sidebar, dashboard, branding, actions) is now defined server-side and served via introspection. The server emits serializable `ComponentReference` objects (`{ type, props }`) instead of React elements. A typed **component factory** `c` is available in all admin config callbacks:

  ```ts
  // Server-side (serializable, no React imports):
  .admin(({ c }) => ({
    icon: c.icon("ph:article"),       // => { type: "icon", props: { name: "ph:article" } }
    badge: c.badge({ text: "New" }),   // => { type: "badge", props: { text: "New" } }
  }))
  ```

  The client resolves these references via `ComponentRenderer` which looks up the matching React component from the admin builder's component registry. Built-in components (`icon` → Iconify, `badge`) are registered by default; custom ones are added via `qa().components({ myComponent: MyReactComponent })`.

  ***

  ### `@questpie/admin`

  #### Server-Driven Schema (BREAKING)

  Admin UI now consumes field schemas, sidebar config, dashboard config, and branding from server introspection instead of client-side builder config. `defineAdminConfig` is replaced by server-defined metadata.

  #### Builder API Cleanup (BREAKING)

  - **Removed** from `qa` namespace: `qa.collection()`, `qa.global()`, `qa.block()`, `qa.sidebar()`, `qa.dashboard()`, `qa.branding()` — these are now server-side concerns
  - Kept: `qa.field()`, `qa.listView()`, `qa.editView()`, `qa.widget()`, `qa.page()` for client-only UI registrations
  - Admin `CollectionBuilder` and `GlobalBuilder` completely rewritten — all schema methods (`.fields()`, `.list()`, `.form()`) removed; only UI-specific methods remain (`.meta()`, `.preview()`, `.autoSave()`, `.use()`)

  #### Reactive Fields UI (NEW)

  - `useReactiveFields` hook evaluates server-defined reactive config (hidden/readOnly/disabled/compute) client-side with automatic dependency tracking
  - `useFieldOptions` hook for dynamic options loading with search debounce and SSE streaming

  #### Block Editor Rework

  - Full drag-and-drop block editor with canvas layout, block library sidebar, tree navigation
  - Block field metadata unified between collections and blocks
  - Block prefetch values inferred from field definitions

  #### Actions System (NEW)

  Collection-level actions system with both client and server handler modes:

  - **Handler types**: `navigate` (routing), `api` (HTTP call), `form` (dialog with field inputs), `dialog` (custom component), `custom` (arbitrary code), `server` (server-side execution with full app context)
  - **Scopes**: `header` (list view toolbar — primary buttons + secondary dropdown), `bulk` (selected items toolbar), `single`/`row` (per-item)
  - **Server actions** run handler on the server with access to `app`, `db`, `session`; return typed results (`success`, `error`, `redirect`, `download`) with side-effects (`invalidate`, `toast`, `navigate`)
  - **Form actions** accept field definitions from the field registry (`f.text()`, `f.select()`, etc.) for type-safe input collection in a dialog
  - **Confirmation dialogs** configurable per action with destructive styling support
  - Built-in action presets: `create`, `save`, `delete`, `deleteMany`, `duplicate`

  #### Realtime Multiplexor

  Migrated from example code into core admin package for SSE-based live updates.

  #### Test Migration

  All admin tests migrated from vitest to bun:test; vitest dependency removed.

  ***

  ### `@questpie/tanstack-query`

  #### RPC Query Options (NEW)

  Full type-safe query/mutation option builders for RPC procedures with nested router support. The `createQuestpieQueryOptions` factory now accepts a `TRPC` generic for RPC router types, producing `.rpc.*` namespaced option builders.

  #### Realtime Streaming (NEW)

  - Re-exports `buildCollectionTopic`, `buildGlobalTopic`, `TopicConfig`, `RealtimeAPI` from core client
  - Collection `.find`, `.findOne`, `.count` option builders produce `streamedQuery`-based options for SSE real-time updates

  #### Batch Operations (NEW)

  - `updateMany` and `deleteMany` mutation option builders for collections
  - `key` builders for all collection/global operations

  ***

  ### `@questpie/openapi` (NEW PACKAGE)

  OpenAPI 3.1 spec generator for QUESTPIE instances. Generates schemas for collections (CRUD + search), globals, auth, and RPC endpoints. Includes a Scalar-powered API reference UI mountable via the adapter.

  ***

  ### `@questpie/elysia` / `@questpie/hono` / `@questpie/next`

  - All adapters accept `rpc` config to mount standalone RPC router trees alongside CRUD routes
  - Formatting standardized (tabs → spaces alignment)
  - `@questpie/hono`: `questpieHono` now correctly forwards RPC router to fetch handler

  ***

  ### `create-questpie` (NEW PACKAGE)

  Interactive CLI (`bunx create-questpie`) for scaffolding new QUESTPIE projects. Ships with a TanStack Start template including pre-configured collections, globals, admin setup, migrations, and dev tooling.

### Patch Changes

- Updated dependencies [[`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4)]:
  - questpie@2.0.0

## 1.1.1

## 1.1.0

## 1.0.5

### Patch Changes

- Updated dependencies [[`a043841`](https://github.com/questpie/questpie/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9)]:
  - questpie@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [[`01562df`](https://github.com/questpie/questpie/commit/01562dfb6771a47eddcb797f36f951ae434f29c8)]:
  - questpie@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies []:
  - questpie@1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions

  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

- Updated dependencies [[`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77)]:
  - questpie@1.0.2

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

- Updated dependencies [[`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99)]:
  - questpie@1.0.1

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

### Patch Changes

- Updated dependencies [[`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389)]:
  - questpie@1.0.0

## 0.0.2

### Patch Changes

- chore: include files in package.json
- Updated dependencies
  - questpie@0.0.2

## 0.0.1

### Patch Changes

- feat: initial release
- Updated dependencies
  - questpie@0.0.1
