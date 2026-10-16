---
"questpie": patch
---

Add content-free backend realtime invalidation subscriptions so authoritative row waiters can wake on a broker notice while an older transaction still holds back ordered outbox delivery. Async callbacks coalesce, retain existing reconciliation and release pending work on unsubscribe or shutdown.
