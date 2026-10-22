---
"questpie": minor
"@questpie/mcp": minor
---

Use one safe public error shape for HTTP and MCP product operations. MCP product failures now return canonical `{ error }` JSON in a text content block, with the same uppercase product code in `questpie/error` metadata; protocol refusals retain their existing carrier codes. Error responses omit `structuredContent` so SDK clients do not validate them against the success output schema after tool discovery. Production responses omit causes, stack traces, database/hook internals, and invalid field values. Unknown exceptions remain opaque. Internal and hook diagnostic messages, including custom internal translation keys, serialize as generic public errors; the original error retains its diagnostic data server-side.

Route tools preserve original wire input for one shared validation/execution pass and advertise input schemas without applying transforms twice. Product access runs once at invocation with real route parameters. Exposed schemas that cannot describe JSON wire input now fail explicitly; use a representable input schema such as an ISO string piped into date coercion.

The MCP package now requires Zod 4.6.2 or newer for strict JSON Schema conversion with the explicit ISO encoding of Date outputs. Older unsupported schema conversions continue to fail closed.
