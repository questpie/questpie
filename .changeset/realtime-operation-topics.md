---
"questpie": patch
"@questpie/tanstack-query": patch
---

Add operation-aware realtime topics for collection `find`, `count`, and `get` queries. Live counts now execute the database count operation and stream a scalar value instead of materializing and transferring the matching records.
