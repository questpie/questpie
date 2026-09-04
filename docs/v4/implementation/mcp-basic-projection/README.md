# Basic MCP projection tracer tickets

- Status: accepted design; implementation tickets ready
- Dependency chain: `HTTP-02 + DOC-01 -> MCP-01 -> MCP-02 -> MCP-03`
- Scope: basic Tools projection only; no resources, prompts, Tasks, Jobs,
  Routes, sessions, retry, fallback, or legacy protocol

## MCP-01 — Compile one documented catalogue

Blocked by canonical per-Operation HTTP and Operation Documentation artifacts.
Test-first compile the application opt-in, exact Query/Mutation/Action argument
schemas, canonical outcome schemas, documentation/example mapping, global
application/Package names and collision Origins, independent digest, relocation,
atomic stale deletion, Runtime Build inventory, and explain parity. Installed
but unselected Packages are inert. No authored MCP metadata or Runtime docs join.

## MCP-02 — Execute one modern stateless ingress

Blocked by MCP-01. Test-first mount only `POST /_questpie/mcp`; implement exact
2026-07-28 discovery/list/call headers, `_meta`, JSON and request-scoped SSE,
Origin checks, static public catalogue, the one Operation executor, credentials,
Context, Policy, codecs, limits, canonical results, disclosure sanitization and
stream-close cancellation. Prove Query POST does not call Query GET, execution
occurs once, and no retry/fallback/session/MRTR path exists.

## MCP-03 — Hostile tracers, docs, and release closure

Blocked by MCP-01 and MCP-02. Migrate Team Support Desk Query/Mutation/Action and
Collaboration authority hostiles. Prove application/Package parity, direct/HTTP/
MCP outcome parity, non-empty Context, Policy nondisclosure, invalid input,
declared/framework failures, post-commit Mutation replay, Action ambiguity,
adapter faults and browser/official-client cancellation against PostgreSQL 17.
Write public basic-MCP docs, run release isolation/dry-runs, then delete this
prototype. Do not broaden the accepted beta.2 surface.
