---
"questpie": patch
---

Fix LIVE subscriptions with large route inputs or collection filters being rejected by the topology ID limit. SSE and Pusher clients now allocate compact wire IDs per active topic while deduplicating by the complete normalized topic, including typed Dates. IDs survive reconnects and are released with the last observer. The 512-character ID limit and 262144-byte topology envelope limit remain enforced; route results and authorization are still evaluated per binding.
