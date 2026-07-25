---
"@questpie/sandbox": minor
"@questpie/mcp": minor
---

Fail-closed remote workload authority across sandbox and MCP.

- **sandbox**: add a generic, consumer-authorized workload admission path with
  signed single-use transport binding, strict resource limits, canonical broker
  routing, safe audit events, and no product-specific principal model.
- **mcp**: require explicit catalog entries for every CRUD operation, route,
  resource, and custom tool; derive OAuth scopes from that same catalog and
  re-authorize discovery and invocation through scopes, RBAC, and an opaque
  workload authorizer.
- Remove ambient stdio system authority and retire the private executor package;
  sandbox execution remains available through QUESTPIE's core executor service.
