# ADR 0019: Freeze semantic kernels and the public surface

> Channel-specific clauses are historical and superseded by
> [ADR-0025](./0025-remove-channels-from-core.md). `defineChannel`, Channel
> payload projection, and `runtime.channelCarrier` are not current or deferred
> public surface.

- Status: Accepted; Channel clauses superseded by ADR-0025
- Date: 2026-08-13

## Context

Accepted tickets P1–P20 left several provisional spellings and could be
implemented as duplicated scalar, relational, durable, Fetch, or infrastructure
kernels. V4 needs one coherent import/export surface without one universal
builder that admits invalid capability combinations.

## Decision

QUESTPIE accepts named `defineKind` constructors, lower-case restricted grammar
namespaces, `createKind` runtime constructors, and precise closed projection
nouns such as `file`.

- One scalar/codec kernel backs `codec.*`, database-capable `field.*`, and the
  compatible embedded-JSONB `value.*` projection. Input, output, Context, Job,
  Reaction, Workflow, and Channel payloads use `codec.*`. Operation composes
  input/output codecs, errors, exposure, and limits; it owns no scalar grammar.
- One relational plan/AST kernel exposes row-returning Query reads under target
  disclosure Policy and boolean-only Policy evidence reads that cannot return
  target rows.
- One durable run/attempt/lease kernel exposes distinct `defineJob`,
  `defineReaction`, and `defineWorkflow` authoring. Workflow extends the
  Current App/Package factory set because exact checkpoint steps and signals
  require that generated contract.
- Route is an authored Resource. Fetch is the generated `app.fetch` Runtime
  entry and has no `defineFetch`. Raw Route ingress has no data facade and enters
  application work through `ctx.execution`.
- `defineChannel` is structural. A Live Query has no constructor; a generated
  Query method gains `.watch` only when compilation proves it watchable.
- `defineService`, `defineCredentialResolver`, `defineContext`, `definePolicy`,
  and `defineSearch` are structural Definitions with compiler-sliced executable
  slots. `file` is a closed Collection projection, not a Definition.

The stable `"questpie"` surface contains the accepted structural builders and
restricted grammars. `"#questpie/app"` and `"#questpie/package"` contain seven
kind-specific executable factories: `defineQuery`, `defineMutation`,
`defineAction`, `defineRoute`, `defineReaction`, `defineJob`, and
`defineWorkflow`. They are restricted projections, not aliases of a universal
signature. `"#questpie/client"` contains `createClient` plus exact generated
client/result/error types and no server factory. A Package `"./questpie"`
export may contain its branded structural and Package-specialized executable
Definitions, Augmentations, and types, but no host Application value or
generated application client.

OpenAPI, MCP, and skill projections have no authoring import. A source-controlled
`questpie.json` `projections` object selects them; `questpie build` emits them,
and `questpie explain projection <openapi|mcp|skills>` explains them.

Optional infrastructure uses four capability-specific `questpie.json` runtime
bindings: `cache`, `wakeBroker`, `channelCarrier`, and `byteStore`. Each points
to one exact Service identity with its own verified contract. There is no
generic provider registry. Cache, broker, and carrier loss fall back or reset
safely; `byteStore` remains outside Mutation/Policy authority.

## Consequences

- Existing `shape`, `value`, `constraint`, `relation`, `relationRef`,
  `dataQuery`, `query`, `index`, `seed`, `mutation`, `context`, and `principal`
  jobs remain available; `index` stays B-tree-only.
- `operation.uuid`, `context.uuid`, and `input.uuid` do not survive as separate
  scalar grammars. Use `codec.uuid`; use `field.uuid` only for stored Fields.
- The app/package factories share implementation kernels while preserving exact
  per-kind contexts. Query cannot opt into retry, Route cannot read `ctx.data`,
  durable work cannot read Request, and Mutation cannot receive byte storage.
- Direct, network, worker, recompute, and Studio paths select the same Resource,
  codec, authority, and Execution Envelope.

## Rejected alternatives

- `define.context` / `define.query` / `define.mutation`.
- `context.define` / `query.define` / `mutation.define`.
- One universal Definition or infrastructure builder with optional methods.
- Separate scalar grammars for Operation, Context, durable input, and output.
- `defineFetch`, a Live Query constructor, or a provider registry.
