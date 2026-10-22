---
"questpie": patch
---

Fix Graphile Worker retired-job cleanup starvation when 500 or more retired jobs remain locked. Cleanup advances through primary-key pages of at most 500 ledger rows per tick, completing unlocked or stale-lock jobs and removing orphans within that page. The cursor wraps after the last page so locked jobs are revisited without scanning the entire backlog on every tick.
