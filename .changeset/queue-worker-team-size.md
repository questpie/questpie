---
"questpie": minor
---

Honor queue listener `teamSize` with pg-boss's `localConcurrency` option, allowing multiple workers to execute jobs while an earlier handler is still running. Preserve the default worker count and per-job failure handling.

Existing `teamSize` values now take effect per job name after upgrading; a listener configured with `teamSize: 5` starts five workers instead of one. Use positive integers. Undefined listener options are omitted so the broker can apply its defaults.

Use pg-boss per-job batch results to prevent an older batch from completing a retry already running on another worker. The pg-boss peer floor is now 12.21.0, which provides both `localConcurrency` and `perJobResults`.

Adapter construction rejects an incompatible installed pg-boss version before starting the database pool or accepting jobs, rather than silently completing handler failures if `perJobResults` is unavailable.
