# Basic MCP projection research

- Status: research prototype; not Accepted authority
- Scope: derive a model-facing MCP tool catalogue from canonical network
  Operations without re-authoring names, schemas, descriptions, or handlers
- Protocol target: final MCP revision `2026-07-28`

## Authority and current protocol

ADR-0018 requires MCP to be a compiler projection of selected App Contract
members. Invocation must reuse the one Operation executor, fresh Execution,
Context, Policy, limits, errors, cancellation, and Execution Envelope. MCP owns
no handler and annotations grant no authority.

The current MCP Tools contract permits dots in unique 1–128 character tool
names, uses JSON Schema 2020-12 for input and output schemas, and treats tool
annotations as untrusted hints. Input remains object-rooted; the final
`2026-07-28` revision permits arbitrary JSON output schemas and matching
`structuredContent`:

- [MCP tools](https://modelcontextprotocol.io/specification/draft/server/tools)
- [2026-07-28 revision](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [JSON Schema 2020-12](https://modelcontextprotocol.io/seps/1613-establish-json-schema-2020-12-as-default-dialect-f)

## The no-duplication rule

Authors already provide Resource Kind, Qualified Resource Name, `network: true`,
input/output/error codecs, and projection-neutral summary/description/example
metadata. MCP must not ask for another tool name, description, input schema,
output schema, error schema, or handler.

The compiler derives:

| Operation                 | MCP tool name             |
| ------------------------- | ------------------------- |
| Query `tickets.list`      | `query.tickets.list`      |
| Mutation `tickets.assign` | `mutation.tickets.assign` |
| Action `exportReport`     | `action.exportReport`     |

The kind prefix prevents a Query and Mutation with the same Qualified Resource
Name from colliding. Names outside MCP's current lexical/length contract fail at
the Operation Origin. There is no rewritten alias or compatibility name.

## Two KISS exposure candidates

### A — one application-level opt-in (recommended for the basic slice)

`questpie.json` with `{ "projections": { "mcp": true } }` projects every
`network: true` Query, Mutation, and Action. The application-level switch is the
explicit decision to make its already-network-callable Operations model
discoverable. There is no second per-Operation exposure bit.

This is the smallest default and follows the generated-client/OpenAPI rule: one
network exposure decision, several compiler-owned views. A later selective
projection must be justified by a real mixed-exposure consumer; it must not add
duplicate schemas or names.

### B — add `mcp: true` to every selected Operation

This separates browser discoverability from model discoverability, but authors
repeat an exposure decision on every member and packages cannot provide a good
default without application overrides. The basic slice rejects this candidate
unless hostile evidence proves the application-level boundary insufficient.

Neither candidate treats an MCP annotation as authorization. Principal and
Context resolution plus Policy remain the only enforcement path.

## Exact basic tool shape

The object-rooted `inputSchema` has exact generated properties:

```ts
type ToolArguments<Input, Context> = {
	input: Input;
	context: Context;
};
```

Both child schemas come from the existing codecs. Empty Context may compile to
an exact empty object but is not silently removed; calls remain structurally
uniform and non-empty typed Context continues to work. Unknown members fail
before Operation execution. Principal, Authority, call identity, credentials,
deadline, and transport metadata are never model arguments.

`outputSchema` is the exact output codec schema. Success returns the canonical
result as `structuredContent`; a compact JSON text block may accompany it for
older presentation clients but is not a second result contract. Declared and
framework Operation failures return `isError: true` with a closed structured
error value. Only malformed MCP protocol, unknown tool, and arguments that do
not match the published tool schema use JSON-RPC protocol errors.

Mutation call identity and Action effect identity remain framework-owned MCP
invocation metadata. The adapter never retries automatically. Post-commit
Mutation uncertainty and Action ambiguity retain their accepted recovery
identities and retry semantics in the structured tool error.

## Conservative annotations

The compiler may safely emit `readOnlyHint: true` for Query because the Query
kernel has no write/effect capability. For Mutation and Action it emits no risk
booleans in the basic slice, so MCP's cautious defaults apply. It does not infer
`destructiveHint`, `idempotentHint`, or `openWorldHint` from names, Policy,
receipts, or handler source. A later projection-neutral effect classification
needs its own executable consumer and cannot become Policy.

## Required proof before ratification

1. byte-stable tools/list catalogue, source digests, explain parity, stale-file
   deletion, and relocation;
2. exact tool names and cross-kind/cross-package collision diagnostics;
3. codec-derived object input and arbitrary JSON output schemas with
   discriminated-union coverage;
4. non-empty Context, credentials, Policy nondisclosure, limits, cancellation,
   declared errors, committed-result uncertainty, and Action ambiguity through
   the same Operation executor;
5. no authored schemas/names/descriptions, second handler, retry fallback,
   annotation authority, raw Route, Job control, Task augmentation, resources,
   prompts, sampling, or unrelated MCP capability;
6. a real current-protocol MCP client tracer against Team Support Desk and
   hostile Collaboration calls.

The HTTP transport decision remains a separate superseding boundary. MCP uses
one MCP transport endpoint as required by its protocol; it does not call or
re-export the canonical HTTP paths and does not create another business
executor.
