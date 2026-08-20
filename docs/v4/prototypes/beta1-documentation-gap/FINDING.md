# The beta.1 documentation gap

What the beta.1 guides promise and what `packages/` implements, surfaced while
scoping `apps/docs` to beta.1 by removal at `1d85b472`.

Base: `feat/v4` at `c54b30ac`. Every claim below was verified against the tree
at that head, not inherited.

**Read the sort before the findings.** The same symptom — a guide documenting
behavior the tree does not produce — has four different causes and only one of
them admits a cut:

| Class                  | Meaning                                   | Remedy                    |
| ---------------------- | ----------------------------------------- | ------------------------- |
| Grounded               | tree matches the guide                    | none                      |
| Invented               | no authority anywhere backs the claim     | cut, on an owner decision |
| Accepted but unbuilt   | authority backs it, `packages/` is behind | fix `packages/`           |
| Precise but overstated | true of the default, wrong as a bound     | reword                    |

Cutting an accepted-but-unbuilt claim moves the docs _away_ from the accepted
position, which is why the class has to be established before the edit.

## Findings

**Four things `apps/docs` exposes; two are docs defects and two are not.**
**The distinction matters more than either finding:** the same symptom — a
guide documenting behavior the tree does not produce — has opposite remedies
depending on whether accepted authority backs the claim. Check that before
reaching for a cut.

- **Eleven diagnostic codes the compiler cannot emit. Backed by authority,
  so the gap is in `packages/`, not the guide.**
  `docs/v4/definition-composition.md:1163` calls the composition diagnostics
  a "closed code registry", tabulates 24 `QP-COMPOSE-*` codes at
  `:1165`–`:1189`, and specifies the exact union `CompositionDiagnosticCodeV1`
  at `:1200`+ with all 24 — binding, in its own words: "this mapping is part
  of v1 and an implementation cannot choose a different severity or blocking
  effect". `packages/compiler/src/diagnostic.ts` declares **13**: 002, 004,
  005, 006, 008, 010, 011, 012, 013, 014, 015, 017, 020. Missing: 001, 003,
  007, 009, 016, 018, 019, 021, 022, 023, 024 — absent from the declared
  union, so no throw site can reach them, and absent from all of
  `packages/*/src`.
  `definition-composition.mdx` cites every one of the eleven;
  `semantic-kernels-and-public-surface.mdx` cites 023 and 024.
  **The guides are right against the contract and wrong against the tree, so
  do not cut them.** The remedy is finishing the registry. Codes 023 and 024
  arrived with the API ergonomics amendment
  (`docs/v4/prototypes/api-ergonomics-gate/`), which is the likely reason the
  projection ran ahead.
  For 023 and 024 the authority is stronger than the projection and was
  checked separately: **ADR-0022 is `Status: Accepted`** and states in its own
  voice that "the compiler reports `QP-COMPOSE-023 operationProjectionCollision`"
  (`docs/adr/0022-freeze-api-ergonomics-and-operation-projection.md:28`) and
  the same for `QP-COMPOSE-024` (`:32`). Both are absent from every file under
  `packages/`, and the declared union stops at 020. So for these two the gap is
  an Accepted ADR asserting compiler behaviour that cannot occur, not a
  projection running ahead of a tree that will catch up.
  **And those two are the whole of it, checked rather than assumed.** All 23
  Accepted ADRs were swept for code-like identifiers they name -- 48 distinct
  ones. Eight are absent from `packages/*/src`, and six are explainable:
  `COPY`, `MERGE`, `LISTEN`, `NOTIFY` are PostgreSQL keywords in prose
  describing the capture boundary, not symbols the tree must contain
  (ADR-0012:35 permits `LISTEN`/`NOTIFY` as "a lossy wake hint only" rather
  than requiring it); `upload(file)` is ADR-0018 File/Search, which
  `beta-slice-p15/SLICE.json` puts in `laterBetas`; and `DataCursorV1` is
  named by ADR-0008:95 as deliberately frozen for the accepted proofs, with
  `DataCursorV2` -- the one it says execution emits -- present at
  `packages/runtime/src/relational/cursor.ts:65`, `:124` and `:287`. So the
  Accepted ADR surface asserts nothing else the tree fails to provide. Do not
  re-derive this; it is a bounded corpus and the sweep was cheap.
  **`QP-COMPOSE-003` is the one with substance behind it: the Resource Name
  grammar is not enforced at all.** `definition-composition.mdx:103`–`:113`
  documents segments of 1–63 characters, a 255-character total, and names
  `Appointments`, `booking_availability` and `booking..availability` as
  invalid. In the compiler, `model.ts:128` reduces a Resource name to
  `string(value.name, "resource name")`, and `string()` at `:33`–`:41` checks
  `typeof` only. The three grammar checks that do exist are all pointed
  somewhere else, which is why a grep for the bound finds nothing:
  `field-contract.ts:49` `/^[a-z][A-Za-z0-9]{0,62}$/` is `memberKey`, applied
  at `:187`, `:234` and `:262` to embedded properties and Field path
  segments; `change-capture.ts:50` is a dotted qualified-name regex used once,
  at `:133`, against `input.applicationName`; `physical-name.ts:40` is the
  PostgreSQL identifier rule. **No 255-character bound exists anywhere in
  `packages/*/src`.**
  The consequence is quiet rather than loud, which is the opposite of the
  dead factories: an invalid Resource Name is not rejected, it is mangled.
  `manifest.ts:54` `defaultCollectionName` splits on `.`, snake-cases each
  part and joins with `__`, so `booking..availability` becomes
  `booking____availability` and `Appointments` becomes `appointments`, both of
  which then pass `validatedPhysicalName`. Whoever implements 003 should
  expect to be changing what currently compiles, not only adding a code.
