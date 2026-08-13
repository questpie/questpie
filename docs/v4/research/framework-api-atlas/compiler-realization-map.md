# Compiler realization map for the design-fiction application API

- Status: design evidence; no acceptance or implementation authority
- Date: 2026-08-12
- Scope: Context, Policy, Query, Mutation, Collection Operation Set, Reaction,
  Job, and generated Query watch exposure
- Authority baseline: `SPEC.md`, ADR-0007, ADR-0008,
  `docs/v4/definition-composition.md`, and
  `docs/v4/data-model-and-query-grammar.md`

> P1 outcome, 2026-08-12: ADR-0009 and proof head `713485a6` accept the
> Current App Contract factories, executable slicing, output rounds, Package
> isolation, Collection Operation Set, compiler ownership, Runtime Build
> pairing, Origin, determinism, and budget contract. This report remains design
> history for the broader P2-P6 realization seams.

## Finding

The current developer-facing design can map to one deep compiler module without
adding a handler registry, per-Operation capability map, file convention, or
runtime discovery system. The common case stays one exported Definition with
one inline handler. The compiler owns source slicing, normalization, generated
types, runtime binding, hashing, and explanation.

Before P1, that conclusion depended on four unresolved seams:

1. A `defineQuery` factory imported from `"questpie"` gave stock TypeScript no
   visible source for the concrete application's `ctx`.
2. ADR-0007 described a Definition as establishing one Resource, while the
   proposed Collection Operation Set expanded into several Resources.
3. The proposed named Context Definition did not fit the accepted Resource Kind
   protocol.
4. The candidate bound Policy was separate from Collection Augmentation, but
   its default-selection authority was not fixed.

ADR-0009 resolves the first three and the compiler-ownership portion of the
fourth: factories come from the Current App Contract, a Collection Operation
Set is a closed compile-time Resource Set, Context uses fixed singleton identity
`context:app`, and default Policy selection has explicit collision facts. P2
still owns Context Resolution and Policy behavior.

## The developer interface remains small

The compiler must realize these already-documented forms without requiring an
additional source registry:

```ts
export const appContext = defineContext({
	name: "app.context",
	input: { companyId: context.uuid() },
	resolve: async ({ input, principal, bootstrap }) => {
		// Bounded typed bootstrap reads.
	},
});

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",
	read: {
		rows: ({ row, tenant }) => row.companyId.equal(tenant.id),
	},
});

export const channelOverview = defineQuery({
	name: "channels.overview",
	input: operation.input(channelMessagePage),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, name: true },
		});
		return { channel };
	},
	network: true,
});
```

The compiler is earning its depth only if deleting its internal graph split
would force slicing, binding, codec materialization, collision handling, and
type generation into every application. An interface that asks the author to
model those internals is too shallow.

## One internal pipeline

The smallest coherent pipeline has eight phases. These are internal compiler
seams, not public application concepts.

```text
TypeScript Program + questpie.json + activated Package inventories
  -> discover direct supported roots and closed Resource Sets
  -> collect identity/type skeletons
  -> split structural and executable source graphs
  -> controlled structural evaluation
  -> normalize, resolve, expand, and reject collisions
  -> emit Manifest/Origin/generated App and client projections
  -> bundle statically bound executable slots into one Runtime Build
  -> typecheck generated declarations, runtime slices, and public consumers
```

### 1. Discovery

Discovery keeps ADR-0007's current rules. It finds direct exported branded
Definitions below the configured source root and branded exports in active
Package inventories. Paths and export names record Origin only. A generic
array, object, registry, or runtime Module remains invalid.

The only proposed addition is a closed first-party Collection Operation Set
root. It cannot be generalized into a Package compiler hook or arbitrary
multi-Resource generator.

### 2. Identity and type skeleton collection

Before handlers can be checked, the compiler needs a skeleton containing:

- every directly declared Resource Kind and Qualified Resource Name;
- Collection descriptors from the accepted Data Contract Projection;
- operation input, error, Policy-reference, exposure, and mode facts;
- Context input and the locally inferred resolved Context shape;
- durable input, run-as, retry, and dispatch names;
- the exact children of every Collection Operation Set.

This phase does not evaluate handlers and does not emit a usable build. It is a
temporary compiler model used to detect identity collisions early and to
construct the current virtual App Contract for later checking.

### 3. Structural and executable source split

Each closed Definition factory publishes which members are executable slots.
The compiler recognizes only those built-in slots:

- Context `resolve`;
- Query `handler`;
- Mutation `handler`;
- Reaction `handler`;
- Job `handler`.

Policy callbacks, structural data-plan callbacks, Collection Operation Set
`values` callbacks, and durable run-as mapping callbacks build closed symbolic
programs. They remain structural and execute only in the Controlled Structural
Evaluator with symbolic operands.

For an executable member, the compiler produces two internal graphs:

