---
"@questpie/admin": patch
"@questpie/openapi": patch
---

Improve admin UI performance and preview stability while tightening React Doctor checks.

- Reduce stale state updates, redundant render work, and unnecessary layout churn in admin views and preview flows.
- Add safer collection and relation query guards when collection names are not yet resolved.
- Restore the OpenAPI root package export for `openApiModule` and config helpers.
