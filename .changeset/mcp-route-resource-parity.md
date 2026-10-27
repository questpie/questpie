---
"@questpie/mcp": patch
---

Align the opt-in route schema resource with tool discovery. Route resources now use the same draft-07 schema conversion and tool input envelopes as the listed tools. Functional product access runs only when invoking the route with parsed input and real parameters; resource discovery keeps MCP policy/scope checks and hides statically denied routes.