1. a structural graph in which the member is replaced by a stable compiler
   binding marker and handler-only imports are pruned;
2. a runtime graph containing the handler, its lexical dependencies, and its
   handler-only imports.

One value can be reachable from both graphs. Its structural use must satisfy
the existing deterministic-evaluation restrictions. An ambiguous capture is a
compile error; the compiler never moves an impure module initializer into the
structural evaluator to make slicing easier.

The binding marker identifies `{ resourceIdentity, slot: "handler" }` or the
application Context resolver slot. It is an internal tuple, not a new public
Resource Identity grammar.

### 4. Controlled structural evaluation

The evaluator receives only the pruned structural graph. It normalizes codec
builders, Policy expressions, data plans, server-value programs, retry rules,
exposure flags, and Resource references. It never invokes an application
handler or Context resolver.

The existing two-run determinism proof still compares the complete normalized
structural result. Executable bytes are covered later by the Runtime Build;
they do not enter a structural-contract digest merely because the handler is
inline in the source object.

### 5. Resolution and expansion

The compiler establishes one Owner for every ordinary Resource, resolves typed
references, attaches the selected Policy program, expands the closed Collection
Operation Set, derives output codecs, and rejects collisions before emitting
partial artifacts.

Framework-owned expansion produces the same normalized Query and Mutation
primitives as hand-authored Definitions. After normalization, no child retains
private authority or a special CRUD execution path. This is the Same-Primitives
Law applied to first-party authoring shorthand.

### 6. Generated projections

The compiler emits concrete, application-wide server and client types from the
resolved model. Public declarations stay shallow and contain no ORM identity,
ambient application registry, recursively expanded Relation graph, or broad
fallback name.

### 7. Runtime Build

Executable slots and their transitive runtime graphs are bundled once. The
generated server entry binds each required slot statically. Runtime startup
loads the matched artifacts and bundle; it does not inspect source, pair files,
scan exports, or ask application code for a registry.

### 8. Final type and artifact checks

The compiler checks the generated App/client declarations, every runtime slice,
and at least one built-consumer view against the same current compile. It then
validates all artifact digests and publishes the generated directory through
the accepted recoverable replacement protocol.

## Resource-by-resource realization

### Context

| Concern                    | Candidate compiler mapping                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | `name`, closed `input` codecs, resolver slot marker, and any explicit limits. The resolver body is absent.                                                                                                                                                                 |
| Executable split           | `resolve` is one application-level slot invoked once per root Execution. Its runtime graph can call only the bounded generated bootstrap interface.                                                                                                                        |
| Identity, Owner, Origin    | Unresolved. Candidate source has `name: "app.context"`, but accepted Resource Kinds do not allocate `context`. The safe temporary model is one application-scoped protocol slot with one local establishing source and full Origin, not a silently invented Resource Kind. |
| Normalized artifacts       | Context input codec, resolver output codec, bootstrap-read contract, limits, and executable-slot record. These need a closed Context projection before canonical bytes can be claimed.                                                                                     |
| Generated App/client types | `AppContract.context.input`; exact immutable `ctx.tenant` and `ctx.values`; client `withContext(input)`; direct `app.execution({ context: input })`. Resolved values are server-only.                                                                                      |
| Runtime Build              | Includes resolver runtime graph, output validator, bootstrap binding, and slot digest. A body-only resolver change changes the Runtime Build and invalidates old realtime authority partitions.                                                                            |
| Explain                    | Shows input shape, inferred resolved values, bootstrap targets, handler Origin, limits, generated ingress projections, and Runtime Build match without exposing credentials or returned secret values.                                                                     |
| Discovery and collisions   | Exactly one application Context source. Zero means the generated root input is `{}`. Two sources are fatal. Whether an active Package can establish it must be decided explicitly; the compiler must not select by order.                                                  |

The Context input is transport-neutral. Fetch framing, direct calls, watched
Query reconnect, and durable run-as recipes all encode the same compiled input.
The Context Definition does not contain headers, paths, cookies, or a raw
Request binding.

The unresolved identity is a real ADR-0007 issue. Calling Context a normal
Resource requires allocating `context` in the closed Resource Kind protocol.
Calling it a singleton protocol Definition requires documenting why it has
Owner/Origin but no Resource Identity. The focused proof must choose one before
the candidate is accepted.

### Policy

