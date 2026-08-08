# @questpie/tanstack-db

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

## 3.16.0

### Minor Changes

- Add typed QUESTPIE-backed TanStack DB collections with refetch and snapshot sync.
