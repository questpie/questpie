---
"questpie": minor
---

Framework fixes bundled from the production-readiness work:

- **Routes:** `executeJsonRoute` no longer crashes on an output-only route (a route declared with `.outputSchema()` and no `.schema()`, whose input is typed `unknown`) — it now passes the raw input through instead of calling `.parse` on an undefined input schema.
- **Codegen:** app-level collections now override module-provided collections that share the same key, so a project can specialise a collection a module contributed without a key collision.
- **Admin (audit):** the audit-log diff coerces `Date` and other non-JSON values into JSON-safe forms, so audit entries no longer fail to serialise on records containing dates or class instances.
