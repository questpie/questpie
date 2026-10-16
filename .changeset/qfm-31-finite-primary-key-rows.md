---
"questpie": patch
---

Add backend `findRows({ ids, limit, where })` for finite primary-key acquisition through per-key LATERAL reads while retaining normal access, full decoded rows, hooks and transaction context. Apply global ordering and limit after the complete authorized key set, and fail explicitly for unsupported localized/versioned/projected/populated reads.
