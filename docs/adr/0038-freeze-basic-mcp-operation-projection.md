# ADR-0038: Freeze the basic MCP Operation projection

- Status: Proposed
- Date: 2026-09-01
- Owners: Product architecture, compiler, Runtime ingress
- Protocol target: MCP `2026-07-28` (`5f5440bb26a62e2cf3440b92da5a667efa03b267`)

## Context

ADR-0018 accepts MCP as a compiler projection of selected App Contract members
that invokes the existing Operation adapter. It forbids another handler,
authorization, or observability path but leaves the public spelling, catalogue,
schema, outcome, and transport mapping open.

The compiler already knows each network Operation's kind, Qualified Resource
Name, input/output/error codecs, Context codec, limits, Origin, and exposure.
Asking authors to repeat tool names, JSON Schemas, descriptions, or handlers
would create drift and defeat the projection boundary.

## Proposed decision

Exact application config `{ "projections": { "mcp": true } }` enables one MCP
`2026-07-28` Streamable HTTP endpoint at `POST /_questpie/mcp`. Missing selection
emits and mounts nothing. The switch projects every `network: true` Query,
Mutation, and Action; no per-Operation `mcp` member or compatibility spelling
exists in the basic slice.

Tool names are compiler-derived as `<kind>.<qualified-name>`, for example
`query.tickets.list`, `mutation.tickets.assign`, and `action.exportReport`.
They preserve dots and case, satisfy the MCP 1–128 character grammar, sort by
ASCII bytes, and are globally unique across application and Package
contributions. Unsupported identities and collisions fail with both Origins;
there is no alias or source-order winner.

The compiler consumes the App Contract and ADR-0040 Operation Documentation
artifact. It emits no duplicate domain metadata. `title` is `summary`;
`description` is `summary` or `summary + "\n\n" + description`; input examples
annotate the nested input schema and output examples annotate only the success
result schema. Its independent digest pins the Operation Contract and Operation
Documentation digests. Origins affect diagnostics, never semantic bytes.

Generated tool arguments are exact and disjoint:

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

These are framework invocation arguments, not domain input. Mutation requires a
caller-known `callId` because response loss must remain replayable. Action
requires a caller-known `effectKey`; `callId` remains optional. Principal,
credentials, Authority, deadline, transport state, and cancellation signals are
never model arguments.

The tool `outputSchema` is a compiler-owned closed `oneOf` over the exact
canonical Operation frames: `{ callId, result }`, declared `{ callId, error }`
frames, applicable framework failures, committed-result uncertainty, and
Action ambiguity. It invents no `{ kind }` envelope. Success and tool-execution
errors return conforming `structuredContent` plus the same canonical JSON in a
text block; errors set `isError: true`. Unknown tools, malformed MCP envelopes,
and MCP server protocol failures alone use JSON-RPC errors. No adapter retry,
fallback, or legacy route exists.

The compiler emits only `readOnlyHint: true` for Query. Mutation and Action omit
risk annotations so the protocol's conservative defaults apply. No annotation,
description, tool-list membership, model confirmation, or MCP credential scope
grants Authority or replaces Policy. The catalogue is build-deterministic and
does not evaluate input-dependent Policy or disclose Policy evidence.

Every call creates a fresh accepted Execution and reuses Context resolution,
Principal, Policy, limits, codecs, transactions, receipts, errors, cancellation,
nondisclosure, and the Execution Envelope. MCP owns transport decode/encode
only. A Query tool call is MCP `POST`; it invokes the one executor directly and
does not loop through the canonical Query `GET` or an old generic Operation
route. Raw Routes, Jobs, durable maintenance, Tasks, resources, prompts,
sampling, elicitation, and skills are outside this basic slice.

## Exact protocol and failure boundary

The one endpoint is stateless: there is no initialize/session flow.
`server/discover`, `tools/list`, and `tools/call` require the `2026-07-28`
request `_meta`, `MCP-Protocol-Version`, and matching `Mcp-Method`; calls also
require matching `Mcp-Name`. Discovery and list return JSON. Calls return one
request-scoped SSE stream whose final event has `resultType: "complete"`.
Closing that response stream cancels the one Execution; the server emits no
`notifications/cancelled`, retries nothing, and fabricates no result after an
ambiguous transport loss. `inputResponses` and `requestState` are rejected; the
basic slice never returns `input_required`.

Absent `Origin` is allowed for non-browser clients. A present `Origin` must
exactly match the request URL origin before credentials or execution; mismatch
is a value-free HTTP 403. Unsupported versions are `-32022`/400 with only the
requested and supported versions. Header/body ambiguity is `-32020`/400 without
echoing credentials or payloads. Parse and invalid-request failures disclose no
codec, Policy, PostgreSQL, stack, or handler detail. Declared/framework
Operation outcomes remain tool results, preserving direct/network/MCP parity.

`tools/list` is one deterministic public catalogue with `ttlMs: 0` and
`cacheScope: "public"`. Listing evaluates neither Principal nor Policy. The App
opt-in already makes every selected network Operation discoverable; Policy is
evaluated only for a concrete call. Runtime reads the compiled MCP catalogue;
it never joins the Operation Documentation artifact.

## Artifact and explain boundary

The compiler emits a canonical MCP catalogue/runtime binding artifact pinned to
App Contract, codec, Context, Operation outcome, and protocol digests. Selected
builds include its digest and endpoint binding in Runtime Build inventory and
checksums. Atomic replacement deletes stale bytes. `questpie explain projection
mcp` reports selection, included/omitted identities and Origins, tool names,
source digests, and omission reasons without credentials, Context values,
Policy evidence, payloads, handler source, or database detail.

## Supersession and consequences

This is additive Product realization of ADR-0018 under ADR-0027. It supersedes
only directionally approved research that proposed a per-Operation `mcp` object
with repeated name/description/safety metadata. It does not supersede the MCP
protocol, Operation kernel, credential resolver, Context, Policy, or Network
exposure. If a real consumer later requires a selective catalogue, that focused
decision must preserve one metadata/schema owner and cannot silently change the
basic default.

## Acceptance

Ratification requires independent Product review and executable evidence for:

1. exact tool-name grammar, ordering, application/Package collision Origins,
   source digests, checksums, relocation, stale deletion, and explain parity;
2. codec-exact JSON Schema 2020-12 input and closed output outcomes, including
   non-empty Context, lists, nullability, branded wire scalars, and disjunctions;
3. a current-protocol MCP client calling Team Support Desk Query, Mutation, and
   Action through the same executor with direct/network result parity;
4. Collaboration hostiles for credentials, Policy nondisclosure, invalid input,
   declared/framework errors, limits, cancellation, Mutation replay and
   post-commit uncertainty, Action ambiguity, adapter faults, and disclosure;
5. absence of per-Operation MCP authoring, alternate handlers, Policy-derived
   annotations, automatic retry, protocol fallback, and out-of-scope MCP
   capabilities.

ADR-0038 remains Proposed until that evidence and review pass. Accepted ADR
index, SPEC, CONTEXT, public docs, and HANDOFF must not project it early.
