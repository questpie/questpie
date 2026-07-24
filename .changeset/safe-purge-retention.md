---
"questpie": minor
"@questpie/admin": minor
"@questpie/openapi": minor
"@questpie/tanstack-query": minor
---

Add a separately authorized physical-purge lifecycle for soft-delete collections.

- Expose typed `purgeById` server, HTTP, browser client, OpenAPI, and TanStack Query surfaces without adding a force-delete alias.
- Require an explicit `purge` access rule, reject active rows, hide denied or missing targets behind the same not-found result, and run dedicated fatal purge hooks transactionally.
- Block retained relations instead of converting soft-delete cascades into destructive cascades.
- Integrate committed purge with audit, realtime, Search, upload cleanup, and collaborative-resource retention boundaries.
- Add a bounded high-water/keyset retention recipe and a fail-closed real PostgreSQL benchmark harness.
