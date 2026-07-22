---
"questpie": minor
"@questpie/tanstack-query": minor
"@questpie/tanstack-db": minor
---

Add the Realtime v3 snapshot/delta event contract, opt-in native SSE row deltas, transaction-id reconciliation, TanStack Query delta reduction, and the new TanStack DB collection package. Database startup now enforces QUESTPIE's documented PostgreSQL 15 minimum; the realtime xid8 schema still has its explicit PostgreSQL 13 capability preflight.
