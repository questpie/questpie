---
"questpie": minor
---

Collections can opt out of realtime change capture with `.options({ realtime: { changeCapture: false } })`. Their mutations write no `questpie_realtime_log` row and return no `txid`, which removes the outbox cost of high-churn rows nothing watches live (heartbeats, idempotency ledgers). Because such a collection produces no change events, realtime admission refuses every topic that would need them with the new `collection_change_capture_disabled` reason: a direct topic, and a topic whose `with`, `where` or read access predicate reaches the collection. The default is unchanged, and `realtime: false` keeps its meaning (direct topics refused, capture kept).
