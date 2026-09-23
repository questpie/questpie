---
"@questpie/mcp": patch
---

A custom tool call whose arguments fail the input schema now answers `invalid_input` with each rejected field's path and message (`MCP operation failed: invalid input — ops.0.clientPath: …`) instead of the bare sentence. Workload callers (`createWorkloadMcpToolPort`) had no other way to learn which field to fix; the HTTP/stdio server already got the issues from the MCP SDK. A ZodError thrown inside a handler stays opaque.
