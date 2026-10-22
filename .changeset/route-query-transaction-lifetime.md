---
"questpie": patch
---

Reject SQL issued through a query evaluation's database handle after cancellation or completion, including prepared statements created before cancellation. This prevents a late handler from using a connection returned to another request. Query routes refuse nested transactions and preserve database statement timeouts stricter than their 30-second limit. LIVE locale resolution now uses the same Accept-Language path as a one-shot route call.
