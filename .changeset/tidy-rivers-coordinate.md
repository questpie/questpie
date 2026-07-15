---
"questpie": minor
---

Add HA-safe Realtime v2 desired-topology control backed by Postgres leases, fencing, revisioned durable state, metadata-only broker wakes, and reconciliation. Postgres apps now default to `PgNotifyChangeBroker`, with `redisStreamsChangeBroker` available as an explicit override. Legacy realtime adapters and rollout modes remain deprecated through QuestPie 3.x and are removed in QuestPie 4.
