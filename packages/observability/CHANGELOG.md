# @questpie/observability

## 3.28.7

## 3.28.6

## 3.28.5

## 3.28.4

## 3.28.3

## 3.28.2

## 3.28.1

## 3.28.0

## 3.27.1

## 3.27.0

### Minor Changes

- Align `@questpie/observability` with the QUESTPIE `3.27.0` fixed release train. This is a version-alignment release only; its runtime code is identical to `3.18.1`.

## 3.18.1

### Patch Changes

- [#254](https://github.com/questpie/questpie/pull/254) [`bd75a6b`](https://github.com/questpie/questpie/commit/bd75a6b01f661fe5277d0905ed35acd7db271953) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Validate inbound correlation identifiers and apply one redaction policy to the final effective Pino and OTLP log record, including configured paths that target canonical tagged fields. Structured values now use a canonical inert schema: unsupported values, cycles, and non-finite numbers become explicit markers; Date, URL, Map, Set, and TypedArray values use tagged records; URL credentials and fragments are removed. OpenTelemetry log attributes support the recursive AnyValue contract independently from scalar span and metric attributes.

## 3.18.0

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