| Concern                    | Candidate compiler mapping                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | Bound Collection reference, `name`, admission, row/current/candidate expressions, Field rules, evidence-read trees, and declared bounds. All callbacks receive symbolic typed operands.                                                      |
| Executable split           | None. A Policy callback builds a closed expression; no callback body runs per row at Runtime.                                                                                                                                                |
| Identity, Owner, Origin    | `policy:<name>` with the directly exported Definition as Owner. The Collection reference is an attachment target, not identity. Callback/member spans enter Origin.                                                                          |
| Normalized artifacts       | One Policy program with target Collection, phase-specific expression trees, Field-path decisions, evidence dependencies, SQL-lowering plan, limits, and optional proven RLS projection. Paths are segment arrays.                            |
| Generated App/client types | Policy does not become a client method. It narrows generated Collection result/input projections and contributes declared authorization errors. Collection and nested evidence callbacks are typed from their explicit Collection arguments. |
| Runtime Build              | Normally no application executable slot. Private runtime evaluators/lowerers consume normalized Policy programs from the matched compiler version.                                                                                           |
| Explain                    | Joins Policy identity, target, attachment, Origins, phases, evidence graph, Field paths, SQL pushdown, dependency facts, bounds, and RLS status. Protected evidence row values are never shown.                                              |
| Discovery and collisions   | Duplicate `policy:<name>` collides normally. A Collection operation requiring one default attached Policy fails on zero or more than one candidate unless it explicitly references a Policy. Import order never selects one.                 |

The missing piece is attachment authority. `definePolicy(messages, body)` can
establish a Policy Resource without modifying the Collection, but the compiler
still needs a closed rule for which Policy every `ctx.data.messages.*` call
uses. This cannot be smuggled in as a target-side Collection Augmentation.

The smallest candidate is a compiler-owned attachment projection keyed by
Collection identity with exactly one default Policy. Explicit Operation Policy
is admission for that Operation and does not replace the target Collection's
data Policy. That rule needs an accepted Policy contract and collision fixture.

### Query

| Concern                    | Candidate compiler mapping                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structural evaluator input | `name`, input codec, admission Policy, declared errors, optional output pin, limits, `network`, and a handler slot marker.                                                                       |
| Executable split           | The inline or imported `handler` is one runtime slot. Handler-only imports never enter controlled evaluation.                                                                                    |
| Identity, Owner, Origin    | `query:<name>`; the one exported `defineQuery` call is Owner. Definition, handler, inferred output, errors, and exposure each retain source Origins.                                             |
| Normalized artifacts       | Query operation contract, exact input/output/error codecs, read-snapshot mode, Policy attachment, limits, network exposure, executable-slot tuple, and watchability result.                      |
| Generated App/client types | Exact generated server `queries[fullName]`; read-only handler `ctx`; browser `queries[fullName]` only when `network: true`; `.watch` only when the compiler proves watchability.                 |
| Runtime Build              | Handler graph, generated output validator, static slot binding, instrumentation sites, and bundle/source-map digests.                                                                            |
| Explain                    | Structural contract, handler Origin, output derivation, generated members, snapshot mode, potential framework references, observed-read support, watchability, limits, and Runtime Build digest. |
| Discovery and collisions   | A second `query:<name>` from source, Package, or Collection Operation Set is fatal even when bytes match. One required handler slot binds exactly once.                                          |

The TypeChecker derives the awaited handler result. The compiler accepts only a
closed supported wire algebra and emits a runtime codec. An explicit `output`
is a pin, not required repetition and not an assertion that can make a class,
function, `Map`, `Set`, `any`, or `unknown` transportable.

Arbitrary handler source is not a reliable static data-dependency manifest.
`questpie explain` may show compiler-recognized potential framework calls, but
Live Query correctness uses runtime observation. The author does not repeat a
`data` capability map.

### Mutation

| Concern                    | Candidate compiler mapping                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | Query structural facts plus transaction limits, declared errors, exposure, and handler slot marker.                                                                                       |
| Executable split           | The inline or imported `handler` becomes one transactional runtime slot.                                                                                                                  |
| Identity, Owner, Origin    | `mutation:<name>` with the exported Definition as Owner and separate member/handler Origins.                                                                                              |
| Normalized artifacts       | Exact codecs, admission, transaction mode, operation-time operand, cancellation/deadline limits, allowed dispatch target contracts, slot tuple, and network exposure.                     |
| Generated App/client types | Exact server `mutations[fullName]`; handler `ctx` with Policy-enforced reads/writes and transactional dispatch; browser member only when exposed. No raw transaction handle is generated. |
| Runtime Build              | Handler graph, static binding, codecs, transaction wrapper binding, dispatch encoder bindings, and bundle digest.                                                                         |
| Explain                    | Transaction ownership, input/output/errors, Policy entry, handler Origin, Collection call modes, explicit server assignments, dispatch targets, limits, and Runtime Build match.          |
| Discovery and collisions   | Duplicate identity or missing/duplicate handler slot is fatal. A Collection Operation Set child collides under the same rule.                                                             |

A body-only handler change with the same inferred output changes Runtime Build
bytes but not the normalized Operation codec. A return-shape change changes the
Operation contract, App Contract, client declaration, and Runtime Build. Schema,
Data Contract, and structural Query bytes remain unchanged unless their own
source changed.