- **The flagship guide's first Query example does not compile, and neither
  does its recursive-output example.** Higher severity than everything else
  in this item, because these are copy-paste starting points rather than
  prose a reader can route around.
  `queries-and-mutations.mdx:67` is `input: operation.input(channelMessagePage)`
  inside the guide's opening `defineQuery`. `packages/questpie/src/operation.ts:68`
  is the whole namespace: `Object.freeze({ error, text })`. There is no
  `input` member. (`operation.error` at `:69` of the same example is fine.)
  `queries-and-mutations.mdx:147` is
  `const threadNode: Codec<ThreadNode> = codec.lazy(() => …)`. `codec`
  (`packages/questpie/src/codec/index.ts:55`) has nine members — uuid, text,
  boolean, integer, timestamp, object, array, nullable, optional. `lazy`
  appears nowhere in `packages/questpie/src`.
  **They are different classes, so check before fixing either.**
  `operation.input` is accepted-but-unbuilt: it is the design-fiction
  shorthand at `docs/v4/design-fiction/queries-and-mutations.md:57`, `:145`,
  `:191` and `realtime.md:45`, `:175`. `codec.lazy` has no authority
  anywhere in the record set — invented.
  **The working fixture shows what the real API is today, which makes this
  actionable rather than just wrong.** `fixtures/collaboration/src/consumer.ts`
  is the same query as the guide's example. It writes the input codec out
  explicitly — `codec.object({ channelId, first, after })` at `:10`–`:14` —
  and reaches the plan through `ctx.data.run(channelMessagePage, input)` at
  `:32`, rather than deriving the input from the plan.
  Verified the imports around them are clean, so this is two symbols and not
  a general rot: all 23 symbols the guides import from `questpie` are real
  exports, and of 37 distinct namespace members used across every `ts` block,
  these two are the only ones that do not exist.
  **The shape is worse than the symbols, and it is one gap rather than many.**
  `defineQuery` takes five keys. The template is static —
  `packages/compiler/src/generate.ts:375`–`:386`, no conditional — so every
  generated `#questpie/app` says the same thing: `name`, `network?`, `input`,
  `output`, `handler({ input, ctx })`. **No `policy`, no `errors`, and the
  handler input has no `errors` to destructure.** `MutationFactory` is where
  those live: the generated contract gives it `policy` and `errors`, both
  **required**, and puts `errors` in the handler input. Every `defineQuery`
  example in the guides is shaped like a Mutation —
  `queries-and-mutations.mdx:65` and `executable-definitions.mdx:19` both
  pass `policy` and `errors`, and neither passes `output`, which is required.
  **Accepted-but-unbuilt, and the accepted side is unambiguous.**
  `docs/v4/query-mutation-and-lifecycle.md:36`–`:38`: "Each local exported
  Definition owns its Resource Identity, input, output, declared errors,
  Policy, exposure, limits, Origin, Executable Slot, and inline handler" —
  each Definition, Query included. `:39`–`:40` also makes `output` the
  override rather than a requirement: "The compiler can infer a closed
  supported output. Use `output` when the contract must remain independent of
  inference or is recursive." Both factories require it, and the fixture
  always passes it, so **output inference is unimplemented too**.
  So the guides are not sloppy here; they document the accepted authoring
  API, and the compiler emits a narrower one. The fix is in `packages/`, and
  it is one change — Query's factory shape — not a list of examples.
  **Nothing would have caught this.** `apps/docs` `types:check` runs
  `fumadocs-mdx && tsc --noEmit` over the app's own sources; fenced code in
  MDX is highlighted by shiki and never compiled. A guide example can be
  arbitrarily wrong and every gate stays green.
  **And the release gate that should catch it has no instrument.**
  `beta-slice-p15/SLICE.json` `releaseGates` ends with "public finished-product
  beta.1 docs and explicit absence documentation". `release.yml:29` runs
  `quality:release`, which is `full()` plus `knip:strict`, `package:check`
  and `scripts/performance.ts check` (`scripts/quality.ts:200`–`:204`).
  Nothing in that path reads `apps/docs/content`. The only `apps/docs`
  reference in all of `scripts/` and `tests/` is the tsconfig path at
  `scripts/quality.ts:215`, in the `typescript-forward` lane, and it compiles
  the site's own TSX.
  Positive control, because "no check exists" is exactly the claim a bad
  search invents: the sibling gates in the same list ARE mechanically
  enforced — `tests/type/beta01-generated-contract.test.ts:233` asserts the
  generated declarations match no `Drizzle|Kysely|drizzle-orm|any`, which is
  the "no ORM types" gate. My first pass looked only in `scripts/` and found
  nothing for that gate either; the instrument was wrong, not the tree. Once
  pointed at `tests/`, it fires for the siblings and still finds nothing for
  docs.
  **Reaction closes the inventory, and one gap turns out to span all three
  factories.** `ReactionFactory`
  (`packages/compiler/src/reaction/declarations.ts:113`–`:128`) takes `name`,
  `input`, `output`, `runAs`, `retry`, `effects?`, `errors?`, `handler`.
  `output` is required there too — as it is on Query (`generate.ts:379`) and
  Mutation. The accepted contract says the opposite
  (`query-mutation-and-lifecycle.md:39`–`:40`: "The compiler can infer a
  closed supported output"), **every** guide example of all three factories
  omits `output`, and **every** fixture definition passes it. So output
  inference being unimplemented is one gap that costs one compile error in
  every authoring example in the docs.
  Two things Reaction settles that Query left ambiguous. First, the thinness
  is **specific to Query, not general**: `ReactionContext`
  (`reaction/declarations.ts:89`) is `Omit<RootExecution, "services">` plus
  `data`, `queries`, `mutations`, `run`, `attempt`, so a Reaction handler does
  see the Principal and Tenant. Second, `policy` is a Mutation-only key —
  Reaction has none either.
  **An earlier revision of this line added "so that one may be by design in a
  way Query's absence is not". That was wrong, and the correction matters
  more than the point it was attached to.** Policy in v4 is Collection-bound,
  not Operation-bound: `compiler/src/relational/discovery.ts:136` attaches it
  as `{ kind: "default", requiredForNormalDataAccess: true }`, and the
  compiled read plan carries `policy` and `policyProgramDigest`
  (`runtime/src/relational/query.ts:97`–`:98`, `:621`). The generated
  `policy-projection.json` holds `operations.read` with
  `admission: { kind: "authenticated" }`. So a `defineQuery` reading through
  `ctx.data` **is** Policy-checked, admission included, and the guides'
  `policy: policy.authenticated()` is closer to redundant than load-bearing.
  `QueryDefinition` carries no `policy` field either, which is consistent
  rather than a second gap.
  The compile error stands — `QueryFactory` rejects the key — but it is a
  surface mismatch, not evidence that Queries are unauthorized, and it must
  not be fixed by assuming Query needs an operation-level Policy. The
  Collection binding may already be the answer; that is an owner call.
  It also puts a type under the open `durable-reactions.mdx` decision:
  `ctx.actions` there is not merely explained through a deferred capability,
  it is **not a member of `ReactionContext`**. That guide's example is also
  missing the required `output`.
  **The guides teach two different applications, and the routing document
  names the one the minority uses.** Not a beta.1 scoping issue and not caused
  by the cut — the break sits between two guides that both survived it.
  `docs/agents/product-documentation.md:36` says "Use TanStack Barbershop as
  the canonical application", `:53` has example review check "one connected
  Barbershop domain", and
  `.agents/skills/questpie-v4/references/public-documentation.md:9` repeats it
  as "complete Barbershop examples". But ADR-0021:37–38 designates the
  **collaboration/publishing fixture** the primary connected tracer, and
  `fixtures/` holds `archive` and `collaboration` — **there is no barbershop
  fixture**.
  The guides split three to five: `definition-composition.mdx`,
  `schema-lifecycle.mdx` and `data-and-queries.mdx` use appointments;
  `context-and-policy.mdx`, `queries-and-mutations.mdx`, `realtime.mdx`,
  `durable-reactions.mdx` and `runtime-and-studio.mdx` use
  Company/Space/Channel/Membership/Message; five use neither.
  **The break shows in the reading order, not just a count.** `meta.json` runs
  `definition-composition → schema-lifecycle → data-and-queries →
  context-and-policy`, and each chain asserts continuity —
  `data-and-queries.mdx:12` "Continue with the complete `appointments`
  Collection from", `queries-and-mutations.mdx:12` "The examples continue with
  the complete collaboration fixture from". A reader follows appointments for
  three guides, then meets a different application with no transition.
  Either instruction could be the one to change; **what cannot stand is a
  canonical application named by the routing document and used by three guides
  out of thirteen.** Owner content decision, not a cut.
  **The structural factories are clean except one example, and that one
  contradicts the guides' own prose.** `defineCollection` requires
  `constraints` — `packages/questpie/src/index.ts`, `constraints: Constraints
& ValidateFieldReferences<Fields, Constraints>`, no `?`. Eleven of the
  twelve `defineCollection` examples across the guides pass it. The twelfth,
  `semantic-kernels-and-public-surface.mdx:20`–`:27`, does not, so it does not
  compile. `data-and-queries.mdx:9` states the rule the example breaks: "A
  regular Collection must have exactly one named primary-key Constraint."
  Docs against docs, with the tree siding with the prose — a different shape
  from every other finding here, and the only one that is an isolated slip
  rather than a contract mismatch.
  `defineContext` (`name`, `input`, `resolve`), `defineSeed` (`name`,
  `steps`, `dependsOn?`) and `defineService` (`name`, `lifetime`, `effect`,
  `create`, `dependencies?`, `dispose?`) all match their guide examples
  exactly.
  **The client and app surface is clean, checked the same way.**
  `GeneratedApp` is `fetch`, `execution`, `close`; `GeneratedClientScope` is
  `context`, `queries`, `mutations`, `withContext`
  (`fixtures/collaboration/.questpie/generated/client.ts:41`+). Every use in
  the guides resolves, including the `withContext({…}).queries[…]` call
  shape. Two apparent misses were my regex reading inside string literals —
  `app.context` is `name: "app.context"` at `context-and-policy.mdx:129`, and
  `app.example` is a `baseUrl` URL at `runtime-and-studio.mdx:51`. The
  authoring surface is where the gap is; the calling surface is not.
  **That is why seven compile errors sit in the flagship guide with every
  gate green**, and it is the cheapest thing on this list to fix: one check
  that extracts `ts` blocks and compiles them would have caught every example
  finding above, and the numeric and symbol findings are the kind a second
  check could reach.
  **The Context is thin the same way, so this is one gap and not two.**
  `QueryContext` in the generated contract is two members —
  `{ data, signal }`. `MutationContext` is `Omit<RootExecution, "services">`
  plus `data`, `operationTime`, `callId`, `transactionId`, `dispatch`, and
  `RootExecution` carries `principal`, `authority`, `tenant`, `values`,
  `signal`, `deadline`. So a Query handler cannot reach the Principal or the
  Tenant at all. The guide's opening Query uses both —
  `queries-and-mutations.mdx:77` and `:82` for `ctx.tenant.id`, `:83` for
  `ctx.principal.id`. Design fiction has the same lines in the same example
  (`design-fiction/queries-and-mutations.md:67`, `:73`, `:74`), so this is
  accepted-but-unbuilt like the rest, not a slip.
  **Counted end to end, that one example fails on seven points:**
  `operation.input`, `policy`, `errors`, missing required `output`, a handler
  destructuring `errors`, `ctx.tenant`, `ctx.principal`.
  **The Mutation example beside it is correct on all seven**, which is the
  tell: Query is implemented as a much thinner thing than the accepted design
  and the guides were written against the design.
  Two positive controls, since a thin result is worthless if the instrument
  cannot see a thick one. The same reading method finds five members on
  `MutationContext` and two on `QueryContext`. And the only Query in the
  compiling fixture, `fixtures/collaboration/src/consumer.ts`, uses exactly
  `ctx.data` and nothing else — the tree is self-consistent; only the docs
  and the design run ahead of it.
- **One more accepted-but-unbuilt bound, same class as the codes above.**
  `data-and-queries.mdx:79` says a JSONB-backed Field has at most 1,048,576
  canonical UTF-8 JSON bytes. The projection agrees —
  `docs/v4/data-model-and-query-grammar.md:325`, "a maximum canonical UTF-8
  JSON size of 1,048,576 bytes". Nothing enforces it: there is no JSON byte
  check in `packages/runtime/src/relational` or `.../codec` and none in
  `packages/compiler/src`; the only `byteLength` on that path is the 63-byte
  name check at `relational/bootstrap.ts:72`. The 1_048_576 literals that do
  exist are operation payload limits (`compiler/src/mutation/index.ts:65`,
  `:66`) and the realtime result cap — different contracts. Guide right,
  tree behind; do not cut.
- **`data-and-queries.mdx:175` overstates one word.** "The hard v1 page
  maximum is 100 rows. A deployment can set a lower limit." 100 is the
  _default_: `runtime/src/relational/query.ts:599` is
  `input.maximumPageSize ?? 100`, and `:600` rejects only `< 1`, so it can be
  raised as well as lowered. It is enforced per request — `:328`,
  `first > maximumPageSize` → `QP-DATA-012` — so "hard maximum" is right for
  the default configuration and wrong as a bound. Small, and a cut is not the
  fix; a word is.
- **Half of one Runtime limits table is invented.**
  `runtime-and-studio.mdx:224`–`:232` presents eight "Defaults". Four are
  exact: active root Executions per Principal 64 and drain deadline 30 s are
  `packages/runtime/src/application/index.ts:205` and `:206` (the only two
  numeric defaults in that module), and request/response body 1 MiB is
  `packages/compiler/src/runtime/index.ts:234`. **The other four have no
  constant in the tree and no source anywhere in the record set** — Runtime
  event 64 KiB, events per Execution 2,048, telemetry exporter queue 4,096,
  startup deadline 30 s. `packages/runtime/src/application/events.ts` is 93
  lines and holds no cap at all; the only `limits: {…}` block in
  `packages/*/src` is the wire one at `:234`; there is no exporter module and
  no startup-deadline constant. The 2,048 and 4,096 that do exist elsewhere
  are the ADR-0008 cursor envelope and a Convex comparison — different
  things.
  **Not a systemic docs problem, which is why it is worth the space.** The
  realtime table at `realtime.mdx:203`–`:212` is eight for eight against
  `packages/compiler/src/live-query/index.ts:134`–`:143`, key by key. One
  table is grounded; this one is half-invented.
  **I did not cut them, deliberately.** The removal criterion is what the
  BETA-01–BETA-12 passes deliver, _not_ what has an implementation today —
  that distinction is the one this record already had to correct once. The
  Execution Envelope is BETA-05 and accepted, so an unbuilt envelope limit
  may be intended rather than out of scope, and SLICE.json says nothing about
  these four either way. Establishing which needs the owner, and cutting a
  user-facing table on my own reading of the tree would repeat the exact
  mistake the criterion exists to prevent.
- `durable-reactions.mdx:233` links to `./durable-jobs-and-workflows`, now
  removed. This is the same open defect already recorded for that file: a
  shipped BETA-08 guide explaining itself through deferred capabilities —
  "a generated server Action capability projection" (`:86`), "through a
  generated Action. It cannot write a Collection directly" (`:97`), and the
  receipt reuse at `:170`. Removing Action leaves the shipped guide with no
  account of how a Reaction performs an effect. **One content decision
  settles the link and the Action explanation together.**
- `docs/v4/prototypes/api-ergonomics-gate/AMENDMENT.md:124` names
  `services-routes-and-auth.mdx` in a work-list. Left deliberately: it is a
  historical record of a past amendment's scope, not a live claim, and
  concurrent ticks are active under `docs/v4/prototypes`.

## How the cut was made, and what the mapped list got wrong

1. ~~**Scope `apps/docs` to beta.1 by removal, not by callout.**~~ **Done at
   `1d85b472`.** The guides now read as a finished product; the boundary came
   from `beta-slice-p15/SLICE.json` `deferred` + `laterBetas`, not from what
   has a runtime module.

`apps/docs/content/docs/v4/` now holds 13 guides. Removed wholly:
`durable-jobs-and-workflows.mdx`, `files-search-and-contract-projections.mdx`.
Renamed after surgery, because the slug promised what the page no longer
delivers: `services-routes-and-auth.mdx` → `services.mdx`,
`multi-instance-and-acceleration.mdx` → `multi-instance.mdx`. Enumerations
pruned in `index.mdx`, `semantic-kernels-and-public-surface.mdx`,
`executable-definitions.mdx`, `definition-composition.mdx`.

**The mapped list this file carried was wrong in both directions, from one
sentence.** The warning that `Channel` in `realtime.mdx`,
`queries-and-mutations.mdx` and `context-and-policy.mdx` is the
collaboration fixture's own Company/Space/Channel/Membership/Message graph
holds — all three read, all three confirmed. But it generalised to "those
three guides are unaffected", and that is false for a _different_ token:
`queries-and-mutations.mdx:428` prescribed "an Action for an external
effect" and `:387` named an "external Action bag";
`context-and-policy.mdx:243` listed "Route transitions" among the entry
points constructing a fresh root. Both cut at `1d85b472`. The warning was
about one token; it was applied to whole files. Verify per token, not per
guide: `schema-lifecycle.mdx`'s three hits are all "file" meaning source
file, and `runtime-and-studio.mdx`'s four are a fetch `credentials` option,
a lowercase Studio route, and two negative telemetry statements — those two
are genuinely unaffected.

Two counts in this file were also wrong: it said 17 guides in one place and
fourteen in another. The directory held 15, all `kind: guide`.

## Independent validation at `62880614`

Re-derived against `feat/v4` rather than inherited from this record:

| Claim | Disposition   | Independent basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **CONFIRMED** | The directory has 13 `.mdx` files and `meta.json:3`–`:16` names the same 13 stems. An extractor resolved 54 local links to existing pages and found one missing target, `durable-reactions.mdx:233` → `./durable-jobs-and-workflows`. The 54 resolved links are the positive control that the checker can recognize a target.                                                                                                                                                                                                                                                                                                                                     |
| 2     | **CONFIRMED** | `packages/runtime/src/application/index.ts:431`–`:437` compares the request pathname with the fixed `operationPath`; `packages/runtime/src/operation/wire.ts:5`–`:7` fixes that path at `/_questpie/operation`. Realtime separately compares exact pathname identity at `packages/runtime/src/application/realtime/carrier.ts:158`–`:160`, against the fixed `/_questpie/realtime` contract emitted at `packages/compiler/src/runtime/realtime-wire.ts:127`. A runtime-source search finds no base-path or mount option; its positive `prefix` hits are collection key traversal at `packages/runtime/src/mutation/collection.ts:60`–`:70`, not request mounting. |
| 3     | **CONFIRMED** | The static `QueryFactory` template at `packages/compiler/src/generate.ts:375`–`:386` accepts only `name`, optional `network`, `input`, `output`, and `handler`. Mutation requires `policy` and `errors` at `packages/compiler/src/mutation/declarations.ts:52`–`:66`.                                                                                                                                                                                                                                                                                                                                                                                             |
| 4     | **CONFIRMED** | `QueryContext` is exactly `data` and `signal` at `packages/compiler/src/generate.ts:322`–`:325`; `MutationContext` extends `Omit<RootExecution, "services">` at `:327`, and `ReactionContext` does the same at `packages/compiler/src/reaction/declarations.ts:89`–`:95`. `RootExecution` owns `principal` and `tenant` at `generate.ts:352`–`:360`, so those members do not reach a Query handler.                                                                                                                                                                                                                                                               |
| 5     | **IMPRECISE** | `output` is required by Query (`generate.ts:375`–`:386`), Mutation (`mutation/declarations.ts:52`–`:66`), and Reaction (`reaction/declarations.ts:114`–`:129`), while the accepted contract makes it an inference override at `docs/v4/query-mutation-and-lifecycle.md:36`–`:40`. But it does **not** cost that error in every guide factory call: `queries-and-mutations.mdx:154`–`:160` supplies `output: threadNode`. Six of the seven guide calls omit it; the universal count was false.                                                                                                                                                                     |
| 6     | **CONFIRMED** | `packages/compiler/src/diagnostic.ts:1`–`:14` contains 13 distinct `QP-COMPOSE` codes. The closed registry has 24 rows at `docs/v4/definition-composition.md:1164`–`:1189` and the same 24-member union at `:1201`–`:1227`. The eleven missing strings occur nowhere in `packages/*/src`; the positive control `QP-COMPOSE-002` reaches throw sites in `model.ts`, `mutation/operation-set.ts`, and `discovery.ts`.                                                                                                                                                                                                                                               |
| 7     | **CONFIRMED** | `packages/compiler/src/model.ts:33`–`:41`, called for the Resource name at `:125`–`:131`, checks only `typeof value === "string"`. A `255` search is positive in the accepted grammar (`definition-composition.md:692`) and empty under `packages/*/src`. `packages/compiler/src/schema/manifest.ts:47`–`:55` lowercases/snake-cases dot-separated segments, and `:216`–`:223` uses that transformed fallback as the collection table name.                                                                                                                                                                                                                       |
| 8     | **CONFIRMED** | The four grounded Runtime values resolve at `packages/runtime/src/application/index.ts:202`–`:206` and `packages/compiler/src/runtime/index.ts:226`–`:234`. `packages/runtime/src/application/events.ts:1`–`:93` has no event or per-Execution cap, and no exporter queue or startup-deadline implementation exists. By contrast, all eight realtime values at `realtime.mdx:203`–`:212` match `packages/compiler/src/live-query/index.ts:131`–`:143` key for key. Searches for the four Runtime descriptions find only generic Runtime-event prose or unrelated cursor figures, not a source for those defaults.                                                 |
| 10    | **IMPRECISE** | `SPEC.md` §16 runs from `:515` to `:592`, names ADR-0009 through ADR-0021, and omits ADR-0022 and ADR-0023. Both are Accepted (`docs/adr/0022-freeze-api-ergonomics-and-operation-projection.md:1`–`:4`; `docs/adr/0023-freeze-post-commit-operation-outcome.md:1`–`:6`), and ADR-0023 explicitly supersedes ADR-0014's post-commit edge. The material omission is real: `SPEC.md:585`–`:592` still presents ADR-0014 without the qualification. But that range does **not** restate the retained-pair rule “in full”; the original claim overstated what the cited SPEC paragraph contains.                                                                      |

### Proposed fenced-code compilation gate — not wired

The corpus currently contains 35 `ts`/`tsx` fences. They are not one uniform
compilation unit: some are complete titled modules, some are continuation
fragments, and some are standalone type illustrations. A useful blocking gate
therefore needs an explicit contract rather than concatenating Markdown:

1. Every TypeScript fence declares a scenario and mode. A module keeps its
   `title` as its virtual path; a fragment names the checked wrapper that gives
   it scope; a type-only fence is compiled as its own module. No silent skip is
   allowed.
2. The extractor assembles each scenario in a temporary directory, compiles its
   structural Definitions with the repository compiler, and then runs canonical
   TypeScript 6 strict no-emit against the resulting generated `#questpie/app`
   and `#questpie/client` contracts. This avoids treating the collaboration
   fixture as the contract for the appointments examples, and it leaves the
   open Barbershop-versus-collaboration content decision open.
3. The check reports `guide:line`, virtual path, and the TypeScript diagnostic.
   One known-good minimal scenario is the positive control. A negative control
   mutates a generated-factory call with a rejected key and requires the check
   to fail at that fence before a zero-error corpus is trusted.
4. Only after the current corpus and both controls pass should the command join
   `quality:full` and release CI. Until then it is a red repair instrument, not a
   contributor-wide gate.

This compiler gate would have caught claims 3–5 and the bad namespace members
recorded above. It would **not** have caught claims 6–8: the closed diagnostic
registry and Runtime limits are prose/table claims, and Resource Name rejection
is runtime/compiler behavior that a type-only check does not exercise. Those
need separate contract assertions or executable negative cases. What would
overturn this split is an extractor that turns those prose rows into explicit
typed or executable assertions; no such markup or runner exists today.
