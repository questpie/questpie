# QUESTPIE v4 developer API inventory

- Status: documentation workbench; not reader-facing product documentation
- Purpose: keep one candidate spelling per developer job while the design-
  fiction guide is being written
- Rule: `accepted` names are authority-backed; `candidate` names may change and
  require the listed proof before public projection

## Accepted foundation

| Developer job                   | Current spelling                                                          | Status   | Type source                                                | Proof/authority               |
| ------------------------------- | ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- | ----------------------------- |
| define a regular Collection     | `defineCollection({...})`                                                 | accepted | local Field/Constraint/Relation literals                   | ADR-0008 and proof `d03358b7` |
| define scalar/open JSON Fields  | `field.*(...)`                                                            | accepted | local Field factory                                        | ADR-0008                      |
| group ordinary column Fields    | `shape.inline({...})`                                                     | accepted | nested literal                                             | ADR-0008                      |
| define typed JSONB values       | `field.object(value.object(...))`, `field.array(...)`                     | accepted | closed `value.*` grammar                                   | ADR-0008                      |
| define a named PK               | `constraint.primaryKey({ fields: [...] })`                                | accepted | bound Collection Field keys                                | ADR-0008                      |
| define owning/inverse Relations | `relation.toOne(...)`, `relation.toMany({ inverseOf: relationRef(...) })` | accepted | exact Collection/Relation references                       | ADR-0008                      |
| define a structural data plan   | `dataQuery<AppData["collections"][N]>()({...})`                           | accepted | generated bounded Collection descriptor plus local clauses | ADR-0008 and proof `d03358b7` |
| build structural expressions    | `query.parameter.*`, `query.and/or/not`, typed Field/Relation methods     | accepted | local parameter map and generated descriptor               | ADR-0008                      |

Reader prose calls `dataQuery` a **structural data plan** to distinguish it from
a named semantic Query without renaming the accepted API.

ADR-0009 and proof `713485a6` also accept the application-layer compiler
mechanics: six factories from the Current App Contract, one Executable Slot per
handler, current-build output rounds and cycle pins, Package isolation,
Collection Operation Set expansion, Runtime Build pairing, Origins,
determinism, freshness, and budgets.

## Current candidate application layer

| Developer job                        | One current candidate                                                   | Owner                                                    | Exact type source                                              | Still needs proof                                            |
| ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| declare root Execution context       | `defineContext({ input, resolve })`                                     | Context Definition                                       | local input plus exact `bootstrap.get(Collection, ...)` calls  | bootstrap authority, output codec, lifecycle, compiler split |
| scope an immutable client            | `client.withContext({ companyId })`                                     | generated client                                         | compiled Context input                                         | wire protocol, SSR/concurrency, reconnect                    |
| direct root execution                | `app.execution({ principal, context }, callback)`                       | Runtime Execution                                        | generated Context input and App Contract callback              | Authority construction, disposal, cancellation               |
| attach Collection authorization      | `definePolicy(collection, body)`                                        | Policy Resource                                          | the exact Collection first argument                            | executable contextual typing and artifacts                   |
| read relational evidence             | `policy.exists(collection, callback)`                                   | owning Policy                                            | exact nested Collection argument                               | bounded SQL lowering/dependencies/cycles                     |
| define a semantic read               | `defineQuery({ name, input, policy, handler })` from `#questpie/app`    | Query Resource                                           | accepted application-specialized factory plus local input      | Query codecs, Policy, snapshot, errors, and limits in P2/P3  |
| define a semantic write              | `defineMutation({ name, input, policy, handler })` from `#questpie/app` | Mutation Resource                                        | accepted application-specialized factory plus local input      | transaction, Policy, output validation, retry in P2/P3       |
| define exact operation codecs/errors | `operation.*`                                                           | owning Operation                                         | local structural declaration                                   | closed wire algebra and generated declarations               |
| expose ordinary Collection CRUD once | `defineCollectionOperations(collection, {...})`                         | accepted compile-time Resource Set; children own runtime | exact Collection and attached Policy                           | child runtime semantics and lifecycle in P2/P3               |
| perform generated data work          | `ctx.data.companies.*`, `ctx.data.run(plan, input)`                     | current Query snapshot or Mutation transaction           | generated App Contract and structural plan                     | exact method vocabulary and Policy/lifecycle parity          |
| normalize one caller Field value     | operation-local closed `normalize` entry; exact spelling open           | owning Collection Operation input                        | bound Field codec and closed pure normalizer                   | Unicode semantics, ordering, errors, and type proof          |
| assign a server-owned CRUD value     | operation-local closed `values` program                                 | owning Collection Mutation                               | bound Collection plus Principal/Tenant/operation-time operands | conflict/order/candidate proof                               |
| commit durable intent                | `ctx.dispatch.target(input)`                                            | current Mutation transaction                             | generated durable target contract                              | dispatch identity/artifact/run-as semantics                  |
| watch one Query                      | `client.queries[name].watch(input, callback, options)`                  | same Query Resource plus subscription runtime            | generated Query input/output and delivery protocol             | resume/frontier/revocation/backpressure proof                |
| define committed follow-up work      | `defineReaction({...})` from `#questpie/app`                            | Reaction Resource over durable run engine                | application-specialized generated fresh-attempt factory        | identities/leases/fencing/retry/run-as proof                 |
| define explicit background command   | `defineJob({...})` from `#questpie/app`                                 | Job Resource over durable run engine                     | application-specialized generated fresh-attempt factory        | dispatch/schedule/result/cancel proof                        |
| declare external effect identity     | `run.effect("local-name")`                                              | owning durable run                                       | literal Definition-local identity                              | canonical bytes/provider ambiguity proof                     |
| own raw HTTP protocol                | `defineRoute({...})` from `#questpie/app`                               | Route Resource                                           | application-specialized Route-mode factory                     | raw body/path/stream/limits/direct proof                     |
| own one external effect              | `defineAction({...})` from `#questpie/app`                              | Action Resource                                          | application-specialized effect-mode factory                    | stable effect key/output/errors/cancellation proof           |
| resolve credentials                  | concrete Auth integration maps native session/token to `Principal`      | Auth integration boundary                                | native provider types plus bounded Principal contract          | failure/native-route/schema/runtime proof                    |
| authorize file bytes                 | Policy-protected File metadata read, then `ctx.files.open(...)`         | File capability after metadata disclosure                | exact File Collection row and storage binding                  | streaming/state/provider proof                               |
| search committed application state   | generated `ctx.search.messages.query(...)` over a declared projection   | Search projection and current source Policy              | compiled projection and generated Search member                | checkpoint/rebuild/authorized-universe proof                 |

