---
"questpie": patch
---

Prepare each route LIVE snapshot with one SQL statement instead of two: capture its visibility watermark and apply the transaction-local statement timeout together, before resolving context facts or running access rules and the handler. Existing shorter timeouts remain in effect. One-shot query execution and collection/global realtime snapshots keep their existing behavior.
