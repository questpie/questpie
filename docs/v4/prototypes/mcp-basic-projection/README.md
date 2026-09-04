# Basic MCP projection evidence

- Status: archived evidence for Accepted ADR-0038
- Production parity: compiler, Runtime ingress, Team Support Desk, and
  Collaboration tracers
- Scope: derive a model-facing MCP tool catalogue from canonical network
  Operations without re-authoring names, schemas, descriptions, or handlers
- Protocol target: final MCP revision `2026-07-28`

The duplicate executable prototype was deleted after production parity. Pinned
official source: tag `2026-07-28`, commit
`5f5440bb26a62e2cf3440b92da5a667efa03b267`; schema JSON SHA-256
`ef70b61f99b6d2e5e3b46863822eab08dff6a45bedc7a08914e0e5b133f40203`;
schema TypeScript SHA-256
`742750af0bb8c716e7030c4977c992b55d1adc4407e9e66997db5846baedc2cd`.

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

- [MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
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

## Exact exposure decision

`questpie.json` with `{ "projections": { "mcp": true } }` projects every
`network: true` Query, Mutation, and Action. The application-level switch is the
explicit decision to make its already-network-callable Operations model
discoverable. There is no second per-Operation exposure bit.

This is the smallest default and follows the generated-client/OpenAPI rule: one
network exposure decision, several compiler-owned views. A later selective
projection must be justified by a real mixed-exposure consumer; it must not add
duplicate schemas or names.

No per-Operation exposure bit exists. No MCP annotation is authorization. Principal and
Context resolution plus Policy remain the only enforcement path.

## Exact basic tool shape

The object-rooted `inputSchema` has exact generated properties:

```ts
type QueryCall<I, C> = { input: I; context: C; callId?: CallId };
type MutationCall<I, C> = { input: I; context: C; callId: CallId };
type ActionCall<I, C> = {
	input: I;
	context: C;
	effectKey: EffectKey;
	callId?: CallId;
};
```

Both child schemas come from the existing codecs. Empty Context may compile to
an exact empty object but is not silently removed; calls remain structurally
uniform and non-empty typed Context continues to work. Unknown members fail
before Operation execution. Principal, Authority, call identity, credentials,
deadline, and transport metadata are never model arguments.

`outputSchema` is a compiler-owned `oneOf` over the exact closed Operation
outcomes: `{ callId, result }`, declared `{ callId, error }` frames, framework failures,
post-commit uncertainty, and Action ambiguity where applicable. Every child
result/payload schema derives from its existing codec. Success and tool errors
therefore both return schema-valid `structuredContent`; errors additionally set
`isError: true`. The serialized canonical outcome also appears in a text block
as the current protocol recommends, but is not a second result contract.
Input/Context codec validation is a closed tool-execution error. Only an unknown
tool, a malformed `CallToolRequest` envelope, or an MCP server failure uses a
JSON-RPC protocol error.

Mutation call identity and Action effect identity are generated framework
invocation arguments, never domain input. The adapter never retries. Post-commit
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

The ingress is stateless and uses one exact `POST /_questpie/mcp` endpoint.
Discovery and listing are JSON; calls are request-scoped SSE so closing the
response cancels the one Execution. Required modern `_meta` and headers must
match the body. A present `Origin` must match the request URL origin. Query MCP
POST invokes the executor directly; it does not call the canonical Query GET or
the deleted generic Operation route. No session, retry, fallback, MRTR,
Runtime documentation join, or second business executor exists.