### Collection Operation Set

| Concern                    | Candidate compiler mapping                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | Bound Collection, `name` prefix, explicit Policy, literal fixed members `list/get/create/update/delete`, exact inputs/selections, pure Value Programs, limits, and exposure.                                                          |
| Executable split           | No application handler slot in the normal shorthand. Framework-owned normalized operation primitives execute through the same Query/Mutation engine. `values` is a structural symbolic program.                                       |
| Identity, Owner, Origin    | The set itself is not a Resource. Each literal member establishes one child Resource such as `query:messages.list` or `mutation:messages.update`. The source member is that child's establishing Owner source and call-site Origin.   |
| Normalized artifacts       | Five independent ordinary Operation contracts for the members present, plus a diagnostic expansion record joining them to the set export. No runtime Resource Set object is emitted.                                                  |
| Generated App/client types | Canonical `queries[fullName]` and `mutations[fullName]` remain available server-side. The generated client can add `collections[collectionName].list/get/create/update/delete` aliases that reference those same Resource identities. |
| Runtime Build              | Static bindings to framework-owned operation executors and normalized data/Mutation programs. There are no generated application handler modules merely to imitate handwritten CRUD.                                                  |
| Explain                    | Each child explains its exact identity, set/member Origin, input/output, Policy, mode, server values, and canonical Query/Mutation target. The set export explains the closed expansion only.                                         |
| Discovery and collisions   | Expansion happens before final identity collision resolution. A custom `defineMutation({ name: "messages.update" })` and the set's `update` child collide. Missing members create no Resource.                                        |

This mapping needs a narrow ADR-0007 amendment: one directly exported closed
Resource Set may establish a statically known finite set of ordinary Resources.
It does not authorize generic containers, user generators, plugins, dynamic
member keys, or runtime expansion.

Package Inventory should list each expanded child identity and its own
structural-contract digest, even when the entries share one export name. The
set itself needs no Resource-kind entry. A member addition or removal therefore
produces an exact reviewed inventory diff.

The ergonomic `collections.messages.*` client projection is an alias, not a
second engine. Exact full-name Query/Mutation maps remain canonical so dotted
prefixes and cross-kind collisions retain the accepted lossless representation.

### Reaction

| Concern                    | Candidate compiler mapping                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | `name`, input codec, run-as recipe, retry policy, optional result pin, declared errors/limits, and handler slot marker.                                                                                                               |
| Executable split           | The inline `handler` and handler-only imports become one durable runtime slot. Run-as input mapping remains a bounded structural program.                                                                                             |
| Identity, Owner, Origin    | `reaction:<name>` with one exported Definition as Owner. Handler, run-as, retry, declared effect names, and result retain Origins.                                                                                                    |
| Normalized artifacts       | Durable Resource contract, payload/result/error codecs, run-as recipe, retry/lease/retention limits, dispatch contract, declared effect identities, deployment-compatibility facts, and slot tuple.                                   |
| Generated App/client types | Mutation `ctx.dispatch[fullName]`; Reaction handler `ctx` narrowed to read, nested Mutation, and Action capabilities; acceptance and terminal receipt types. No browser method unless a later explicit exposure contract permits one. |
| Runtime Build              | Handler graph, static binding, effect-site metadata, payload/result validators, and durable compatibility digest.                                                                                                                     |
| Explain                    | Dispatch and run identity contracts, run-as, retry, effect names, handler Origin, generated dispatch members, result codec, limits, and pending-build compatibility.                                                                  |
| Discovery and collisions   | Duplicate `reaction:<name>` collides normally. Every generated dispatch target resolves exactly once; stale or absent executable versions block deployment according to the later durable contract.                                   |

`run.effect("literal-name")` is inside executable source but has deployment
compatibility meaning. The compiler therefore needs a closed AST/TypeChecker
extractor for direct framework effect calls. It must either prove every allowed
alias/helper form or reject an unextractable effect site. Runtime-only discovery
of effect names is too late for deployment explanation and compatibility.

### Job

| Concern                    | Candidate compiler mapping                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | Reaction structural facts plus direct/delayed/schedule dispatch options and inspection Policy.                                                                                         |
| Executable split           | One handler runtime slot; run-as and retry builders remain structural.                                                                                                                 |
| Identity, Owner, Origin    | `job:<name>` with one exported Definition as Owner and exact member Origins.                                                                                                           |
| Normalized artifacts       | Durable Job contract, codecs, run-as, retry, schedule acceptance shape, result/inspection contract, effect identities, limits, deployment facts, and slot tuple.                       |
| Generated App/client types | Server `jobs[fullName].dispatch/schedule`; Mutation `ctx.dispatch[fullName]`; handler `ctx`; typed receipts. Network exposure remains absent unless a later explicit contract adds it. |
| Runtime Build              | Handler graph, static binding, effect metadata, validators, and compatibility digest.                                                                                                  |
| Explain                    | All Reaction facts plus direct dispatch, scheduling, cancellation, inspection, and retention surfaces. Queue internals are operational state, not a source Resource.                   |
| Discovery and collisions   | Normal Resource collision rules. A schedule identity is runtime application data and cannot establish or rename the Job Resource.                                                      |

