# Semantic kernels and public surface

ADR-0019 closes atlas ticket #21. Public names describe ownership: named
constructors define Resources, lower-case namespaces build restricted values,
and generated modules specialize executable code to one exact contract.

## One kernel, several valid views

| Job                         | Public view          | Shared owner                                     |
| --------------------------- | -------------------- | ------------------------------------------------ |
| operation input/output UUID | `codec.uuid()`       | scalar/codec kernel                              |
| stored UUID                 | `field.uuid(...)`    | same scalar identity plus database capabilities  |
| embedded JSONB UUID         | `value.uuid()`       | compatible restricted codec projection           |
| disclosure read             | generated `ctx.data` | relational plan plus target Policy               |
| Policy evidence             | `policy.exists(...)` | same plan, boolean-only projection               |
| explicit work               | `defineJob`          | durable run/attempt/lease kernel                 |
| committed-fact work         | `defineReaction`     | same durable kernel plus causation/deduplication |
| checkpointed work           | `defineWorkflow`     | same durable kernel plus versioned `ctx.step`    |
| raw protocol                | `defineRoute`        | Fetch execution kernel                           |
| server entry                | `app.fetch`          | same Fetch kernel; no `defineFetch`              |

Restricted projections prevent invalid combinations. Query has read capability
and no retry. Route receives Request, parameters, Principal, cancellation,
deadline, Route-safe Services, and `ctx.execution`; it has no data facade or
transaction. Job and Reaction receive run/attempt/retry state but no Request.
Workflow adds only the accepted checkpoint commands. File byte storage is a
Route capability, never a Mutation or Policy capability.

## Choose the owner of application work

| Work                                           | Owner       | Boundary                                                                |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| Canonicalize caller input without I/O          | `normalize` | Closed pure program inside the owning Operation lifecycle               |
| Supply a trusted server value                  | `values`    | Closed assignment from input or immutable Execution facts               |
| Read or derive an authorized result            | Query       | One Policy-aware read snapshot                                          |
| Decide whether a principal may perform work    | Policy      | Pure authorization decision over explicit subject, resource, and facts  |
| Validate application state or write atomically | Mutation    | One PostgreSQL transaction, including audit and durable acceptance      |
| Call an external or nondeterministic provider  | Action      | Explicit effect outside transaction retry                               |
| Adapt an HTTP request and response             | Route       | Transport boundary that delegates state and effects to Operations       |
| React to one exact committed fact              | Reaction    | Durable committed-fact causation with no independent producer           |
| Accept explicitly requested background work    | Job         | Durable dispatch with scoped idempotency and optional delay or schedule |
| Coordinate checkpointed multi-step work        | Workflow    | Durable named Mutation/Action steps, timers, and typed signals          |
| Observe a changing authorized read             | Live Query  | Re-evaluated Query result driven by committed invalidation              |

This map is the permanent v4 guide for work ownership. The v3 hook crosswalk is
historical evidence, not a public lifecycle API. Reaction, Job, and Workflow
remain distinct authoring meanings over one internal durable kernel.

## Imports

Use `"questpie"` for stable structural builders and grammars, including
`codec`, `field`, `value`, `shape`, `constraint`, `relation`, `dataQuery`,
`query`, `policy`, `operation`, `mutation`, `durable`, `defineCollection`,
`defineContext`, `definePolicy`, `defineService`,
`defineCredentialResolver`, `defineSearch`, and `file`.

Use `"#questpie/app"` for application-specialized `defineQuery`,
`defineMutation`, `defineAction`, `defineRoute`, `defineReaction`, `defineJob`,
`defineWorkflow`, `createApp`, and exact generated types. A Package uses the
same seven factory names from `"#questpie/package"`, specialized only to its
sealed Package Contract. Its `"./questpie"` export may contain branded
structural and executable Definitions, Augmentations, and types.

Use `"#questpie/client"` for `createClient` and exact generated client types.
It exports no server factory. Search is an ordinary generated Query member;
File lifecycle calls are ordinary Mutation members plus a bounded generated
upload helper.

Generated server Operation capability maps use nested-only calls such as
`ctx.actions.delivery.sendMessage`. Canonical Resource Identity, manifests,
receipts, references, CLI, Studio, external projections, and direct client/App
maps retain exact `<kind>:<qualified-name>` keys. A compiler diagnostic rejects
same-kind leaf/prefix collisions and a final Operation segment named `then`
before emitting the nested map.

These server Operation maps are frozen null-prototype objects. Names such as
`constructor` and `prototype` are ordinary own members, not inherited Object
helpers.

## Realtime and generated projections

Live Query is a compiler-earned projection: compilation adds `.watch` to the
same generated Query method when the Query's dependencies are supported. It
does not create another authorization path or a generic event transport.
Transient provider signals remain ordinary application integration.

OpenAPI, MCP, and skill bundles export no authoring factory. Configure their
selection under `questpie.json` `projections`, emit them with `questpie build`,
and inspect provenance and omissions with
`questpie explain projection <openapi|mcp|skills>`.

## Optional runtime capabilities

`questpie.json` uses distinct `runtime.cache`, `runtime.wakeBroker`, and
`runtime.byteStore` bindings. Values name exact Service identities; they are
not provider names or a registry.

- no cache means no shared cache and safe local reset;
- no wake broker means PostgreSQL polling plus `NOTIFY` recovery;
- File production requires byte storage, while `questpie dev` may bind the
  filesystem implementation and production may bind S3-compatible storage.

Framework-consumed capability Services do not appear in ordinary handler
Context, and committed configuration contains no credentials.

## Accepted proof

The initial clean reviewed head `1785809aeed4f517f5182c5fc3fffd5802433181`
received `BLOCKED`. Repair head
`0f44e985cf897a499cae6801966a2467c1e09b68` removed the Package Workflow
`step.query` widening and named all four optional Runtime bindings. One fresh
stateless Opus-medium replacement review returned `PASS`; acceptance evidence
is `d50d4334b116a5bdc46e95cdabf566d8db938d37`.

That proof record remains historical. ADR-0025 supersedes its Channel factory
and fourth carrier binding; the current surface above has three optional
Runtime bindings and no generic realtime-event Resource.

The proof compiles a complete application and isolated Package, exact negative
imports and invalid combinations, autocomplete and hover, a relocated
typecheck, and bounded generated declarations. Real implementation must emit
those declarations from compiler input and carry the accepted P17–P20 hostile
edges forward.
