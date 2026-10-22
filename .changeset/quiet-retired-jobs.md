---
"questpie": patch
---

Fix Graphile Worker retired-job cleanup starvation when 500 or more retired jobs remain locked. Cleanup advances through primary-key pages of at most 500 ledger rows per tick, completing unlocked or stale-lock jobs and removing orphans within that page. Each pass includes every bigint ID, freezes its highest ID and wraps at that endpoint, so locked jobs and rows inserted behind the cursor are revisited even while higher IDs keep arriving.