Reaction and Job share the durable run implementation behind one internal seam,
but their normalized Resource kinds remain distinct so causation and operator
meaning do not collapse.

### Query watch exposure

Watch is not another Definition, Resource, handler, or endpoint identity. It is
a generated projection of the same `query:<name>` Resource.

| Concern                    | Candidate compiler mapping                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural evaluator input | Query contract, `network` exposure, declared structural dependency templates, output/error codecs, and limits. No authored watch list.                                                                |
| Executable split           | No second handler. The Query handler slot runs under an observing read snapshot. Compiler-inserted instrumentation wraps supported generated reads.                                                   |
| Identity, Owner, Origin    | Same Query Resource identity and Owner. Watchability diagnostics point to the unsupported handler/import/read Origin.                                                                                 |
| Normalized artifacts       | Derived `watchability` result, declared dependency templates, observation schema, deployment/authority partition inputs, protocol version, and limits. The exact observed plan remains Runtime state. |
| Generated App/client types | A network-exposed, proven-watchable Query method gains `.watch` with the same input/output/errors. A one-shot-only Query does not advertise a usable watch member.                                    |
| Runtime Build              | Same handler binding plus observation instrumentation and matched protocol implementation.                                                                                                            |
| Explain                    | Why the Query is or is not watchable, declared dependencies, supported observation sites, relevant Context/Policy programs, deployment digest, and configured limits.                                 |
| Discovery and collisions   | None beyond the owning Query. A separately named `watch:` Resource or handler is invalid.                                                                                                             |

The compiler must conservatively classify the handler's runtime effect graph.
Generated data, Relation, Policy, Context bootstrap, and supported nested Query
reads can be observed. Undeclared native SQL, arbitrary database clients,
network reads, clock/random-dependent output, mutable process state, or a
Service without an observation contract make the Query one-shot-only. This is
compiler effect analysis and runtime instrumentation, not a user-maintained
capability map.

Static analysis cannot replace actual-read observation. It determines whether
complete observation is possible; Runtime execution records which supported
reads the current branch actually performed and replaces the successful plan.

## Accepted P1 shell and later candidate artifacts

The exact bytes remain for focused contracts, but implementation planning needs
one ownership map now:

| Fact                                                                             | Artifact owner                                                     | Digest behavior                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource identities, contributions, Schema/Data projections                      | accepted Compiled Manifest                                         | Existing accepted rules.                                                                                                                        |
| Context input/resolved contract and bootstrap plan                               | candidate Context projection in Manifest                           | Structural changes affect generated App/client and Context semantic bytes. Resolver body-only changes do not.                                   |
| Policy expressions, dependencies, attachments, optional RLS                      | candidate Policy projection in Manifest                            | Structural Policy changes affect Policy and generated/Runtime pairing, never Schema unless a separately accepted RLS schema projection says so. |
| Query/Mutation/Reaction/Job codecs, errors, modes, limits, exposure, slot marker | candidate Resource-kind projections in Manifest                    | Contract changes affect semantic bytes and generated declarations. Handler body-only changes do not.                                            |
| Collection Operation Set expansion                                               | ordinary child Resource projections plus diagnostic expansion join | Each child owns its normal identity and collision behavior; the set has no Runtime identity.                                                    |
| Structural Query/dependency templates                                            | accepted Data Query artifacts                                      | Existing ADR-0008 bytes remain unchanged.                                                                                                       |
| Actual Live Query dependencies and resume state                                  | Runtime state                                                      | Never discovered or merged into the Compiled Manifest.                                                                                          |
| Handler runtime graphs and static executable bindings                            | accepted Runtime Build shell                                       | Any executable byte or runtime-toolchain change affects the Runtime Build. Later resolver/effect graph contents remain owned by their chapters. |
| Paths, exports, spans, expansion call sites                                      | Origin Map                                                         | Diagnostic only; relocation does not change semantic Resource identity.                                                                         |
| Server/client declarations                                                       | generated App Contract files                                       | Deterministic projection of the same normalized model; covered by build pairing.                                                                |

No accepted document currently defines a Compiled Manifest Digest. The Runtime
Build must not silently invent one and then leak it as schema or migration
authority. It can pair against a content digest of the exact `manifest.json`
bytes inside its own versioned protocol. That digest has Runtime-build scope
only until a focused artifact contract names and versions it.

A candidate private artifact can contain:

