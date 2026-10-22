---
"questpie": minor
---

Add `.ephemeral()` channels for coalesced cursor, typing and presence updates over the shared SSE stream without event or presence database writes. Includes in-process and batched Postgres NOTIFY fan-out, payload limits and fresh access checks during delivery and idle periods.

Batch concurrent PostgreSQL realtime notices in one autocommit without an added delay window, reducing round trips for durable Channels, query invalidations, topology and CRDT as well as ephemeral traffic.

Reduce durable channel overhead by batching authority-generation reads per channel, retaining exact per-frame fence admission, avoiding duplicate wake drains, and encoding each pending frame once. Fold redundant queued outbox/channel-event wake hints while preserving topology and CRDT notices.

Renew shared SSE topology leases in bounded PostgreSQL batches, retaining exact owner/generation and client-liveness checks while preventing overlapping heartbeat loops and stale results from closing replacement connections.
