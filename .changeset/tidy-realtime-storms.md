---
"questpie": patch
---

Harden PostgreSQL realtime coordination and storage.

- Bound and coalesce topology reconciliation work while exposing terminal reconcile outcomes.
- Fence superseded reconnect streams so admission slots cannot leak or be reused to bypass per-principal limits.
- Recover pg-notify listeners cleanly after a PostgreSQL connection terminates, and bound serialized NOTIFY work across shutdown.
- Store realtime payloads, presence data, and desired topology as native JSONB with Bun SQL.
- Replay exact SSE and Pusher topology after reconnect, bound dirty-notice queues with latest-wins reconcile semantics, and fence owner takeover with provider liveness checks.
- Route targeted query and collaborative-document invalidations below an 8 KiB framework budget and 128-target cap, leaving serialization headroom beneath the provider's <10 kB ceiling and QUESTPIE's exact 10,000-byte application-event cap; overflow falls back to generic reconcile instead of dropping invalidation or creating a refresh herd.