```ts
interface RuntimeBuildV1Candidate {
	format: "questpie.runtime-build";
	version: 1;
	applicationIdentity: string;
	buildInputDigest: string;
	manifestContentDigest: string;
	appContractContentDigest: string;
	runtimeGraphDigest: string;
	toolchain: {
		compilerVersion: string;
		bunVersion: string;
		bundlerVersion: string;
	};
	slots: Array<{
		resourceIdentity: string | null;
		slot: "resolve" | "handler";
		runtimeGraphDigest: string;
		bundleExport: string;
	}>;
	serverBundleDigest: string;
	digest: string;
}
```

This shape is deliberately marked candidate. The proof must close canonical
sorting, domain-separated hashes, self-digest exclusion, file checksum
coverage, source maps, Runtime compatibility, and whether Context uses a null
Resource identity or an accepted identity.

## Generated layer direction

Generated code must form a one-way graph:

```text
accepted Manifest/Data/Schema + candidate operation projections
  -> concrete descriptors and runtime codecs
  -> concrete server App Contract
  -> browser-safe exposed client contract
  -> private static runtime bindings

application runtime slices
  -> type-only generated App Contract
  -> private static bindings at bundle time
```

`app.ts` remains the stable server import and `client.ts` the browser-safe
import. Files under `internal/` may split descriptors, codecs, Policy programs,
operation tables, durable programs, watch metadata, and runtime bindings for
compiler locality. Those file names are not public interfaces and should be
chosen for implementation leverage, not mirrored as application files.

The generated server contract needs exact maps for:

- Context input, Tenant, and immutable resolved values;
- Collection descriptors and Policy-enforced read/write methods by mode;
- Queries and Mutations by exact full Qualified Resource Name;
- Reaction/Job dispatch and receipt contracts;
- Actions and later Resources when their own contracts are accepted;
- direct Execution construction and lifecycle.

The generated client contains only network-exposed operations, immutable
Context scoping, exact errors, and proven watch members. It cannot import
PostgreSQL, server handlers, Policy evidence programs, durable worker code, or
private generated bindings.

## The exact handler-`ctx` type-source blocker

The design-fiction pages say that an inline handler imported from `"questpie"`
receives the concrete generated application `ctx`:

```ts
import { defineQuery } from "questpie";

export const overview = defineQuery({
	name: "channels.overview",
	handler: async ({ ctx }) => ctx.data.channels.get(/* ... */),
});
```

In ordinary TypeScript, the library declaration for `defineQuery` cannot know
the current application's generated Collection map unless the source contains
one of these mechanisms:

1. an explicit application type/value passed to the factory;
2. a generated application-specialized factory import;
3. ambient declaration merging or a global registry;
4. a required TypeScript language-service/compiler transform that injects a
   virtual contextual type.

The current public example shows none of the first two. ADR-0007 and the
TypeScript contract reject the third. The fourth can type the compiler's own
Program but does not automatically give stock editors the same hover and
completion behavior.

Therefore the current exact `ctx` claim is not implementation-ready. A focused
TypeScript proof must compile the documented import verbatim in both `tsc` and
an editor-language-service harness, with a fresh generated contract, no ambient
registry, and no previous-build types. If it cannot, the team must choose the
smallest visible type source and update the design fiction before accepting the
Operation contract. A compiler implementation must not ship `ctx: any` or a
broad base context while docs claim exact application members.

Context, Policy, structural data plans, and Collection Operation Sets do not
have this specific problem because an explicit local Collection, codec, or
input value supplies their callback types. Reaction and Job handlers do have
it because their `ctx` also promises the concrete generated App Contract.

## Discovery, ownership, and collision matrix

| Case                                                          | Required result                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Inline versus imported handler for one Definition             | Same Resource and structural contract; different handler Origin/runtime graph as applicable.                                |
| Two Query Definitions with one name                           | Fatal ordinary Resource collision.                                                                                          |
| Collection Operation Set child versus handwritten Resource    | Fatal ordinary Resource collision at the child identity.                                                                    |
| Two Collection Operation Sets emit one child                  | Fatal ordinary Resource collision; no merge or set priority.                                                                |
| Re-export one Definition through barrels                      | One Definition at declaration Origin.                                                                                       |
| Two Context Definitions                                       | Fatal singleton/context-identity collision; never last-wins.                                                                |
| Two Policies target one Collection                            | Both Resource identities can exist, but implicit default attachment is ambiguous and must fail where a default is required. |
| Policy explicitly referenced by an Operation Set              | Exact typed reference; unknown/wrong-target Policy fails compile.                                                           |
| Handler slot missing or bound twice                           | Fatal compile/build error before artifact publication.                                                                      |
| Runtime bundle and Manifest/App Contract do not match         | Runtime refuses startup; no best-effort binding.                                                                            |
| Package handler body changes but structural contract does not | Package content/lock and Runtime Build change; Package Inventory structural entry can remain unchanged.                     |
| Package operation contract changes                            | Exact Package Inventory member diff plus normal semantic/migration gates.                                                   |
| Query is not fully observable                                 | One-shot Query remains; generated watch exposure is absent with an Origin-linked explanation.                               |

