---
"questpie": minor
---

Declare read-only routes with `.query()`. Each evaluation uses a repeatable-read transaction for access, handler execution, output validation and request-derived context facts, with a fresh request-service scope. Queries require input/output schemas, an explicit access rule and an explicit request context; they never inherit standalone system access or join an ambient transaction. Ordinary routes retain their transaction ownership.

JSON route access rules receive parsed input. Framework services take precedence over context-extension collisions in JSON/raw route access and handlers. LIVE dependency metadata can be declared on query routes; watch transport support follows separately.
