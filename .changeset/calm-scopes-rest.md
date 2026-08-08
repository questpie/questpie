---
"questpie": patch
---

Fix request-scoped services to share one instance across each HTTP request, queue job attempt, or top-level operation and dispose them reliably when that scope ends.
