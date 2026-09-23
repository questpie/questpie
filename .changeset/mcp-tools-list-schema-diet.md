---
"@questpie/mcp": patch
---

`tools/list` no longer carries wire noise that zod v4 / the MCP SDK's JSON Schema codec put on every tool's `inputSchema`/`outputSchema`: the top-level `$schema` dialect pointer is dropped (an absent one is universally read as 2020-12), `additionalProperties: false` is dropped everywhere it appears (the SDK always validates call-time arguments against the original zod schema, never against this projected JSON Schema, so removing the annotation changes nothing about what gets rejected), and a `format: "uuid"` sibling is dropped only when a `pattern` sits on the same node (`pattern` is the only one of the pair 2020-12 validators must enforce; when no `pattern` is present, `format` is left alone). Consumers whose `tools/list` catalogue was pushing past a client's byte limit (for example claude.ai connectors, capped around 100,000 B) get a smaller catalogue for the same tool set, with no change to which arguments a call accepts or rejects.
