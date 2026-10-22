---
"questpie": patch
---

Prevent maximum-age LIVE refreshes from repeatedly discarding authorized evaluations under load. Age deadlines remove pending old snapshots and request a fresh check; actual authority events still fence in-flight work. Coherent evaluations also absorb dependency wakes received before their compute slot starts, rather than running a redundant snapshot afterward. This preserves fresh authorization and the documented queue/evaluation component of the revocation bound, without caching permission results.
