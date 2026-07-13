---
"questpie": patch
---

Bound the realtime outbox with a three-day default retention window, remove unsafe process-local watermark deletion, store scalar pre/post routing projections instead of hydrated records, and remove redundant indexes. Existing applications should run `bun questpie migrate:generate` to generate the two index drops.