## `questpie explain` is a join, not another truth

`questpie explain <resource-identity>` should read accepted/candidate canonical
artifacts, Origin Map, generated-member metadata, and Runtime Build. It should
not execute source or infer truth from bundle text.

For every executable Resource it should show:

- identity, Owner, establishing Origin, accepted contributions, and collisions;
- structural-contract digest and normalized contract members;
- input/output/error codecs and how output was inferred or pinned;
- Policy attachment, data mode, snapshot/transaction/durable mode, and limits;
- network, client alias, dispatch, and watch projections;
- executable slot Origin, runtime graph digest, and matched Runtime Build;
- static structural dependencies and compiler-recognized potential runtime
  references, clearly distinguished from actual observed Runtime dependencies;
- generated server/client members and absence reasons;
- every expansion edge from a Collection Operation Set child;
- proof-relevant diagnostics with executable recovery, never secret values.

This preserves inspectability for developers and agents without making them
maintain the compiler's internal graph.

## Candidate TypeScript and generated-size budgets

The accepted structural Query proof remains the first floor: its isolated
fixture must stay below 25,000 instantiations and currently measures 5,770.
The executable-Resource proof should add these provisional acceptance budgets:

| Budget                                                                                                                                                                     | Candidate ceiling                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| One connected fixture with six Collections, Context, two relational Policies, three Queries, three Mutations, one full Collection Operation Set, one Reaction, and one Job | at most 125,000 TypeScript instantiations under pinned TypeScript 5.9.2                                   |
| Same fixture compiler check                                                                                                                                                | at most 1.5 seconds total and 96 MiB memory on the proof host, reported with exact command and host facts |
| Isolated one-Resource hover/completion language-service request after warmup                                                                                               | p95 at most 100 ms over 100 requests; unknown members must remain negative completions                    |
| Public generated `app.ts` plus `client.ts` declarations for that fixture                                                                                                   | at most 256 KiB uncompressed                                                                              |
| Private generated binding metadata excluding executable bundle/source maps                                                                                                 | at most 4 KiB per executable Resource and linear growth from 1x to 4x fixture size                        |
| Type instantiation and public declaration scaling                                                                                                                          | 4x repeated Resources must consume no more than 5x the 1x measurement                                     |

The 125,000 ceiling is about 3.5 percent of the recorded v3 baseline of
3,618,124 instantiations. These are research gates, not accepted product limits.
The proof must report actual Types, Instantiations, memory, total time, hover
latency, declaration bytes, binding bytes, and bundle bytes. A later complete
application budget can tighten them. It cannot remove the linear-scaling gate.

Executable application code and third-party dependencies make one universal
server-bundle byte ceiling misleading. The proof should still report raw and
compressed bundle bytes, plus the delta for adding one empty Query, Mutation,
Reaction, and Job. Compiler/runtime framework overhead must be separated from
application dependency bytes.

## Historical contradictions closed by P1

The following contradictions motivated P1. ADR-0009 and proof head `713485a6`
close their compiler mechanics; remaining Context and Policy semantics move to
P2.

### ADR-0007: one Definition and one Resource

ADR-0009 accepts a closed first-party Resource Set root whose literal members
each establish one ordinary Resource. Package Inventory, Origin, relocation,
collision, and no-runtime-presence goldens passed. A general expansion callback
remains rejected.

### ADR-0007: whole-module structural evaluation

ADR-0009 accepts built-in member-aware source slicing for the six executable
slots. Handler-only imports stay out of structural evaluation, two-run
determinism passed, and impure shared captures reject with both Origins.

### ADR-0007 and `SPEC.md`: exact generated types without ambient registry

The six factories now come from the Current App Contract. The proof passes
stock TypeScript and language-service fixtures with exact mode-specific
contexts; no ambient registry or previous-build contract supplies authority.

### Accepted Resource Kind protocol: Context

Context is one application protocol Definition with fixed compiler identity
`context:app`, explicit zero/one/two-root facts, and full Origin diagnostics. It
is not a Package-extensible Resource Kind and does not rely on the export name.

### Accepted Collection composition: Policy attachment

Policy remains a separate Resource. ADR-0009 accepts only the zero/one/two
default-selection facts and collision authority; Collection discovery order
cannot choose it. P2 owns Policy behavior and lowering.

### ADR-0007: Package Inventory and executable changes

The accepted structural-contract digest excludes executable bodies. ADR-0009
pairs those bodies through Runtime Build and Package content resolution without
pretending they are structural Package Inventory changes. An active Package
body update can preserve inventory while still changing the deployment bundle;
explain and deployment review show both facts.

