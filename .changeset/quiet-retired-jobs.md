---
"questpie": patch
---

Fix Graphile Worker retired-job cleanup starvation when 500 or more retired jobs remain locked. Each cleanup batch now selects only unlocked jobs or jobs past Graphile's native four-hour lock timeout, so other retired jobs are removed on the next schedule tick.
