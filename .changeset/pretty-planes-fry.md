---
"@questpie/sandbox": minor
"@questpie/mcp": minor
---

Fail-closed remote workload authority across sandbox and MCP.

- **sandbox**: add a generic, consumer-authorized workload admission path with
  signed single-use transport binding, strict resource limits, canonical broker
  routing, safe audit events, and no product-specific principal model. Sandboxed
  guests can list and invoke an explicitly bound subset of application MCP custom
  tools through opaque, revocable, bounded host sessions; guests never receive
  the application, database, authorizer, or native broker token.
- **mcp**: require explicit catalog entries for every CRUD operation, route,
  resource, and custom tool; derive OAuth scopes from that same catalog and
  re-authorize discovery and invocation through scopes, RBAC, and an opaque
  workload authorizer. Apply shared input/output, depth, node, deadline,
  cancellation, catalog-size, global-concurrency, and per-principal-concurrency
  bounds across HTTP, stdio, resources, and direct workload tool calls while
  keeping public errors disclosure-safe.
- Retire the unsupported `@questpie/ai` workspace runtime and its
  worker/fleet/Harness/provider application model. Historical npm versions remain
  available, but QUESTPIE does not publish a compatibility stub.
- Remove ambient stdio system authority and the private executor spike; sandbox
  execution remains available through QUESTPIE's core executor service.
