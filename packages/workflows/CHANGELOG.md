# @questpie/workflows

## 3.21.1

### Patch Changes

- Updated dependencies [[`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe)]:
  - questpie@3.21.1
  - @questpie/admin@3.21.1

## 3.21.0

### Patch Changes

- Updated dependencies [[`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b)]:
  - questpie@3.21.0
  - @questpie/admin@3.21.0

## 3.20.1

### Patch Changes

- Updated dependencies [[`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24)]:
  - questpie@3.20.1
  - @questpie/admin@3.20.1

## 3.20.0

### Patch Changes

- Updated dependencies [[`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930)]:
  - questpie@3.20.0
  - @questpie/admin@3.20.0

## 3.19.2

### Patch Changes

- Updated dependencies [[`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3)]:
  - questpie@3.19.2
  - @questpie/admin@3.19.2

## 3.19.1

### Patch Changes

- Updated dependencies [[`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863)]:
  - questpie@3.19.1
  - @questpie/admin@3.19.1

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
  - @questpie/admin@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [[`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516)]:
  - questpie@3.18.0
  - @questpie/admin@3.18.0

## 3.17.0

### Patch Changes

- Updated dependencies [[`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4), [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d), [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99), [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9), [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224), [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298), [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c), [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49), [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa), [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a)]:
  - questpie@3.17.0
  - @questpie/admin@3.17.0

## 3.16.0

### Patch Changes

- Updated dependencies [[`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e)]:
  - questpie@3.16.0
  - @questpie/admin@3.16.0

## 3.15.2

### Patch Changes

- Updated dependencies [[`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8)]:
  - questpie@3.15.2
  - @questpie/admin@3.15.2

## 3.15.1

### Patch Changes

- Updated dependencies [[`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10)]:
  - questpie@3.15.1
  - @questpie/admin@3.15.1

## 3.15.0

### Minor Changes

- [#163](https://github.com/questpie/questpie/pull/163) [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Ship Realtime v2 and typed application channels as one transport-agnostic realtime system.
  - Add transaction-bound realtime capture, durable reconciliation, resumable live-query topics, per-session refresh sharing, snapshot suppression, admission and backpressure limits, structured observations, and hardened pg-notify, Redis, and Cloudflare broker paths.
  - Add file-convention `channel()` definitions, generated server and client types, per-verb subscribe/publish authorization, Zod-validated events, ordered replay with explicit gap handling, and typed TanStack Query channel subscriptions.
  - Add transport-independent live presence with `subscribePresence()`, `presenceIter()`, and TanStack latest-roster queries; SSE uses cross-instance Postgres leases with principal aggregation and crash expiry, while Pusher/Soketi uses native provider membership behind the same client API.
  - Add the zero-infrastructure SSE preset and the optional Pusher/Soketi preset without changing consumer APIs, plus dynamic auth headers across data, upload, SSE, and WebSocket requests.
  - Add compatibility rollout modes, operational limits, migration and rollback documentation, reactive React performance guidance, cross-driver integration coverage, and existing admin/workflow consumer regression coverage.

  Migration note: bulk update and bulk delete now produce one logical realtime event per operation instead of one event per affected record. Adapter consumers must handle `bulk_update` and `bulk_delete` and use `payload.count` plus `payload.recordIds`. Follow the Realtime v2 migration guide for canary, dual-run, schema migration, and config-only rollback steps.

### Patch Changes

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0
  - @questpie/admin@3.15.0

## 3.14.0

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - @questpie/admin@3.14.0
  - questpie@3.14.0

## 3.13.0

### Patch Changes

- Updated dependencies [[`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575), [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575)]:
  - questpie@3.13.0
  - @questpie/admin@3.13.0

## 3.12.0

### Patch Changes

