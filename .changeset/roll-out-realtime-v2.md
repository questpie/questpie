---
"questpie": patch
---

Add explicit `legacy`, `v2`, and `dual` realtime rollout modes so existing adapters remain compatible, v2 invalidation can be canaried beside an adapter, and rollback is a config-only change with no schema or data loss.

**Breaking behavior:** bulk update and bulk delete now append and publish one logical realtime event per operation instead of one event per affected record. Adapter consumers must handle `bulk_update` / `bulk_delete` and read `payload.count` plus `payload.recordIds` rather than relying on N per-record callbacks.
