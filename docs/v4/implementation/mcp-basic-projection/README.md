# Basic MCP projection tracer tickets

- Status: implemented
- Dependency chain: `HTTP-02 + DOC-01 -> MCP-01 -> MCP-02 -> MCP-03`
- Scope: basic Tools projection only; no resources, prompts, Tasks, Jobs,
  Routes, sessions, retry, fallback, or legacy protocol

## MCP-01 — Compile one documented catalogue

Status: implemented.

Blocked by canonical per-Operation HTTP and Operation Documentation artifacts.
Test-first compile the application opt-in, exact Query/Mutation/Action argument
schemas, canonical outcome schemas, documentation/example mapping, global
application/Package names and collision Origins, independent digest, relocation,
atomic stale deletion, Runtime Build inventory, and explain parity. Installed
but unselected Packages are inert. No authored MCP metadata or Runtime docs join.

## MCP-02 — Execute one modern stateless ingress

Status: implemented.

Blocked by MCP-01. Test-first mount only `POST /_questpie/mcp`; implement exact
2026-07-28 discovery/list/call headers, `_meta`, JSON and request-scoped SSE,
Origin checks, static public catalogue, the one Operation executor, credentials,
Context, Policy, codecs, limits, canonical results, disclosure sanitization and
stream-close cancellation. Prove Query POST does not call Query GET, execution
occurs once, and no retry/fallback/session/MRTR path exists.

## MCP-03 — Hostile tracers, docs, and release closure

Status: implemented. Team Support Desk passes its packed PostgreSQL 17 and
Firefox tracer, including hosted SSE disconnect cancellation of blocked
PostgreSQL work. Collaboration passes credential, codec, Policy
nondisclosure, MCP-originated Mutation response-loss replay, Action admission,
known provider uncertainty, resource-limit and no-retry cancellation, hostile
observation, and application/Package Operation parity through the same Runtime
executor. Focused adapter tests retain serialization-fault evidence.

The completed slice migrates Team Support Desk Query/Mutation/Action and
Collaboration authority hostiles; proves application/Package, direct/HTTP/MCP,
Context, Policy, error, limit, post-commit, Action, adapter-fault, browser, and
PostgreSQL cancellation behavior; and ships the public basic-MCP guide. The
temporary executable prototype is deleted. Release-wide isolation and dry-runs
belong to the aggregate beta.2 candidate rather than a second MCP kernel.