### ADR-0008: structural `dataQuery` is not a Query Resource

Operation normalization must embed or reference the exact accepted structural
Query bytes without granting the template Resource Identity, Owner, Origin, or
network exposure. `ctx.data.run(plan, input)` runs it inside the owning Query
snapshot or Mutation transaction. Collection Operation Set `list` emits an
ordinary Query Resource that owns the embedded plan; the plan itself remains
unbranded.

## Smallest focused proof

One proof repository/worktree should implement compiler prototypes only far
enough to answer these seams. It is not a Runtime implementation tracer.

1. Create one connected application with Context, two Policies, one inline
   Query, one imported-handler Query, one Mutation, one full Collection
   Operation Set, one Reaction, one Job, and one watchable/one-shot Query pair.
2. Compile every documented callback verbatim with exact positive hover shapes
   and negative unknown member/operator assertions in both `tsc` and a
   language-service harness.
3. Demonstrate the exact source of concrete handler `ctx` without ambient
   registry, stale generated output, `any`, `unknown`, or recursive
   whole-application authored generics. Stop if this cannot be shown.
4. Slice inline and imported handlers. Prove that handler-only side-effecting
   module initialization does not run during structural evaluation, while a
   shared impure structural capture fails with stable Origin diagnostics.
5. Run the accepted two-compilation determinism protocol with reversed source
   order and relocated checkout. Structural bytes must match.
6. Change only a handler body. Runtime Build bytes must change while Manifest,
   Schema, Data, structural Query, operation-codec, and generated public type
   bytes remain equal.
7. Change an inferred return shape. The output codec, generated server/client
   declaration, and Runtime Build must change while Schema/Data bytes remain
   equal. Prove an explicit equal output pin emits equal codec bytes.
8. Expand the Collection Operation Set and prove exact child identities,
   Owners, member Origins, Package Inventory entries, generated aliases, and a
   collision with one handwritten Resource.
9. Prove Context zero/one/two-root behavior and choose the accepted identity
   model. Prove Policy zero/one/two-default attachment behavior independently.
10. Bind every executable slot exactly once. Missing, duplicate, stale, and
    cross-build bindings must make the generated Runtime loader refuse startup
    in a small loader harness without source discovery.
11. Extract direct literal durable effect names, reject an unextractable site,
    and show body/effect compatibility changes in explain output.
12. Derive watch exposure for one fully observable Query and reject it for one
    Query with an unsupported effect. Execute branch instrumentation only in a
    fake observer to prove replacement rather than historical union; do not
    implement Change Ledger or network realtime here.
13. Snapshot normalized candidate artifacts, Origin joins, generated files,
    structured diagnostics, and `questpie explain` output.
14. Run and report the TypeScript, language-service, generated-size, scaling,
    and bundle-delta budgets above with Bun.

The proof passes only when all structural artifacts, generated declarations,
and Runtime Build pairing can be explained from the one authored Definition
without a handler registry, capability map, file convention, runtime scan, or
implicit collision winner.

## Stop conditions

Stop and revise the candidate interface if implementation requires any of the
following:

- `ctx: any`, `ctx: unknown`, broad Collection names, or an ambient application
  registry to make inline handlers compile;
- compile N-1 generated types as the semantic source for compile N;
- evaluation of handler-only imports during controlled structural compilation;
- a second handler export, repeated Resource name, file-pairing convention, or
  application-maintained binding registry;
- a per-Operation Collection capability map that repeats generated `ctx.data`;
- runtime source discovery, Definition merging, Resource Set expansion, or
  collision selection;
- a hidden CRUD engine with different Policy, transaction, codec, error, or
  observation behavior from ordinary Query and Mutation Resources;
- Policy attachment through import order or an unauthorized Collection patch;
- a watch list authored separately from the Query or static call-site guesses
  used as actual Live Query dependencies;
- handler source paths or export names entering Resource Identity;
- executable body bytes entering Schema Projection, Data Contract Projection,
  structural Query bytes, or migration checksums;
- a Runtime Build mismatch that logs a warning and continues;
- generated declarations or metadata that grow quadratically with Resources.

## Completed P1 decision order

P1 closed these decisions in order:

1. prove or revise the visible exact handler-`ctx` type source;
2. prove the built-in structural/executable source split;
3. accept or reject the closed multi-Resource Operation Set amendment;
4. choose Context identity and Policy attachment authority;
5. freeze normalized Operation/durable/watch projections and Runtime Build
   pairing bytes;
6. pass the focused type, size, collision, relocation, and loader proof;
7. request one fresh Opus-medium acceptance review.

The pass is recorded in ADR-0009, canonical terms, public v4 documentation, and
implementation gates. P2 is next; production compiler and Runtime work remains
blocked until the connected tracer authorizes it.
