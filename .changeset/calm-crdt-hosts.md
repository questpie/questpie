---
"questpie": minor
"@questpie/crdt-yjs": minor
---

Add collection-wide collaborative aggregates with typed text and set fields.

- Declare collaborative owners and fields with `.collaborative()` and `.crdt()`, then consume their generated, fully typed client and server APIs.
- Synchronize CRDT bytes through bounded Fetch routes while reusing the existing SSE or Pusher realtime session for opaque dirty hints, with no adapter-specific host or second provider connection.
- Preserve aggregate-wide atomic transactions, fresh field-level authorization, lifecycle fencing, idempotent retry, offline IndexedDB recovery, and bounded awareness rosters.
- Publish Yjs text engines for browser and server use from `@questpie/crdt-yjs`; its worker entry remains private package runtime machinery, and its bounded pool drains and terminates with application shutdown.
