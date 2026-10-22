# Why Autopilot has custom MCP tools beside routes

Inspected 2026-10-22 at Autopilot `f1467cf83f6f945a8aba4deca4905aa77c4bbf1c`
and QUESTPIE v3 `a40b44a62b276262acb0e3c53fc99afc940a4073`. This is source
inspection, not a transport parity test or a migration.

**Finding:** there is historical duplication and meaningful adapter behavior.
Naming granularity does not explain the duplication. Current route projection
already supports custom tool names, descriptions, annotations, per-route OAuth
scopes and workload requirements. Autopilot already configures route MCP
projections for `channels/list` and `workMachines/setEnvironment`.

## The recorded decision

The [September 21 v4 decision](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/docs/decisions/2026-09-21-v4-rewrite-shape.md)
called for one definition projected to HTTP/MCP and recorded 90 tools beside
188 routes. Its status explicitly defers v4 execution. The
[October 14 platform decision](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/docs/decisions/2026-10-14-agent-work-platform.md)
leaves rewriting existing routes into one MCP projection outside that vertical.
The [harness-first decision](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/docs/decisions/2026-10-14-harness-first-delivery.md)
records about 55 operations written twice and requires operation mapping.
These are dated inventories, not a recount of today's files.

That supports the conclusion that cleanup was deferred, not that every separate
tool was a justified framework limitation. It does not establish the motivation
of each original author.

## What existing routes can already do

[RouteMcpMeta](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/questpie/src/server/routes/types.ts)
has `name`, `title`, `description`, `annotations` and explicit `expose`.
[MCP entity policy](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/mcp/src/server/types.ts)
adds per-route execution access, scopes and workload requirements.
[The route adapter](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/mcp/src/server/route-tools.ts)
uses the shared route executor, forwards cancellation and preserves the runtime
request context. [Autopilot's configuration](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/config/mcp.ts)
uses this path selectively. A new naming system is unnecessary to expose
`autopilot.task.assign` from a canonical definition.

## Why simply exposing today's HTTP handlers is insufficient

1. **Authenticated actor/provenance.** The HTTP assignment route derives a
   session user. The MCP tool admits OAuth humans and bounded agent/miniapp
   workloads, derives a command principal and requester run from authenticated
   context, and passes them to the same domain service. These are security facts,
   not caller-supplied parameters. See
   [write-access.ts](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/write-access.ts).
2. **Input contracts differ deliberately.** Task transition's HTTP shape carries
   the full cancellation impact; MCP accepts an acknowledged impact hash and
   reconstructs the remaining facts. Its source explains the reason and a schema
   compatibility restriction. Compare
   [the route](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/routes/tasks/transition.ts)
   with [the tool](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/task-transition.ts).
3. **Results are more than JSON formatting.** The
   [assignment tool](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/task-assign.ts)
   returns selected structured fields plus guidance about dispatch/self-assignment
   and chain-depth refusal; it performs additional reads to produce that guidance.
   Today's generic route adapter
   [serializes the route result](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/mcp/src/server/runtime.ts)
   into JSON text and structured content. It has no equivalent operation-specific
   result presenter.
4. **Product error/refusal behavior.** Autopilot's
   [tool wrapper](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/tool.ts)
   and [error adapter](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/tool-error.ts)
   preserve refusal provenance, safe recovery guidance and logging. The generic
   route error formatter does not implement this product contract.

There is also ordinary drift: assignment's MCP schema adds string bounds and
strictness absent from its HTTP peer, despite a comment calling them identical.
This is evidence for a canonical schema, not proof that either current shape is
the intended contract.

One further granularity gap: current route access receives context/URL params,
not parsed input. MCP discovery evaluates eligibility before target arguments
exist. A canonical operation needs to separate tool discovery eligibility from
invocation authorization over validated/normalized input. Do not call a
resource-specific policy with empty discovery params or repeat target lookups in
both transport wrappers.

## Recommended migration seam

Define one canonical operation input/result/error taxonomy and domain executor.
Resolve authenticated principal/provenance before execution. HTTP and MCP carry
that operation through thin declared projections: transport scope, compatible
input normalization, output presentation and error presentation. Names stay
metadata. Do not duplicate business handlers or schemas to obtain different tool
names or agent-friendly text.

Prefer pure result presenters. If guidance requires database facts, include a
named authorized enrichment in the operation's read plan and declared dependency
set; do not hide extra queries in presentation. Keep side effects in the shared
command, preserve its receipt/transaction ownership, and authorize target-specific
input normalization before reading target facts. Compatibility envelopes can
remain during migration; one operation need not force all existing wire inputs
to become identical on day one.

First migrate assignment and transition with real HTTP/MCP parity cases for a
human, an agent workload, denial, version conflict, replay and cancellation.
Check tool names/scopes, refusal provenance and result guidance as well as domain
state. This separates reusable framework projection hooks from product-owned
policy without disguising a second command implementation as an adapter.
