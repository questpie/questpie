---
"@questpie/workflows": patch
---

Return the existing instance when simultaneous triggers race on the same idempotency key. Both the workflow client and HTTP trigger route now share the same duplicate-handling path, and unrelated creation failures still propagate.
