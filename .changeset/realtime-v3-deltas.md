---
"questpie": minor
"@questpie/tanstack-query": minor
"@questpie/tanstack-db": minor
---

Add the Realtime v3 snapshot/delta event contract, opt-in native SSE row deltas,
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
- Publish every fixed-group companion against the current Questpie minor train
  instead of retaining a `^3.16.0` peer floor.
- Database startup now enforces QUESTPIE's documented PostgreSQL 15 minimum; the
  realtime xid8 schema still has its explicit PostgreSQL 13 capability preflight.
