---
"questpie": patch
---

Avoid assembling full collection CRUD hook contexts when a local lifecycle phase has no callbacks. Service resolution and namespace projection keep their original order and context, including request-service initialization and disposal. Unused phases no longer materialize lazy tables. Actual local callbacks, global hooks, field hooks and transaction effects retain their existing behavior.