- Updated dependencies [[`2f6e776`](https://github.com/questpie/questpie/commit/2f6e776896a9381514a237447d4dcc85dad558d0)]:
  - questpie@3.12.0
  - @questpie/admin@3.12.0

## 3.11.0

### Patch Changes

- Updated dependencies [[`4ed62ec`](https://github.com/questpie/questpie/commit/4ed62ec7375e7f841a20e7c36c11e15bc4f63b39), [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8), [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8), [`7c4060d`](https://github.com/questpie/questpie/commit/7c4060df2fbc663cc9d4e718cff4ce72cdd83663), [`6cddd5b`](https://github.com/questpie/questpie/commit/6cddd5b2ec2127db40aa6b97212254689b9f780f)]:
  - questpie@3.11.0
  - @questpie/admin@3.11.0

## 3.10.0

### Patch Changes

- Updated dependencies [[`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d)]:
  - questpie@3.10.0
  - @questpie/admin@3.10.0

## 3.9.1

### Patch Changes

- Updated dependencies [[`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff)]:
  - questpie@3.9.1
  - @questpie/admin@3.9.1

## 3.9.0

### Patch Changes

- Updated dependencies [[`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93)]:
  - questpie@3.9.0
  - @questpie/admin@3.9.0

## 3.8.0

### Patch Changes

- Updated dependencies [[`590e6c4`](https://github.com/questpie/questpie/commit/590e6c433a73a44316e89d00eeeaa21b0d584e3b), [`a56e017`](https://github.com/questpie/questpie/commit/a56e0179f6016915996e9bd9a58c7279d070692a), [`81e4922`](https://github.com/questpie/questpie/commit/81e4922e7ed54a2ff2171e86a9ce45a07b7c433b), [`b15ce41`](https://github.com/questpie/questpie/commit/b15ce41ce2ed8378abd0ea3e42c8f577abe9ad6b)]:
  - questpie@3.8.0
  - @questpie/admin@3.8.0

## 3.7.0

### Patch Changes

- Updated dependencies [[`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4)]:
  - questpie@3.7.0
  - @questpie/admin@3.7.0

## 3.6.1

### Patch Changes

- Updated dependencies [[`c8c4a84`](https://github.com/questpie/questpie/commit/c8c4a845b4f7442ff92123391b2636a9f15d9727)]:
  - questpie@3.6.1
  - @questpie/admin@3.6.1

## 3.6.0

### Patch Changes

- Updated dependencies [[`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81)]:
  - questpie@3.6.0
  - @questpie/admin@3.6.0

## 3.5.6

### Patch Changes

- Updated dependencies [[`ea701dd`](https://github.com/questpie/questpie/commit/ea701ddaa32f85056bbbcb7ba77099af349d6480)]:
  - questpie@3.5.6
  - @questpie/admin@3.5.6

## 3.5.5

### Patch Changes

- Updated dependencies [[`24c0f0e`](https://github.com/questpie/questpie/commit/24c0f0edcc22dd21da3070139e96cb9bab7601e0)]:
  - questpie@3.5.5
  - @questpie/admin@3.5.5

## 3.5.4

### Patch Changes

- Updated dependencies [[`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54)]:
  - @questpie/admin@3.5.4
  - questpie@3.5.4

## 3.5.3

### Patch Changes

- Updated dependencies [[`f678f70`](https://github.com/questpie/questpie/commit/f678f70121f8be87fd4a5be6a9b19a0ec3653d09), [`ed73b91`](https://github.com/questpie/questpie/commit/ed73b917e4a1a59908e186171a4ab837edb3be9f)]:
  - questpie@3.5.3
  - @questpie/admin@3.5.3

## 3.5.2

### Patch Changes

- Updated dependencies [[`bc0bc1d`](https://github.com/questpie/questpie/commit/bc0bc1dbfd24ddfa109218629fd97af52bcdf63e)]:
  - questpie@3.5.2
  - @questpie/admin@3.5.2

## 3.5.1

### Patch Changes

- Updated dependencies [[`a918d08`](https://github.com/questpie/questpie/commit/a918d085a3e8ef1a1b32925215961631e2b23fe7)]:
  - @questpie/admin@3.5.1
  - questpie@3.5.1

## 3.5.0

### Patch Changes

- Updated dependencies [[`1964037`](https://github.com/questpie/questpie/commit/196403736308b1bc8ff9309f4e1673f39bf3a972)]:
  - @questpie/admin@3.5.0
  - questpie@3.5.0

## 3.4.1

### Patch Changes

- Updated dependencies [[`080da92`](https://github.com/questpie/questpie/commit/080da92a871df7f71263a3427145de9cd4fbdb58)]:
  - questpie@3.4.1
  - @questpie/admin@3.4.1

## 3.4.0

### Minor Changes

- [`42e0636`](https://github.com/questpie/questpie/commit/42e0636c8cf3dac1d2148878b4a76904a7b506b3) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move concrete adapter implementations to dedicated `questpie/adapters/*` subpaths so optional adapter dependencies are not pulled into unrelated bundles.

  Add Cloudflare-compatible runtime infrastructure: custom Drizzle database configuration, lazy Bun SQL driver loading, Cloudflare Worker handlers, Queues/KV/realtime adapters, runtime compatibility validation, and Worker-oriented deployment docs.

  Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes.

  Add built-in HTTP mailer adapters for Resend and Plunk with Resend-compatible API base URLs.

  Improve queue runtime compatibility and type safety. Queue clients expose jobs by registry key and literal name. Cloudflare Queues maps delayed jobs to platform `delaySeconds` and handles permanent errors deterministically.

  Harden durable workflows with database-backed per-instance lease and heartbeat renewal. Workflow admin/trigger routes default to logged-in admin access via `workflowsConfig()`. Stale execution leases are recovered by `wf-maintenance`.

  Improve admin form and table responsiveness. Reduce broad form subscriptions, scope table relation expansion to visible columns, and use compact default table columns. History sidebars include structured diffs for block, object, and array fields.

  Add `logAuditEntry` helper from `@questpie/admin/server` for custom audit events with actor overrides, resource metadata, locale, and structured changes.

  Fix admin server actions against the current runtime app shape. Action routes now resolve collection definitions through `app.getCollections()` and CRUD APIs through `app.collections`.

  Strip undefined values from admin config response before SuperJSON serialization.

### Patch Changes

- Updated dependencies [[`42e0636`](https://github.com/questpie/questpie/commit/42e0636c8cf3dac1d2148878b4a76904a7b506b3)]:
  - questpie@3.4.0
  - @questpie/admin@3.4.0

## 3.3.0

### Minor Changes

- [`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move concrete integrated adapter implementations out of the root `questpie` entrypoint and expose them through dedicated `questpie/adapters/*` subpaths. Adapter imports such as `pgBossAdapter`, `pgNotifyAdapter`, `redisStreamsAdapter`, `SmtpAdapter`, `ConsoleAdapter`, and BullMQ should now come from their adapter entrypoints. The root entrypoint keeps framework APIs, factories, interfaces, and shared types so optional adapter dependencies are not pulled into unrelated server or Worker bundles.

  Add Cloudflare-compatible runtime infrastructure for QUESTPIE apps. This includes custom Drizzle database configuration via `db: { drizzle }` and `db: { create }`, lazy loading for the default Bun SQL driver, Cloudflare Worker handlers for fetch/queue/scheduled entrypoints, Cloudflare Queues/KV/realtime adapters, runtime compatibility validation for explicit Cloudflare adapter configuration, FlyDrive S3/R2 deployment docs, and Worker-oriented docs for Hyperdrive, Queues, Cron Triggers, Durable Objects, KV, and storage.

  Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes, so fresh databases can apply generated search migrations without manual `pg_trgm` or `vector` setup.

  Add built-in HTTP mailer adapters for Resend and Plunk, including support for Resend-compatible API base URLs.

  Improve queue runtime compatibility and type safety. Queue clients now expose jobs by both generated registry key and literal job name, so module code can publish internal jobs such as `questpie-wf-execute` without app-level alias wrappers. Cloudflare Queues now maps delayed jobs and retry delays to platform `delaySeconds`, handles permanent decode/handler errors deterministically, and respects retry limits from Cloudflare delivery attempts.

  Harden durable workflows. Workflow admin/trigger routes now default to logged-in admin access and can be configured through `config/workflows.ts` with `workflowsConfig()`. Workflow execution now uses a database-backed per-instance lease with heartbeat renewal, making duplicate queue deliveries idempotent across at-least-once queue runtimes. Stale workflow execution leases are recovered by `wf-maintenance`, and retry/cancel/timeout paths clear execution locks.

  Improve admin form and table responsiveness by reducing broad form subscriptions, scoping table relation expansion to visible columns, and using compact default table columns for unconfigured list views. Form sidebars now scroll more smoothly, and history sidebars include structured diffs for block, object, and array fields.

  Add a public `logAuditEntry` helper exported from `@questpie/admin/server` for writing custom audit events from jobs, actions, webhooks, and other server workflows. Audit entries now support actor overrides, resource metadata, locale, resource IDs, and structured changes. Audit log titles are localized at read time using the viewer locale, including localized action/resource labels and unnamed-resource fallbacks.

### Patch Changes

- Updated dependencies [[`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434)]:
  - questpie@3.3.0
  - @questpie/admin@3.3.0

## 3.2.7

### Patch Changes

- Updated dependencies [[`724bf2f`](https://github.com/questpie/questpie/commit/724bf2f27cdb16a6474d3a41b5ff403701ba3577)]:
  - @questpie/admin@3.2.7
  - questpie@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [[`40768c4`](https://github.com/questpie/questpie/commit/40768c4dc634dce6fa8c71ce1f23e0c7080ab1a9)]:
  - questpie@3.2.6
  - @questpie/admin@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies [[`6e8e51a`](https://github.com/questpie/questpie/commit/6e8e51ab609cb76ff6bff4025af0bc186d3dc60d)]:
  - @questpie/admin@3.2.5
  - questpie@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [[`ebee6b1`](https://github.com/questpie/questpie/commit/ebee6b161d46d2d6955d5c1839864bbc8d67cd69), [`7bd0604`](https://github.com/questpie/questpie/commit/7bd0604b4b0290f2b5d67c6fd4d3ab57a923aa85)]:
  - questpie@3.2.4
  - @questpie/admin@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [[`7607322`](https://github.com/questpie/questpie/commit/7607322cf6bbc0d933dd2c593edd3de618827b06)]:
  - questpie@3.2.3
  - @questpie/admin@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [[`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8)]:
  - @questpie/admin@3.2.2
  - questpie@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [[`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab), [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851)]:
  - @questpie/admin@3.2.1
  - questpie@3.2.1

## 3.2.0

### Minor Changes

- [#28](https://github.com/questpie/questpie/pull/28) [`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `@questpie/workflows` — durable workflow engine for QUESTPIE.

  **Core Engine**
  - `workflow()` identity factory for type-safe workflow definitions
  - Replay-based execution engine with step caching and non-determinism detection
  - Step primitives: `step.run()`, `step.sleep()`, `step.sleepUntil()`, `step.waitForEvent()`, `step.invoke()`, `step.sendEvent()`
  - Duration parser (s/m/h/d/w), 5 error types, structured workflow logger

  **System Collections**
  - `wf_instance` — workflow instance tracking with status, input/output, timeout
  - `wf_step` — step execution records with replay memoization and match_hash index
  - `wf_event` — event persistence for JSONB-containment matching
  - `wf_log` — structured log entries queryable in admin UI

  **Events & Compensation**
  - Event matching engine with JSONB containment semantics (forward + retroactive)
  - Saga-pattern compensation with reverse LIFO order
  - Child workflow invocation with cascading timeouts
  - `onFailure` handler with `completedSteps` inspection

  **Cron Triggers & Retention**
  - `cron` field on workflow definitions for recurring execution
  - `cronOverlap` policy: `skip` (default), `allow`, `cancel-previous`
  - `RetentionPolicy` for automatic cleanup of old instances/steps/events/logs
  - `match_hash` optimization for O(1) event matching via FNV-1a indexed column

  **Workflow Client**
  - `trigger()`, `cancel()`, `getInstance()`, `getHistory()`, `sendEvent()`
  - `cancelAll()`, `retryAll()` batch operations
  - Idempotency key support, delayed start, parent-child relationships
  - Typed collection/global `transitionStage()` client calls now accept `scheduledAt`

  **Admin UI**
  - Workflow list page with status filters, auto-refresh, trigger dialog
  - Workflow detail page with step timeline, action buttons, log viewer
  - Dashboard stats widget showing active/completed/failed counts
  - Sidebar contribution for navigation

  **Docs & Type Safety**
  - Full durable workflow documentation with typed route, event, cron, admin, and client examples
  - Documented durable workflow instance and step lifecycle transitions with Mermaid diagrams
  - Expanded versioning workflow transition references across CRUD, global, hooks, and HTTP route docs
  - Mermaid architecture diagrams for workflow and docs architecture pages
  - Runtime workflow helpers and admin client routes are strongly typed without unsafe casts

  **Integration**
  - `workflowsPlugin()` codegen plugin for file-convention discovery
  - `workflowsModule` server module with collections, jobs, service, functions
  - `workflowsClientModule` for admin UI pages and widgets
  - Service at `ctx.workflows` via `namespace(null)`
  - `@questpie/admin/client` now exports `page()` and `PageDefinition` for module-provided admin pages

### Patch Changes

- Updated dependencies [[`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead)]:
  - @questpie/admin@3.2.0
  - questpie@3.2.0
