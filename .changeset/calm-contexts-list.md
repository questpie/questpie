---
"@questpie/mcp": patch
"questpie": patch
---

Preserve the full request authority context when MCP discovers generated collection/global tools
and schema resources, so OAuth callers see the same access-filtered catalog as ordinary QUESTPIE
requests. Generated writes for optimistic-concurrency collections now require and forward
`expectedRevision` for update and delete operations.
Consumers can now disable generated relation expansion while keeping relation identifier fields
available for filtering and projection.
Generated collection list tools now apply their documented `sort` input to QUESTPIE `orderBy`.
