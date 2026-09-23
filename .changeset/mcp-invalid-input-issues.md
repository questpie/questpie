---
"@questpie/mcp": patch
---

A custom tool call whose arguments fail the input schema now answers `invalid_input` with each rejected field's path and message (`MCP operation failed: invalid input — ops.0.clientPath: …`, at most eight issues, 4 KB) instead of the bare sentence. Workload callers (`createWorkloadMcpToolPort`) had no other way to learn which field to fix. Over HTTP/stdio the MCP SDK already reported most of these; failures only the real schema catches (transforms, dates, defaults the advertised schema relaxes) now carry the same detail. Messages written in `refine`/`superRefine` are returned as-is, so they must not contain server data. A ZodError thrown inside a handler stays opaque.
