---
"questpie": minor
---

Add `.ephemeral()` channels for coalesced cursor, typing and presence updates over the shared SSE stream without event or presence database writes. Includes in-process and batched Postgres NOTIFY fan-out, payload limits and fresh access checks during delivery and idle periods.

Batch concurrent PostgreSQL realtime notices in one autocommit without an added delay window, reducing round trips for durable Channels, query invalidations, topology and CRDT as well as ephemeral traffic.
