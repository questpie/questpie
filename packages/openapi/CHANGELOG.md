# @questpie/openapi

## 3.25.3

### Patch Changes

- Updated dependencies [[`f72cdfa`](https://github.com/questpie/questpie/commit/f72cdfa26b94ff1f4bcfffeec398e7a79a66b548)]:
  - questpie@3.25.3

## 3.25.2

### Patch Changes

- Updated dependencies [[`974e6b2`](https://github.com/questpie/questpie/commit/974e6b24eeee2d26466c142d06f79cc7ba1f65e7)]:
  - questpie@3.25.2

## 3.25.1

### Patch Changes

- Updated dependencies [[`6542080`](https://github.com/questpie/questpie/commit/65420804940ede8b419bfeed8964d5f1ce32b82b)]:
  - questpie@3.25.1

## 3.25.0

### Patch Changes

- Updated dependencies [[`da70c88`](https://github.com/questpie/questpie/commit/da70c88286f0b5228d500b989554908d8724a463)]:
  - questpie@3.25.0

## 3.24.0

### Patch Changes

- Updated dependencies [[`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270), [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270)]:
  - questpie@3.24.0

## 3.23.0

### Patch Changes

- Updated dependencies [[`bec0c23`](https://github.com/questpie/questpie/commit/bec0c23a78f1318a86c09e8d02f1584c89605c50), [`76bf85c`](https://github.com/questpie/questpie/commit/76bf85c681bf3187338574d8a9b4e21e47ac9051)]:
  - questpie@3.23.0

## 3.22.0

### Patch Changes

- Updated dependencies [[`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124), [`195648d`](https://github.com/questpie/questpie/commit/195648dba74395dfa1d37c6ba9382c40ef63c8e3), [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7), [`cd62bb8`](https://github.com/questpie/questpie/commit/cd62bb8bf4df98b3f75c4a894ba8148677a3b9ae)]:
  - questpie@3.22.0

## 3.21.1

### Patch Changes

- Updated dependencies [[`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe)]:
  - questpie@3.21.1

## 3.21.0

### Patch Changes

- Updated dependencies [[`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b)]:
  - questpie@3.21.0

## 3.20.1

### Patch Changes

- Updated dependencies [[`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24)]:
  - questpie@3.20.1

## 3.20.0

### Patch Changes

- Updated dependencies [[`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930)]:
  - questpie@3.20.0

## 3.19.2

### Patch Changes

- Updated dependencies [[`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3)]:
  - questpie@3.19.2

## 3.19.1

### Patch Changes

- Updated dependencies [[`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863)]:
  - questpie@3.19.1

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

### Patch Changes

- Updated dependencies [[`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38)]:
  - questpie@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [[`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516)]:
  - questpie@3.18.0

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

- [#188](https://github.com/questpie/questpie/pull/188) [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make built-in Search authorization fail closed and capability reporting truthful. Search now requires explicit `.searchable(...)` opt-in, uses one canonical authorized source-row universe for hits, totals, facets, statistics, browse, and semantic ranking, rejects unimplemented hybrid mode, and fails the HTTP response when hydration no longer matches ranked candidates. The default projection is title-only, and hydrated HTTP/client results expose only the relevance score instead of index snapshots that could bypass field access.

### Patch Changes

- Updated dependencies [[`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4), [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d), [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99), [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9), [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224), [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298), [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c), [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49), [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa), [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a)]:
  - questpie@3.17.0

## 3.16.0

### Patch Changes

- Updated dependencies [[`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e)]:
  - questpie@3.16.0

## 3.15.2

### Patch Changes

- Updated dependencies [[`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8)]:
  - questpie@3.15.2

## 3.15.1

### Patch Changes

- Updated dependencies [[`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10)]:
  - questpie@3.15.1

## 3.15.0

### Minor Changes

- [#165](https://github.com/questpie/questpie/pull/165) [`653c36f`](https://github.com/questpie/questpie/commit/653c36fcf604e1f31d997c46e42c783162c4523b) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Improve generated OpenAPI 3.1 specs with route metadata, per-operation security, asynchronous Better Auth schema derivation, complete module-route coverage, and input-aware Zod transform conversion.

### Patch Changes

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0

## 3.0.39

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - questpie@3.14.0

## 3.0.38

### Patch Changes

- Updated dependencies [[`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575), [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575)]:
  - questpie@3.13.0

## 3.0.37

### Patch Changes

- Updated dependencies [[`2f6e776`](https://github.com/questpie/questpie/commit/2f6e776896a9381514a237447d4dcc85dad558d0)]:
  - questpie@3.12.0

## 3.0.36

### Patch Changes

- Updated dependencies [[`4ed62ec`](https://github.com/questpie/questpie/commit/4ed62ec7375e7f841a20e7c36c11e15bc4f63b39), [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8), [`7c4060d`](https://github.com/questpie/questpie/commit/7c4060df2fbc663cc9d4e718cff4ce72cdd83663), [`6cddd5b`](https://github.com/questpie/questpie/commit/6cddd5b2ec2127db40aa6b97212254689b9f780f)]:
  - questpie@3.11.0

## 3.0.35

### Patch Changes

- [`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Make custom route calls use one canonical typed client shape: `client.routes.name.method(input)`.
  Route definitions now accept one HTTP method per builder; use method-suffixed route files for multiple methods on the same path.
  Route params inferred from method-suffixed keys now ignore the trailing `:METHOD`, so keys like `posts/[id]:GET` and `auth/[...path]:POST` keep their params.

  OpenAPI route generation now keeps operation and schema ids distinct for method-suffixed sibling routes that share one path.
  Docs and agent-facing examples now show only method-suffixed route files and method-leaf client calls.

  Normal `seed({...})` handlers now run inside a single database transaction, so failed writes and the seed tracking row roll back together. For resumable or side-effectful seed work, `seed.steps({...})` exposes `step(name, fn)`, stores completed step checkpoints in `questpie_seed_steps`, returns cached JSON results on replay, and clears checkpoints during force/reset/undo flows.

  The seed docs and Questpie skill references were updated to describe the new default transaction behavior, the `seed.steps()` API, checkpoint cleanup, and the no seed-wide rollback caveat for step seeds.

- Updated dependencies [[`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d)]:
  - questpie@3.10.0

## 3.0.34

### Patch Changes

- Updated dependencies [[`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff)]:
  - questpie@3.9.1

## 3.0.33

### Patch Changes

- Updated dependencies [[`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93)]:
  - questpie@3.9.0

## 3.0.32

### Patch Changes

- Updated dependencies [[`590e6c4`](https://github.com/questpie/questpie/commit/590e6c433a73a44316e89d00eeeaa21b0d584e3b), [`a56e017`](https://github.com/questpie/questpie/commit/a56e0179f6016915996e9bd9a58c7279d070692a), [`81e4922`](https://github.com/questpie/questpie/commit/81e4922e7ed54a2ff2171e86a9ce45a07b7c433b), [`b15ce41`](https://github.com/questpie/questpie/commit/b15ce41ce2ed8378abd0ea3e42c8f577abe9ad6b)]:
  - questpie@3.8.0

## 3.0.31

### Patch Changes

- Updated dependencies [[`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4)]:
  - questpie@3.7.0

## 3.0.30

### Patch Changes

- Updated dependencies [[`c8c4a84`](https://github.com/questpie/questpie/commit/c8c4a845b4f7442ff92123391b2636a9f15d9727)]:
  - questpie@3.6.1

## 3.0.29

### Patch Changes

- Updated dependencies [[`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81)]:
  - questpie@3.6.0

## 3.0.28

### Patch Changes

- Updated dependencies [[`ea701dd`](https://github.com/questpie/questpie/commit/ea701ddaa32f85056bbbcb7ba77099af349d6480)]:
  - questpie@3.5.6

## 3.0.27

### Patch Changes

- Updated dependencies [[`24c0f0e`](https://github.com/questpie/questpie/commit/24c0f0edcc22dd21da3070139e96cb9bab7601e0)]:
  - questpie@3.5.5

## 3.0.26

### Patch Changes

- [#89](https://github.com/questpie/questpie/pull/89) [`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Require an admin-role session for admin RPC routes that expose admin config, content locale callbacks, preview URLs/tokens, actions, widgets, and reactive field handlers, and document that the admin package depends on the Better Auth `session.user.role === "admin"` contract.

  Run block custom prefetch functions, `with` expansion, and loaders inside the caller request context so nested collection/global reads inherit the current session, locale, access mode, and workflow stage. Admin block introspection now serializes reactive field/form props and exposes only wire-safe block schema data instead of server-only callback state.

  Treat `inputFalse()`, `outputFalse()`, and field-level `.access()` declarations as framework-level runtime access primitives by resolving a single deterministic field access map for CRUD and introspection. Field `.access()` is the base rule, collection/global `.access({ fields })` can override it for compatibility, and `inputFalse()`/`outputFalse()` remain final deny rules. User-mode CRUD calls now reject restricted writes and redact restricted fields from collection/global responses, including nested object and array item paths. OpenAPI collection/global schemas now separate input and response shapes so read-only fields are not advertised as writable and write-only fields are not advertised as returned data.

  Stop synthesizing placeholder `Request` objects for local field hooks, field access, typed JSON routes, and admin reactive handlers. `req`/`request` is now present only for HTTP execution, so local API calls and workers can reliably distinguish non-HTTP execution from request-backed execution.

- Updated dependencies [[`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54)]:
  - questpie@3.5.4

## 3.0.25

### Patch Changes

- Updated dependencies [[`f678f70`](https://github.com/questpie/questpie/commit/f678f70121f8be87fd4a5be6a9b19a0ec3653d09), [`ed73b91`](https://github.com/questpie/questpie/commit/ed73b917e4a1a59908e186171a4ab837edb3be9f)]:
  - questpie@3.5.3

## 3.0.24

### Patch Changes

- Updated dependencies [[`bc0bc1d`](https://github.com/questpie/questpie/commit/bc0bc1dbfd24ddfa109218629fd97af52bcdf63e)]:
  - questpie@3.5.2

## 3.0.23

### Patch Changes

- [`a918d08`](https://github.com/questpie/questpie/commit/a918d085a3e8ef1a1b32925215961631e2b23fe7) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Improve admin UI performance and preview stability while tightening React Doctor checks.

  - Reduce stale state updates, redundant render work, and unnecessary layout churn in admin views and preview flows.
  - Add safer collection and relation query guards when collection names are not yet resolved.
  - Restore the OpenAPI root package export for `openApiModule` and config helpers.

- Updated dependencies []:
  - questpie@3.5.1

## 3.0.22

### Patch Changes

- Updated dependencies [[`1964037`](https://github.com/questpie/questpie/commit/196403736308b1bc8ff9309f4e1673f39bf3a972)]:
  - questpie@3.5.0

## 3.0.21

### Patch Changes

- Updated dependencies [[`080da92`](https://github.com/questpie/questpie/commit/080da92a871df7f71263a3427145de9cd4fbdb58)]:
  - questpie@3.4.1

## 3.0.20

### Patch Changes

- Updated dependencies [[`42e0636`](https://github.com/questpie/questpie/commit/42e0636c8cf3dac1d2148878b4a76904a7b506b3)]:
  - questpie@3.4.0

## 3.0.19

### Patch Changes

- Updated dependencies [[`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434)]:
  - questpie@3.3.0

## 3.0.18

### Patch Changes

- Updated dependencies []:
  - questpie@3.2.7

## 3.0.17

### Patch Changes

- Updated dependencies [[`40768c4`](https://github.com/questpie/questpie/commit/40768c4dc634dce6fa8c71ce1f23e0c7080ab1a9)]:
  - questpie@3.2.6

## 3.0.16

### Patch Changes

- Updated dependencies []:
  - questpie@3.2.5

## 3.0.15

### Patch Changes

- Updated dependencies [[`ebee6b1`](https://github.com/questpie/questpie/commit/ebee6b161d46d2d6955d5c1839864bbc8d67cd69)]:
  - questpie@3.2.4

## 3.0.14

### Patch Changes

- Updated dependencies [[`7607322`](https://github.com/questpie/questpie/commit/7607322cf6bbc0d933dd2c593edd3de618827b06)]:
  - questpie@3.2.3

## 3.0.13

### Patch Changes

- Updated dependencies [[`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8)]:
  - questpie@3.2.2

## 3.0.12

### Patch Changes

- Updated dependencies [[`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab), [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851)]:
  - questpie@3.2.1

## 3.0.11

### Patch Changes

- Updated dependencies [[`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead)]:
  - questpie@3.2.0

## 3.0.10

### Patch Changes

- Updated dependencies [[`6186dfb`](https://github.com/questpie/questpie/commit/6186dfbb7fd4423f4ee0c5b1af78f3690f433dfb)]:
  - questpie@3.1.0

## 3.0.9

### Patch Changes

- Updated dependencies []:
  - questpie@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies []:
  - questpie@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [[`5d7639b`](https://github.com/questpie/questpie/commit/5d7639b28d4625c5d587ad256cbac98ba14ff886)]:
  - questpie@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [[`ea2ff8d`](https://github.com/questpie/questpie/commit/ea2ff8dea8ad7b20946ed91906374e25a2bb9ba5)]:
  - questpie@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [[`325599e`](https://github.com/questpie/questpie/commit/325599e70089bcdeb632d0e389614e6738a514cb)]:
  - questpie@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [[`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb)]:
  - questpie@3.0.4

## 3.0.3

### Patch Changes

- Updated dependencies [[`e40fc20`](https://github.com/questpie/questpie/commit/e40fc200dbd604e2ad8147b4dd1711d11b968b91), [`acfc1c0`](https://github.com/questpie/questpie/commit/acfc1c0b94a2cde684d17ae50b2c4c2278d8705c)]:
  - questpie@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [[`25b85ec`](https://github.com/questpie/questpie/commit/25b85ec54cfa7fdf38ee15548377d01191f0667a)]:
  - questpie@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [[`fca6096`](https://github.com/questpie/questpie/commit/fca60967ee1c2b6b8fb439230e663daea60b0465), [`3e8e7e1`](https://github.com/questpie/questpie/commit/3e8e7e1f1b5b7fe05c58fd582d0ee6ced05c6411)]:
  - questpie@3.0.1

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
