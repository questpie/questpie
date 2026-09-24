---
"@questpie/mcp": minor
---

Add MCP prompts. `mcpPrompts(name, { access, scopes, list, get })` defines a prompt provider that a module contributes under `mcp-prompts/` (codegen category `mcpPrompts`), the same way custom tools are contributed under `mcp-tools/`. The server answers `prompts/list` and `prompts/get` per request with the caller's own context, so each caller sees only the prompts they may use; clients such as Claude Code and claude.ai show them as slash commands, and they add nothing to the `tools/list` catalogue.

- `access` and `scopes` are required and gate the whole provider on every request, with the same rule evaluation and OAuth scope gate custom tools use. A denied caller sees none of the provider's prompts, and its `list` and `get` never run.
- `get` returns `null` for a name the caller cannot use. The client receives the same `InvalidParams` "Prompt not found" error as for an unknown name.
- The `prompts` capability is advertised in `initialize` only when at least one provider is released, without `listChanged`. Remote workload servers never serve prompts.
- Both requests run inside the existing execution limits. A provider result the MCP schema rejects fails the request as `internal`.
- `get` may throw `new McpError(ErrorCode.InvalidParams, message)` for missing or invalid arguments; the client receives it as `-32602` with that message. Any other throw stays the opaque `internal`.
- `prompts/list` returns every prompt in one page and never issues `nextCursor`, so any non-empty `cursor` is rejected with `-32602`.
- A provider's `scopes` join the advertised OAuth scope catalogue.

Apps that use the MCP codegen plugin get the new `mcpPrompts` category on their next `questpie generate`.
