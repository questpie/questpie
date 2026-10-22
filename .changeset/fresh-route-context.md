---
"questpie": patch
---

Pass verified app context extensions directly to JSON and raw route handlers, matching access rules and other framework handlers. Reserved framework arguments take precedence over extension fields. This preserves server-resolved provenance such as requester run IDs when the same route executes over HTTP or MCP.
