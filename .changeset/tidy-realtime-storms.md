---
"questpie": patch
---

Harden PostgreSQL realtime coordination and storage.

- Bound and coalesce topology reconciliation work while exposing terminal reconcile outcomes.
- Fence superseded reconnect streams so admission slots cannot leak or be reused to bypass per-principal limits.
- Recover pg-notify listeners cleanly after a PostgreSQL connection terminates, and bound serialized NOTIFY work across shutdown.
- Store realtime payloads, presence data, and desired topology as native JSONB with Bun SQL.