## Vocabulary currently fixed in reader prose

| Word                     | Meaning                                                                               | Do not use as a synonym                       |
| ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| Context input            | transport-neutral untrusted values needed to construct a root Execution               | HTTP header binding, Policy proof             |
| resolved Context value   | bounded immutable convenience value produced once for the root Execution              | mutable Service, complete authorization cache |
| structural data plan     | accepted `dataQuery` value with exact Collection read structure                       | named Query, Resource, endpoint               |
| Query                    | named read-only semantic Operation                                                    | free client query object, structural plan     |
| Mutation                 | named semantic Operation that owns one transaction and atomic dispatch boundary       | hook bag, external Action                     |
| Collection Operation Set | compile-time shorthand that emits ordinary list/get/create/update/delete Resources    | CRUD runtime, ambient Admin API               |
| Policy evidence read     | boolean-only trusted relational predicate inside an owning Policy                     | returned application data                     |
| disclosure read          | Collection/Relation result returned to application code or client, with target Policy | authorization evidence                        |
| Live Query               | watched recomputed authorized result of one Query                                     | row-change event stream, manual channel       |

## Names deliberately removed from current examples

- `context.fetch.header(...)`: transport encoding does not belong in a Context
  Definition.
- context `selector`: `input` is the shorter symmetrical term used by
  `defineContext`, generated client scopes and direct Executions.
- context-free `policy.rows(({ fields }) => ...)`: there is no Collection type
  source.
- required handler files, `handlerRef`, handler registries or per-operation
  capability maps: compiler plumbing does not organize the application.
- v3 `find`, `findOne`, `updateById`, `deleteById`: current Collection shorthand
  uses `list`, `get`, `create`, `update`, `delete`; exact key input handles
  composite primary keys.
- manual handler authentication checks: declarative Operation admission owns
  that decision.
- general `before*`/`after*` hooks: pure Field normalization, named Mutation,
  durable Reaction and external Action own those separate jobs.
- `ctx.asSystem()`, `overrideAccess`, raw SQL/DB/transaction handles: none are
  part of the normal generated context.

The executable compiler shape above is accepted in ADR-0009. The evaluator
permits only the six named pure factories from the Current App Contract and
never loads generated Runtime output from disk. The source-owned type-only
`bindDefinitions<AppContract>()` remains a rejected fallback because the
current-virtual isolation passed. Later rows still need their runtime-semantic
proofs.

## Cross-page consistency gate

Before a candidate page is promoted or used to create an implementation ticket:

1. its public names appear once in this inventory;
2. every callback has the same visible type source in every page;
3. server, client, direct, nested, realtime and worker examples use the same
   semantic Resource and Context model;
4. an accepted foundational name is not silently renamed;
5. any internal compiler complexity remains visible through generated artifacts
   and `explain`, not extra authored registries/files;
6. the corresponding executable proof replaces the candidate row with an
   accepted authority reference.
