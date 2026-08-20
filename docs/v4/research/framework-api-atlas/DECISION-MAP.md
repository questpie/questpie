# QUESTPIE v4 ideal framework API atlas decision map

> ADR-0026 supersedes forward conclusions that expose Workflow as a separate
> Resource/factory. Their closed checkpoint semantics remain current as Job;
> historical evidence and pinned proof heads remain unchanged.

- Status: research frontier; no acceptance authority
- Objective: design the coherent ideal QUESTPIE v4 developer interface before
  implementation, then derive `4.0.0-beta.1`, later betas, and 4.0 from it
- Product moat: smart generated developer experience over compiled static
  contracts, PostgreSQL transactions, observed realtime, and durable execution
- Authority discipline: accepted contracts remain fixed until concrete whole-
  product evidence justifies a focused superseding decision; `SPEC.md` and
  `CONTEXT.md` are authoritative but may be incomplete
- Projection discipline: research stays here until one focused contract, proof,
  and independent Opus-medium acceptance review pass; only then update ADRs,
  canonical terms, public docs, implementation gates, and tickets
- Proof sequence: [`PROOF-MAP.md`](./PROOF-MAP.md) turns the atlas into six
  dependency-ordered executable acceptance chapters
- Current proof state: P1–P6 are accepted. P6 proof head
  `94c237c9aa910a60a332b1ef97473f34fe89d65b` passed local PostgreSQL 17.10,
  managed Supabase PostgreSQL 17.6, replacement focused Opus-medium review, and
  the separate connected-tracer Opus-medium review. The post-P6 implementation-
  gate closure is accepted at `a164e33e752ab54d48fcf903371938ecff3dc082`;
  its reviewed clean evidence head `79d7816d` received a fresh focused
  Opus-medium `PASS`. Ticket #17 is accepted by ADR-0015; its reviewed clean
  proof input is `7211bd3c8a9cdbe131b026874d4441f3ccb39c9d`, acceptance record
  head is `79d3667019e0a4cda6f7652d24f2d9c6b68d4fca`, and the fresh stateless
  Opus-medium verdict is `PASS`. Ticket #18 is accepted by ADR-0016; reviewed
  clean input `fa2960083c94f824d7c0f4d005a9aec01babb978`, acceptance evidence
  head `71463e99a70481b0950ae18d1ff409c034c1b158`, fresh stateless
  Opus-medium verdict `PASS`. Ticket #19 is accepted by ADR-0017; initial
  reviewed head `be611ef244687be9daccc2a9e02fbd2e2ccfe86e` was `BLOCKED`, exact
  repaired reviewed head `039a720d12956ddc8e1a310e287945de35a52065`, acceptance evidence
  head `96829bd7b08ea54e60fdc7d5b077366235d2dfea`, replacement fresh
  stateless Opus-medium verdict `PASS`. Ticket #20 is accepted by ADR-0018;
  initial reviewed head `fb06a82c195ad3eeb3f1feddc4a9261e278033fd`
  was `BLOCKED`, repaired reviewed head
  `eaa21e0ca2c4a3b941a04e98b1a0278d0fe0aba9`, acceptance evidence
  head `6e056bc44c15740b2797a9489fe3823c3100bdad`, replacement fresh
  stateless Opus-medium verdict `PASS`. Ticket #21 is accepted by ADR-0019 at
  evidence head `d50d4334b116a5bdc46e95cdabf566d8db938d37`. Ticket #22 is accepted
  by ADR-0020: initial reviewed head `bf45e2036fb1796f7f97899b9ef5672bdce4d27d`
  was `BLOCKED`; repaired reviewed head
  `fe8b5158d4d4eefb5920f07b3c7198fa3a4d8553` received replacement fresh
  stateless Opus-medium `PASS`; evidence head is
  `17008b0547f24b53d456530b798e8d96ae2e2b1e`

## Depth and porting rule

The atlas prevents an early public API from blocking later product ownership;
it does not require the complete Workflow, Search, File, Studio or Cloud API to
be frozen before the first implementation tracer. For a later capability, the
current pass needs its jobs, owner, invariant seams and absence story. Its exact
authoring syntax closes only in its own focused vertical.

V3 is the behavioral baseline, not merely a catalogue of mistakes. Preserve a
v3 job unless accepted v4 direction or a concrete failure case rejects it. The
first usable v4 layer should retain the convenience of typed application
context, Policy-aware Collection reads/writes, generated CRUD/client surfaces,
custom operations and lifecycle extension points while changing the mechanisms
that caused known failures. The working rule is:

> v3 jobs, v4 ownership and invariants, the fewest new public concepts.

Known mechanisms that do not survive unchanged include transport/direct-call
authority drift, ambient System or raw-database bypass, create rules that are
typed but ignored, pre-transaction write hooks, lossy fire-and-forget commit
callbacks, runtime Module/plugin merge and recursive whole-app type inference.
Other v3 ergonomics require evidence before rejection.

## Acceptance lens for every ticket

Every capability design must answer the same questions before acceptance:

1. What does a complete end application look like? Show the normal authoring,
   generated server `ctx`, generated client, and operational/Studio view.
2. Where does every callback and fluent member get its exact contextual type?
   The documented fixture must compile verbatim with autocomplete/hover,
   negative type tests, emitted declarations, and measured TypeScript budgets.
3. Which Resource owns identity, authority, lifetime, transaction/snapshot,
   retry, cancellation, output, durable state, and external effects?
4. Which facts are static compiler artifacts, which are runtime observations,
   and which are durable PostgreSQL state? Do not duplicate one truth in an
   author-maintained manifest.
5. How does the capability behave under direct, Fetch/client, nested, realtime
   recompute, worker, retry, restart, and Studio execution where applicable?
6. What are its failure, nondisclosure, concurrency, idempotency, and resource-
   limit semantics?
7. Which simpler interface was considered, and what concrete use case proves
   each extra concept earns its place?
8. Which compiler/runtime seam enables later capability breadth without a
   public plugin ABI, runtime merge, ambient registry, or hidden magic?

## #1: Which whole-product journeys define the ideal framework?

Blocked by: none
Type: Discuss

### Question

Choose a compact but adversarial application model that exercises the full
vision: companies, spaces/channels, memberships and roles, messages, realtime
views, transactional writes, durable reactions/jobs, one workflow, one custom
Route, one external Action, Auth-derived Principal, search, Files, Studio, and
generated clients. Define the developer and operator journeys before choosing
individual APIs.

### Answer

Partial direction. The current `workspaces`/`memberships`/`tasks` beta fixture
is useful but too weak as the whole-product design fixture. The candidate atlas
fixture is Company -> Space -> Channel -> Membership -> Message, with approval
or publishing, one external delivery Action and durable search indexing. See
[`whole-product-journeys.md`](./whole-product-journeys.md).

`SPEC.md` section 13 remains the behavioral lower bound for the first real
tracer: Policy, exact client types, watched Query, transaction-owned durable
Reaction intent, Change Ledger, crash recovery, direct/network/Studio parity,
managed PostgreSQL, retry/idempotency and explicit budgets all remain required.
The user's later decision permits replacing Barbershop as the domain fixture;
that future focused SPEC amendment may change the noun, never weaken the twenty
behavioral proof obligations. The conformance fixture is not a product starter
or CMS ontology.

## #2: What is the universal Resource and generated-context authoring shape?

Blocked by: #1
Type: Prototype

### Question

Across Collection, Policy, Query, Mutation, Action, Route, Live Query, Reaction,
Job, Workflow, Auth and later integrations, close the few repeatable authoring
patterns: direct exported Definitions, inline executable slots, inferred local
input/output, optional pins, concrete generated `ctx`, exact client projection,
Origins, explanation, and file-locality budgets. Prove contextual typing instead
of designing APIs that exist only in prose.

### Answer

Leading candidate: one Definition and inline handler; source files are
organization, not semantics; generated `ctx` replaces per-call capability
enumeration; handler return is inferred when its wire contract is provable.
Executable factories are imported from the concrete generated application:

```ts
import { defineMutation, defineQuery } from "#questpie/app";
import { operation, policy } from "questpie";
```

That visible source lets stock TypeScript explain exact application `ctx`
autocomplete without an ambient registry, per-handler generic, capability map,
or extra binder file. A Package uses its own generated `#questpie/package`
factory surface and cannot see host-only Resources. Current evidence:
[`executable-operation-binding-designs.md`](../beta1-cut/executable-operation-binding-designs.md).
The framework-user learning path and SPEC coverage are staged in
[`../../design-fiction/README.md`](../../design-fiction/README.md) and
[`../../design-fiction/COVERAGE.md`](../../design-fiction/COVERAGE.md). These
reader pages are an API design test, not public authority.

Compiler mapping exposed a blocking TypeScript issue in
[`compiler-realization-map.md`](./compiler-realization-map.md): a generic
`defineQuery` import from `"questpie"` cannot contextually type the current
application's concrete generated `ctx` in stock TypeScript without a visible
application type/value source, ambient registry or editor transform. Ambient
registration and `ctx: any` remain rejected. Two stock-TypeScript prototypes
passed: the source-owned binder at 1,409 instantiations and the generated
factory at 7,091 instantiations with declaration emit. ADR-0009 now accepts the
generated factory after proof head `713485a6` and one fresh Opus-medium `PASS`.
The narrow amendment allowlists only the six pure executable Definition
factories from the compiler's Current App Contract, never emitted disk Runtime
output. See
[`ctx-type-source-generated-factory.md`](./ctx-type-source-generated-factory.md)
and
[`ctx-type-source-explicit-binding.md`](./ctx-type-source-explicit-binding.md).

## #3: How are Principal, Tenant, Authority, and resolved Context produced?

Blocked by: #1, #2
Type: Discuss

### Question

Design trusted Context Resolution for Fetch, direct calls, Query/Mutation,
realtime recompute, Route, Action, Reaction, Job, and Workflow attempts. Decide
which values are immutable Execution facts, which are generated application
context, how typed resolution can query memberships without Policy bootstrap
cycles, when it runs relative to snapshots/transactions, caching, failure,
refresh/revocation, causation propagation, and what workers inherit versus
re-resolve.

### Answer

Accepted by ADR-0010 after P2 proof head
`5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` and one fresh focused
Opus-medium `PASS`.

`defineContext({ input, resolve })` declares one transport-neutral application
input and one exact resolved result. A root Execution resolves once, coalesces
concurrent consumers, freezes Principal/Tenant/Authority/resolved values,
propagates them into nested work, and disposes scoped Services after success or
failure. Failure occurs before Policy or a handler. Resolution has only bounded
read-only exact-key `bootstrap.get`, with no raw DB, write, Queue, Service, or
System capability.

Generated `client.withContext(input)` returns an immutable scope. Direct roots
use `app.execution({ principal, context }, callback)` and have ordinary
Authority only. Route transitions, recomputations, durable attempts, and Studio
create deliberate fresh roots; nested work inherits. System Authority needs an
unforgeable Runtime capability and is not an ambient Policy bypass.

Mutable membership and role facts remain Policy evidence inside the owning
Query snapshot or Mutation transaction. A resolved convenience role cannot
authorize later work. P3 owns snapshot/transaction mechanics, P4 owns observed
refresh, P5 owns durable run-as persistence, and P6 owns concrete generated
wire and production Runtime construction. Concrete Auth Packages remain later.
See [`policy-and-execution-frontier.md`](./policy-and-execution-frontier.md),
[`v3-context-resolution-jobs.md`](./v3-context-resolution-jobs.md), and the
accepted contract at [`../../context-and-policy.md`](../../context-and-policy.md).

## #4: What Policy model handles real relational authorization?

Blocked by: #1, #2, #3
Type: Prototype

### Question

Close admission, relational row scope, caller-input and output Field authority,
candidate-state authority, target Relation Policy, complex membership/role
conditions, reusable structural predicates, SQL pushdown, cycles,
nondisclosure, System Authority, later RLS projection, and parity across all
Execution kinds. Prove company/space/channel/message access rather than only a
single tenant-id equality.

### Answer

Accepted by ADR-0010 after P2 proof head
`5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` and one fresh focused
Opus-medium `PASS`.

`definePolicy(collection, body)` is Collection-bound, compiled, fail-closed,
and SQL-pushed. It decides admission, existing/current row scope, sparse
supplied-input Field authority, selected-output Field omission, and complete
candidate authority; it never rewrites values. `policy.exists(collection,
predicate)` is bounded typed correlated boolean evidence. It does not disclose
the target row or recursively apply that Collection's presentation Policy;
ordinary returned rows and Relations do apply target disclosure Policy.

One normalized Policy AST owns canonical artifacts and framework SQL lowering.
Row scope precedes filters, counts, key lookup, cursor boundaries, the
`first + 1` sentinel, ordering, locking, and disclosure. Missing and invisible
rows and references are nondisclosing. A lock waiter must recheck current
mutable evidence and candidate authority in the Mutation transaction.
Dependencies include membership creation, deletion, role, status, and scope.
Direct, network, nested, recompute, worker, Route-transition, and Studio paths
produce the same decision from equivalent Execution facts.

P2 emits no RLS and makes no database-enforced authorization claim. Broad RLS,
recursive Policy graphs, advanced joins, typed JSON-interior Policy,
maintenance/System APIs, and non-B-tree or native-SQL performance contracts
remain later seams. P3 owns candidate construction and transactional write
execution. See [`policy-and-execution-frontier.md`](./policy-and-execution-frontier.md),
the earlier inputs in
[`policy-contract-design.md`](../beta1-cut/policy-contract-design.md) and
[`v3-access-jobs.md`](../beta1-cut/v3-access-jobs.md), and the accepted contract
at [`../../context-and-policy.md`](../../context-and-policy.md).

## #5: What are the ideal Query, Mutation, Action, and Route interfaces?

Blocked by: #2, #3, #4
Type: Prototype

### Question

Design the four semantic Operations together so their differences are obvious
from end-app code: Query snapshot/read observation, Mutation transaction and
durable-dispatch ownership, Action external effects and retry contract, Route
HTTP/protocol control. Close inferred codecs/errors, generated `ctx`, nesting,
delegation, deadlines, cancellation, concurrency, limits, exposure, direct and
client calls, and escape hatches without turning everything into a Route.

### Answer

Query and Mutation are accepted by ADR-0011 after P3 proof head
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d` and one final fresh focused
Opus-medium `PASS`. Action and Route remain focused later contracts.

Named Query and Mutation use the generated Current App Contract, one local
exported Definition, one inline handler, exact codecs/errors, inferred or
explicitly pinned output, and mode-specific generated `ctx`. Query owns one
bounded consistent read snapshot and has read-only data capabilities. Mutation
owns one PostgreSQL transaction joined by every generated read/write,
validation, audit write, result receipt, and typed pending dispatch intent.

The closed Collection Operation Set lowers `list/get/create/update/delete` to
ordinary Resources before Manifest emission. Its children use the same Policy,
codecs, snapshot or transaction, errors, limits, and observation engine as a
named Resource; no runtime CRUD dispatcher survives. Stable call identity,
input-digest binding, exact duplicate replay, response-loss recovery,
pre-commit rollback, post-commit ambiguity, and distinct direct/wire adapters
are fixed. See
[`../../query-mutation-and-lifecycle.md`](../../query-mutation-and-lifecycle.md).

## #6: What lifecycle replaces v3 hooks?

Blocked by: #4, #5
Type: Prototype

### Question

Assign decoding, validation, normalization, server-owned assignments,
candidate checks, transaction-joined derivation, committed change facts,
post-commit durable Reaction, external Action and output shaping to explicit
owners. Show common Field and cross-Collection examples without a generic
before/after callback bag. Close ordering, errors, retries and what is forbidden
in each phase.

### Answer

Accepted by ADR-0011 with P3. The minimal lifecycle is closed pure caller-input
normalization, closed server `values`, a named Mutation for cross-Collection
logic and transactional audit, a typed transaction-owned pending dispatch
intent for durable follow-up, and an Action for external effects. There is no
general lifecycle Resource or `before*`/`after*` callback catalogue.

Caller Field authority runs before normalization. Defaults and server values
then construct a complete candidate before validation, candidate Policy, and
PostgreSQL Constraints. Output authority and validation happen before the one
commit; encoding follows commit. `createdAt` and `updatedAt` are ordinary
Fields and every server assignment is explicit. ADR-0013 now accepts the
Reaction delivery implied by pending intent; the complete Action contract
remains a later focused vertical. See
[`../../query-mutation-and-lifecycle.md`](../../query-mutation-and-lifecycle.md).

## #7: What is the observed Live Query and realtime client contract?

Blocked by: #3, #4, #5, #6
Type: Accepted contract

### Question

Design `watch` from a normal Query through actual-read dependency capture,
Policy/context dependencies, Change Ledger capture, lossy wakes plus durable
reconciliation, cursor/checkpoint/reconnect, recomputation, backpressure,
fanout, authorization revocation, schema/runtime deployment changes, raw SQL/
cascade/external-writer capture, client cache integration and Studio inspection.
Choose the consistency claim for several related watched Queries.

### Answer

Accepted by ADR-0012 after P4 proof head
`05fc96f3d07c70beaf7f654d79d6cfb46f427f92` and a replacement fresh focused
Opus-medium `PASS` after hostile review repairs.

The same generated Query method owns one-shot calls and `.watch`. Complete
`initial`, `update`, and `reset` results use compiler-declared watchability and
Runtime-observed actual reads. Successful recomputation replaces dependency
plans; failure or revocation preserves the last successful plan and discloses
nothing. Every recomputation creates a fresh Context/Policy root.

Compiler-owned triggers append bounded Change Ledger facts in the business
transaction. `LISTEN`/`NOTIFY` is wake-only. Reconciliation persists an
exclusive `xid8` PostgreSQL visibility horizon, so opposite allocation/commit
order and sequence wrap cannot skip a fact. Generated clients manage opaque
authenticated resume tokens and reset on incompatible or unavailable state.

Supported raw DML, cascades, managed external writers, `COPY`, `ON CONFLICT`,
`MERGE`, and `TRUNCATE` share one capture boundary; partitioned reactive
Collections fail. Independent Queries converge independently. P4 adds only
B-tree indexes, emits no RLS, and makes no RLS claim. See the accepted contract
at [`../../live-query-and-change-ledger.md`](../../live-query-and-change-ledger.md),
primary evidence in [`realtime-primary-sources.md`](./realtime-primary-sources.md),
and the v3 job audit in
[`v3-realtime-durable-jobs.md`](./v3-realtime-durable-jobs.md).

## #8: What are Transactional Dispatch, Reaction, and Job?

Blocked by: #3, #5, #6
Type: Research

### Question

Design atomic dispatch from a Mutation, durable Reaction to committed change,
general Job dispatch, scheduling, payload codecs, identity/idempotency,
at-least-once attempts, leases/heartbeats, retry/backoff, cancellation, terminal
failure, concurrency, deduplication, result/error contracts, context/authority
propagation, external Action calls, observability and crash recovery. Keep Queue
an operational surface rather than a composition container.

### Answer

Accepted by ADR-0013 after P5 proof head
`3f8618613bde1bdd7e13863970eb1c140e201c6f` and a replacement fresh focused
Opus-medium `PASS`; its public projection passed factual, prose/IA, and
executable-example audits. The accepted P5 slice closes Mutation-owned atomic
Transactional Dispatch, caller-run-as Reaction, exact codecs, distinct durable
identities, short claims, attempt/lease fencing, current Policy, bounded retry,
timeout, cancellation, effect ambiguity, retention, executable pinning, and
safe events. See the accepted contract at
[`../../transactional-dispatch-and-reaction.md`](../../transactional-dispatch-and-reaction.md).

Primary-source research is complete in
[`durable-execution-primary-sources.md`](./durable-execution-primary-sources.md).
Confirmed direction: a Mutation commits business state and durable intent in
one PostgreSQL transaction; workers claim in short transactions, persist a
lease plus fencing token, and never hold that transaction while user code runs;
dispatch/run, physical attempt, lease and external-effect identities remain
distinct; execution is explicitly at-least-once; each attempt creates a fresh
declared run-as Execution rather than inheriting worker System Authority.
ADR-0016 now accepts Job as an explicit direct, Mutation, delayed, or scheduled
producer over the same machinery, and accepts Workflow's closed checkpoint,
timer, signal, history, and version seam over that kernel. They retain different
developer meanings. The KISS authoring journey is staged in
[`../../design-fiction/durable-work.md`](../../design-fiction/durable-work.md);
the v3 evidence is
[`v3-realtime-durable-jobs.md`](./v3-realtime-durable-jobs.md).

## #9: What is a Durable Workflow without a second runtime?

Blocked by: #8
Type: Research

### Question

Design Workflow Definition/handler/state/history over the same Job, lease,
timer, signal and attempt primitives. Cover deterministic orchestration versus
ordinary TypeScript, Activities/Actions, waits, signals, child workflows,
versioning/deployment, compensation, cancellation, retries, idempotency,
queries, human approval, generated client, Studio history and replay. Show one
complete end-app workflow and state exactly what QUESTPIE will not promise.

### Answer

ADR-0016 accepts Workflow as a capability-scoped projection over the same
persisted run, lease, timer, signal, effect-identity and history kernel as Job
and Reaction. Its closed commands are named generated Mutation, named generated
Action, durable sleep, and typed signal wait; ordered command digests and pinned
semantic version/executable bytes reject arbitrary callback steps and latest-
code replay. The reader journey is staged in
[`../../design-fiction/durable-work.md`](../../design-fiction/durable-work.md),
but no complete Workflow product is required for beta.1. Signal authorization,
child work, compensation, continuation/history limits, result queries, and a
multi-version evolution matrix remain the explicit absence story.

## #10: How do Auth, Files, Search, and external systems integrate?

Blocked by: #2, #3, #4, #5, #8
Type: Research

### Question

Design first-party capability-specific Definitions and runtime slots without a
generic compiler/provider SPI. Auth resolves credentials to Principal; File
records retain Policy/lifecycle while storage owns bytes; Search indexing uses
transactional/durable change semantics; external integrations use Actions and
Jobs. Decide portability seams only where a second concrete adapter exists.

### Answer

Design evidence is now
[`routes-actions-integrations-design.md`](./routes-actions-integrations-design.md).
Leading KISS ownership: `defineRoute` owns raw protocol and may call a server-
only Mutation only after verification and an explicit trusted application
transition; `defineAction` owns one external effect with stable effect key,
cancellation and no automatic transaction retry or `ctx.data`; a concrete Auth
Package maps its native session to Principal without a generic compiler SPI;
File metadata and Policy authorize before a byte capability; Search follows
committed durable state and returns one authorized candidate universe rather
than defining `searchAccess`. A third-party webhook does not invent generated-
client Context input. Search and broad Actions may ship after beta.1, but these
ownership seams must not be blocked by beta shortcuts. Developer-guide
projection is complete in
[`../../design-fiction/routes-actions-and-integrations.md`](../../design-fiction/routes-actions-and-integrations.md).

## #11: What Runtime, Fetch, generated-client, and deployment contract binds it?

Blocked by: #2, #3, #4, #5, #7, #8
Type: Prototype

### Question

Close startup/readiness/health/shutdown, artifact matching, request and worker
Execution creation, deadlines/cancellation, network exposure, stable envelopes,
streaming/realtime protocol, generated direct/client surfaces, version
negotiation, deployment compatibility, restart/drain, PostgreSQL roles and one
managed-provider conformance target.

### Answer

Accepted by ADR-0014 and proof head `94c237c9`. `questpie build`, explicit
reviewed migration apply, and `questpie start` form one path. The immutable
bundle binds exact compiler, schema, executable, Change Ledger, durable, Origin,
generated-type, and wire artifacts. Generated `createApp()` exposes only
`fetch`, `execution`, and idempotent `close`; generated clients use immutable
`withContext` scopes and exact closed wire frames. Startup, readiness,
reconciliation, refusal, restart, and bounded drain execute under the combined
`all` role. Schema, wire, Policy/Context, realtime, executable, and internal
protocol compatibility remain separate decisions. Local PostgreSQL 17.10 and
managed Supabase PostgreSQL 17.6 pass without a host/provider SPI or RLS claim.
See [`../../runtime-client-envelope-and-studio.md`](../../runtime-client-envelope-and-studio.md).

## #12: What Execution Envelope and Studio expose one operational truth?

Blocked by: #3, #4, #5, #7, #8, #9, #11
Type: Prototype

### Question

Design the append-only correlation envelope and minimal Studio views for
compile/Origin, migrations, Policy, operations, transactions, Change Ledger,
realtime subscriptions, dispatch, Job/Workflow attempts, logs/traces/audit and
safe data operations. Studio consumes canonical artifacts and runtime events;
it does not become a second backend or Operator App framework.

### Answer

Accepted by ADR-0014 and proof head `94c237c9`. One closed versioned Execution
Envelope correlates safe append-only Runtime events and excludes credentials,
database URLs, raw payloads, Policy evidence, serialized Context, Services,
secrets, and stack traces. Studio uses ordinary generated Operations and Policy
for application data. CLI and Studio explain from canonical artifacts, Runtime
state, receipts, and events. Four narrow maintenance commands require explicit
maintenance Authority, idempotency, expected-version fencing, a typed winner,
bounded reason, and append-only audit. Studio has no second backend, raw SQL,
internal-table CRUD, Policy bypass, `defineStudio`, or Operator App framework.
Remote/fleet Studio and its authentication remain later seams.

The final public Runtime/Studio projection passed independent Opus-medium fact,
prose/IA, and executable-example audits. Its credential-free rerun passed the
local P6 matrix and correctly withheld managed-provider conformance without a
credential environment. The four post-P6 integration blockers are closed by
proof head `a164e33e`: P4 retention and wrap run in a proof-owned PostgreSQL
cluster with causal and negative controls; CLI and Studio use independent
explanation producers; the connected migration lifecycle reaches apply,
immutable receipt, retry, tamper, Drift and repair; and one exact Owner-accepted
Package Augmentation reaches the matched Runtime, generated type and editor.

## #13: Which compiler artifacts and internal seams realize the atlas?

Blocked by: #2, #4, #5, #6, #7, #8, #9, #10, #11, #12
Type: Prototype

### Question

Extend the accepted compiler foundation and Runtime Build shell with the
minimum closed Resource-kind contracts, Environment Slot slicing, generated context/client,
Policy programs, operation codecs, observed dependency instrumentation,
dispatch/workflow artifacts and explain joins. Keep one-way generated layers,
canonical bytes, Owner/Origin, type budgets and no public compiler plugin ABI.

### Answer

P1 and P3 are accepted. P1's Current App Contract factories, source slicing, output
rounds, Package isolation, Collection Operation Set expansion, Context/Policy
compiler ownership facts, Runtime Build pairing, Origins, determinism, and
budgets are closed in ADR-0009 and proof head `713485a6`. P3 closes exact
Operation codecs, generated mode-specific Context/client surfaces, ordinary
Operation Set child contracts, transaction/call/result-receipt projections,
normalizer/value programs, lifecycle ordering, and Operation explanation in
ADR-0011 and proof head `a09bf55f`.
[`PROOF-MAP.md`](./PROOF-MAP.md) retains the remaining chapter sequence.
Policy behavior and observed Live Query dependencies are closed in ADR-0010 and
ADR-0012. Durable Reaction transitions are closed in ADR-0013. Runtime, wire,
client, Execution Envelope, and minimal Studio are closed in ADR-0014. The
connected implementation is no longer blocked by the four post-P6 integration
gates. A final
public spelling consolidation remains open after the semantic chapters: compare
the accepted named `define*` factories with compiler-specialized
`define.<kind>` and `<kind>.define` families. It may change ergonomics only
after exact Current App Contract inference, Package isolation, declarations,
and editor budgets pass; it cannot reintroduce a registry or move executable
Definition ownership into stable structural builders.

## #14: What conformance applications and hostile matrices prove the design?

Blocked by: #1 through #13
Type: Discuss

### Question

Define the complete type, compiler, PostgreSQL, runtime, realtime, crash,
retry, deployment, client and Studio evidence suite. Use at least one relational
collaboration app and one materially different domain to catch accidental
tenant/CRUD assumptions. Measure type/editor/build/runtime budgets and run on
local PostgreSQL plus a selected managed target.

### Answer

Accepted conformance map. The primary collaboration/publishing fixture is
Company → Space → Channel → Membership → Message. The materially different
archive fixture uses Institution, append-oriented Record, ResearchPermit,
Embargo, and immutable Provenance; it catches tenant-equality,
membership-only, mutable-CRUD, and collaboration-ontology assumptions.

Twenty owned cells cover definitions/Origins, scalar and exports, migrations
and Seeds, Context, Policy, Query, Mutation, lifecycle, Live Query, the shared
durable kernel, Service/Route/Auth, HA, accelerators, Channel, File, Search,
contract projections, Execution Envelope, managed PostgreSQL, and performance.
Each names fixtures, execution surfaces, hostile invariants, lane, and required
artifact. Direct/network/Studio parity, worker and recompute roots,
ten-instance rolling/crash contention, optional-infrastructure loss, exact
types/imports, and two domains are cross-product gates.

Correctness, micro, load, and soak remain separate. Local PostgreSQL blocks;
one selected managed target is connected-tracer release evidence. The
repository owns harness and schema while implementation slices own measured
budgets. V3 tests supply behavioral hostile cases but their test organization,
provider matrices, and slow loop are rejected.

Initial reviewed head `e222be74` was validly BLOCKED for a tautological checker
and missing Channel ownership. Repair `56a39c27` adds structured row checks,
five negative controls, and separates Channel Resource semantics from its
optional carrier. Replacement fresh stateless Opus-medium review returned
PASS; evidence head `3a89c565cb1eba59815d106df1c06406ac20ac98`.

## #15: What ships in beta.1, later betas, and 4.0?

Blocked by: #14, #17, #18, #19, #20, #21
Type: Discuss

### Question

Slice the accepted ideal contract into tracer bullets without inventing smaller
public APIs that later need replacement. Each deferred capability must retain a
named internal seam and an explicit absence story. Decide exact release labels,
compatibility expectations and evidence gates.

### Answer

Accepted by ADR-0021. `4.0.0-beta.1` is the smallest connected P1–P6 vertical:
foundation, schema, Service lifetime, Context/Policy, Query/Mutation and
Collection Operations, immutable Runtime/generated client, watched Query and
Change Ledger, one committed-fact Reaction over the shared durable kernel,
minimal Studio, and connected conformance.

The primary fixture is collaboration/publishing; archive/permit/embargo proves
portability. PostgreSQL is the only durable dependency, public Index remains
B-tree-only, and no RLS claim is made. Action, raw Route/credential Auth,
generic Job/Workflow breadth, Channel, File bytes, Search, OpenAPI/MCP/skills,
optional accelerators, split Runtime roles, and remote Studio each retain an
exact named seam and absence story in the checked slice artifact. Initial
review head `49e14260` was BLOCKED because Service lifetime had no owner and
Context disposal preceded it. Repair `5c4bdfa6` adds a first-class Services
slice and executable negative gates; replacement fresh stateless Opus-medium
review returned PASS. Evidence head `0d8e2543ff7e9d50bdab7d2b66b62ec4c35d8a6f`.

## #16: How is the accepted atlas turned into implementation work?

Blocked by: #15, #22
Type: Discuss

### Question

Project focused PASS decisions into the minimum ADR set, canonical glossary,
public ideal-product documentation, implementation gates and a dependency-
ordered tracer specification. Then create small agent-ready issues with exact
artifacts, fixtures, budgets and blocking edges. Implementation begins only
after this collapse; research notes never serve as implicit specifications.

### Answer

Fog.

## #17: Which Service, Route, and Auth primitives make integrations composable?

Blocked by: #2, #3, #4, #5, #10, #11
Type: Prototype

### Question

Design the smallest typed Service lifetime and Route/Fetch mounting contracts
that let an application integrate any auth library without making Auth a second
authorization system. Show user-owned Collections and auth client, credential
or session resolution into trusted Context and Principal, Package isolation,
direct/Fetch parity, cleanup, and one Better Auth reference composition. Decide
what core owns and what remains ordinary application or Package code.

### Answer

Accepted by ADR-0015. One compiler-owned graph contains explicit Service and
Route Definitions. Services have stable identity/Owner/Origin, explicit
dependencies, application or execution lifetime, and transaction-safe or
external effect class. Invalid application-to-execution and safe-to-external
dependency edges fail. Application instances are isolated per Runtime;
execution instances are isolated per root through response EOF, error, or
cancellation; lazy creation coalesces and reverse dependency cleanup runs once.

Route is the bounded raw Fetch escape hatch mounted into the one generated
`app.fetch`. Its capability-scoped context has exact Request/Response control,
typed params, Principal, signal/deadline, and Route-safe Services, but no data,
Mutation, raw database, or ambient System authority. `ctx.execution` explicitly
enters the accepted Context/Policy/Operation engine. Generated direct Route
invocation requires an ingress Principal and reuses the same handler/lifetime
kernel; Route does not enter the JSON Operation client.

Zero or one credential resolver binds one application/external Service and
returns resolved Principal, anonymous, or typed failure. It never decides
Policy, Tenant, or Authority. Auth Collections, schema participation, server
object, and native client remain application/ordinary Package ownership. A
later Better Auth reference Package may compose normal Definitions, but it has
no mandatory schema, separate migration path, compiler privilege, or generated-
client authority. Reviewed proof input `7211bd3c8`; accepted evidence head
`79d36670`; fresh Opus-medium verdict `PASS`.

## #18: Which lifecycle jobs and durable authoring concepts survive?

Blocked by: #5, #6, #8, #9, #17
Type: Prototype

### Question

Audit v3 `beforeValidate`, `beforeChange`, `afterChange`, `afterRead`, Queue,
Job and Workflow jobs against accepted P3 and P5. Distinguish pure
normalization/validation, transaction-owned derivation, selected-result
projection, and post-commit durable work. Test whether Job, Reaction and
Workflow can share one durable run/attempt/lease kernel while differing only in
dispatch authority, committed-fact trigger and checkpointed `ctx.step`
capability. Prove cancellation, retry, resume, version and generated-client
boundaries without creating three runtimes.

### Answer

Accepted by ADR-0016. The v3 lifecycle jobs retain explicit v4 owners:
`beforeValidate` maps to codecs and closed pure normalization/validation or a
named Mutation; `beforeChange` maps to closed server values or a named Mutation;
`afterChange` maps to transaction-joined audit/application work plus exact
committed durable dispatch; and `afterRead` maps to selection/output codecs,
closed pure projection, or a named Query in its read snapshot. No general hook
catalogue, priority, or arbitrary lifecycle callback is accepted.

Job, Reaction, and Workflow are three capability-scoped compiler Resources over
one PostgreSQL Durable Run/attempt/lease/history kernel. Job is explicitly
accepted now, delayed, or by durable schedule under scoped idempotency. Reaction
exists only from one exact committed fact with compiler-derived causation and
no second author key. Workflow adds named generated Mutation and Action
checkpoints, durable sleep, typed signal wait, ordered command digests, and
semantic-version/executable pinning. It has no `step.run` callback or latest-
code replay.

The generated browser client exposes no generic durable controls; applications
publish selected Policy-protected Operations. Complete Workflow authorization,
child work, compensation, limits, and multi-version evolution remain a later
vertical. Ticket #19 owns concurrent schedulers and ten-instance HA. Reviewed
input `fa2960083`; accepted evidence head `71463e99`; fresh stateless
Opus-medium verdict `PASS`.

## #19: What HA and optional-infrastructure contract preserves PostgreSQL truth?

Blocked by: #7, #8, #11, #12, #18
Type: Prototype

### Question

Prove default correctness with ten compatible application instances, arbitrary
request routing, crash, rolling deployment and concurrent worker ownership.
Then design optional typed Memory/Redis KV, notification-broker and
Channels capabilities for Query caching, invalidation distribution and
collaboration. PostgreSQL must remain the only hard durable dependency; lost
cache or broker state must fall back or reset safely and may not change Policy,
Live Query, durable execution or authority semantics. Prove one multiplexed SSE
downstream plus Fetch/POST upstream first. Requests and reconnects must work on
any compatible instance without sticky-session correctness. Reserve WebSocket
as a later carrier of the same frame contract, not a second semantic runtime or
an Elysia/Hono/provider adapter matrix.

### Answer

Accepted by ADR-0017. Ten compatible `all`-role Runtime instances may accept
arbitrary roots, upstream POSTs, reconnects, reconciliation scans, scheduler
ticks, and durable claims. PostgreSQL unique identities, frontiers, event rows,
and fenced transitions are the only retained authority. There is no application,
scheduler, queue, or realtime leader, process registry, or sticky-session
correctness.

Query cache is a compiler/Runtime projection binding Query/input/output/build,
authority partition, observed dependency generations, and finite expiry. Fresh
Context and current Policy precede disclosure. Memory and Redis/KV are narrow
optional byte stores, not raw `ctx.kv`; loss, staleness, corruption, timeout, or
unavailability is a miss or reset. `NOTIFY`, Redis pub/sub, or another broker
carries possible-progress hints only; reconciliation owns recovery.

V1 uses one bounded multiplexed SSE downstream plus Fetch/POST upstream. The
connection is local and disposable; POST and reconnect may hit different
compatible instances. Channel is a compiler Resource with exact codecs,
publish/subscribe Policy, resolved subject, PostgreSQL order/replay/generation,
authority invalidation, gap/reset, and limits. WebSocket or Pusher-compatible
delivery may later carry the identical frames but cannot become event, Policy,
or replay authority or create a provider matrix.

The initial review correctly blocked tautological rolling evidence, sequential
claims, and fabricated upstream/parity results. Repair `039a720d` adds old/new
build refusal/claim/retirement, ten overlapping PostgreSQL scheduler/worker
sessions, and a three-instance SSE/POST/resume path. Replacement fresh
Opus-medium verdict `PASS`; acceptance evidence `96829bd7`.

## #20: Which Files, storage, Search, and contract projections enter beta seams?

Blocked by: #10, #13, #17, #19
Type: Discuss

### Question

Assign ownership for File metadata, byte authorization, object-storage
capabilities, Search indexing/results, OpenAPI, MCP and skills. Decide whether
Files need a Definition or only generated operations/SDK over metadata plus a
storage capability. Preserve first-party ergonomics without a generic provider
SPI, and state exact beta absence stories. Keep OpenAPI/MCP/skills compiler-
owned projections and telemetry inside the accepted Execution Envelope.

### Answer

Accepted by ADR-0018. File is an ordinary Policy-protected metadata Collection,
not a new Definition or hidden mini-Collection. A closed structural projection
maps exact source Fields to byte roles and lowers ordinary reserve/finalize/
abort/delete Mutations, bounded Routes/SDK, and durable cleanup. Metadata Policy
precedes bytes. One narrow `put`/`open`/`head`/`delete` capability is earned by
filesystem and S3-compatible adapters and receives no application authority.

Search is a compiler Resource and committed derived projection. The engine
returns candidate keys; one bounded source plan applies current Tenant,
Collection Policy, deletion, facets, Field disclosure, totals, statistics,
cursor, and `first + 1` paging over one authorized universe before bounding the
page. Runtime post-filter/refill is forbidden. PostgreSQL is the first engine
seam, but the public Index remains B-tree-only; real full-text indexing and any
external engine require later focused contracts.

OpenAPI, MCP, and skills are compiler outputs from canonical App Contract
members and Origins. Unsupported members produce Origin diagnostics; MCP
invokes the generated Operation adapter; skills grant no Runtime authority;
telemetry stays in the Execution Envelope. Initial reviewed head `fb06a82c`
was validly `BLOCKED`. Repair `eaa21e0c` closed Mutation/byte-capability drift,
authorized cursor paging, and File recovery/cancellation/cleanup. Replacement
fresh Opus-medium verdict `PASS`; acceptance evidence `6e056bc4`.

## #21: What is the smallest coherent public vocabulary and export surface?

Blocked by: #2, #5, #13, #17, #18, #19, #20
Type: Prototype

### Question

Run the final naming, import and export consolidation across every accepted and
newly designed concept. First identify shared compiler/runtime kernels, then
compare their capability-scoped projections. In particular, determine whether
`input.uuid`, Field UUID, output UUID and any Operation-facing UUID spelling
share one scalar/codec contract; whether Query and Policy reads share one data
planner with different authority; whether Job, Reaction and Workflow share one
durable kernel; and whether Route/Fetch, cache/broker and storage surfaces hide
similarly duplicated concepts.

Compare named `defineContext`/`defineQuery` factories,
compiler-specialized `define.context`/`define.query`, and
`context.define`/`query.define`. Specify the stable `questpie` structural
surface, generated `#questpie/app` application-specialized surface, Package
exports, generated client exports, naming rules and forbidden cross-layer
imports. Prefer one deep kernel with several precise capability-scoped views
over either duplicated implementations or one universal builder that exposes
invalid combinations. Compile complete application examples, exact generated
declarations, autocomplete/hover, negative imports, Package isolation and
TypeScript budgets before superseding accepted spelling.

ADR-0015 adds one exact import/export edge to this matrix: Service `create` and
credential `resolve` are executable slots, while ADR-0009 currently permits
exactly six Current App Contract factory values. Decide whether their final
factory belongs to `#questpie/app`, uses a closed structural Definition plus a
separately sliced slot, or earns another bounded mechanism. Do not silently
expand ADR-0009 or make an executable callback part of controlled structural
evaluation.

### Answer

Accepted by ADR-0019. Named `defineKind` factories beat both `define.kind` and
`kind.define`; lower-case namespaces remain restricted grammars and
`createKind` remains runtime construction. One scalar kernel backs `codec`,
`field`, and compatible `value` projections; Operation owns no scalar grammar.
One relational planner separates row disclosure from boolean Policy evidence;
one durable kernel projects Job/Reaction/Workflow; one Fetch kernel projects
Route and `app.fetch` without `defineFetch`.

`questpie` owns the complete stable structural surface. `#questpie/app` and
isolated `#questpie/package` own seven per-kind executable factories including
Workflow; `#questpie/client` owns only generated client values/types. Channel
uses structural `defineChannel`, while Live Query is compiler-earned `.watch`.
OpenAPI/MCP/skills have config/build/explain projection names and no factory.
Optional infrastructure uses distinct `runtime.cache`, `runtime.wakeBroker`,
`runtime.channelCarrier`, and `runtime.byteStore` Service bindings without a
provider registry.

Initial clean reviewed head `1785809a` was validly `BLOCKED`. Repair
`0f44e985` closed the Package Workflow step and optional-capability spelling;
one replacement fresh stateless Opus-medium review returned `PASS`.
Acceptance evidence is `d50d4334b116a5bdc46e95cdabf566d8db938d37`.

## #22: What repository foundation keeps implementation fast and enforceable?

Blocked by: #21
Type: Prototype

### Question

Audit and simplify the repository before production implementation. Define one
deep quality interface through executable package scripts rather than copied
checklists. Cover workspace/package boundaries, Bun and TypeScript versions,
generated and proof file classification, Oxlint configuration and editor
parity, Oxfmt, fast tests, PostgreSQL integration tests, compiler goldens,
Knip entrypoints and dependency/export analysis, builds, API/declaration and
package-publication checks, supply-chain policy, CI concurrency/cache/artifacts,
release/changelog mechanics, contribution guidance, security reporting and
agent instructions.

Treat the compiler version as an explicit release gate, not an inherited pin.
The repository and every accepted proof currently measure TypeScript 5.9.2;
that remains honest historical evidence, not the assumed implementation
baseline. At #22 execution, test the latest stable TypeScript 6 bridge release,
remove or replace its deprecated configuration such as `baseUrl`, make ambient
`types` and `rootDir` behavior explicit, and rerun docs, declaration, generated-
contract, negative-import, Package-isolation, autocomplete/hover and
instantiation budgets before selecting the canonical supported compiler.

Also run the current stable native TypeScript 7 side by side over every pure
TypeScript and generated-contract lane. Do not make it canonical until the
docs/Fumadocs/MDX toolchain, declaration emit, editor behavior and any compiler-
API consumer pass; recheck the native compiler's programmatic API status when
#22 runs rather than freezing today's limitation. Keep one canonical supported
compiler and at most one non-blocking forward-conformance lane, not a public
5.9/6/7 support matrix. Record diagnostic parity, cold/warm timings, peak
memory, declaration bytes, instantiations where the compiler still reports
them, and every intentional baseline change.

Measure two loops. The local TDD loop must stay focused and fast: formatter or
lint on changed scope, one red test, and the smallest relevant typecheck. The
full CI/release loop may add cached Knip, all tests, PostgreSQL, build, package
and documentation audits. Establish a measured budget for each; do not make
every red-green step wait for repository-wide graph analysis.

Introduce Knip from explicit real entrypoints after ticket #21 freezes package
exports. Classify compiler-generated files, convention-discovered Definitions,
virtual modules, proof fixtures and test-only helpers rather than hiding broad
directories. Start Knip as a recorded report-only baseline, remove genuine dead
code and dependency mistakes, then promote stable zero-noise issue classes to
blocking. Use production/strict mode for shipped packages and cached scoped
workspace runs where they improve signal and latency.

Rewrite `CONTRIBUTING.md` as a thin guide to executable truth: supported setup,
first contribution, authority/load order, branch and PR scope, generated-file
rules, test placement, fast/full commands, documentation changes, commit and
release expectations, security path and troubleshooting. Keep commands in
`package.json`, configuration and CI as their single source of truth.

### Answer

Accepted by ADR-0020. One closed repository runner owns eight lanes rather than
one slow universal check or arbitrary plugins. The measured warm focused lane
is 0.50 seconds; the repaired docs-only full lane is 9.40 seconds. TypeScript
6.0.2 is canonical by exact package path. Native TypeScript 7.0.2 is the only
non-blocking forward lane because its stable programmatic API is not yet
available. `baseUrl` is removed and `rootDir`/ambient `types` are explicit.

Knip 6.32.1 is report-only for existing noisy files/dependencies/exports;
zero-noise `unlisted`, `binaries`, and `unresolved` are errors, and a disposable
negative fixture proves the first two fail. The full/release loops add package,
declaration/artifact, docs/build, skill, performance-manifest, PostgreSQL, and
release guards without entering the local red-green loop.

Correctness, micro, load, and soak/chaos are separate. The repository owns the
manifest/harness; implementation slices own budgets. GitHub timing is
non-strict except for clear repeated regression, while tagged stable runners
own strict release budgets. Ten-instance HA, fanout, workers, rolling deploy,
and optional-infrastructure loss are nightly/manual load work.

The portable repository skill routes five progressively disclosed branches.
Root AGENTS and the reduced HANDOFF carry only entry and current-state facts.
The proof branch owns a deterministic Bun wrapper for fresh stateless
Opus-medium acceptance. Initial reviewed head `bf45e203` was validly BLOCKED
for an inert Knip gate. Repair `fe8b5158` closed it; the one replacement fresh
review returned PASS. Evidence head `17008b05`. No production Runtime was
implemented.

## #25: Should Channels remain a framework-owned Resource?

Blocked by: none
Type: Product decision

### Question

Decide whether transient connected-client events justify a compiler Resource,
generated client/codecs, PostgreSQL event ledger/order/replay/authority state,
presence model, and runtime carrier binding beside Live Query and the shared
durable execution kernel.

### Answer

Accepted by ADR-0025: no. QUESTPIE removes the framework Channel concept
completely and introduces no Signal, Broadcast, Presence, or generic event-bus
replacement. Live Query owns current authorized Query state; ordinary
Collections and Queries own durable business history; Reaction or Job owns
durable post-commit acceptance and attempts. Transient typing, cursor,
presence, progress, and advisory notification delivery is ordinary
application/provider integration.

A provider cannot authorize a QUESTPIE Operation or become durable application
truth. A publish attempt that must survive commit crosses an Action or
external-effect Service from Reaction and remains physically at least once with
possible provider ambiguity. The collaboration fixture's `Channel` remains an
ordinary domain Collection.

The accepted P14/P15 artifacts, earlier ADR clauses, reviews, and v3 research
remain historical evidence at their pinned heads; their forward Channel seam
is superseded. Candidate head `ed0dfa7c59e6132a26cc1adaa500ec200ad911c8`
received a fresh stateless Opus-medium `PASS`; verified review evidence is
committed at `053690f6`.

## Research-wave discipline

Run bounded waves rather than one giant undifferentiated investigation:

1. whole-product journeys, generated context, Context Resolution and Policy;
2. semantic Operations and hooks-replacement lifecycle;
3. Live Query, Change Ledger and realtime client — accepted by ADR-0012;
4. Transactional Dispatch and Reaction — accepted by ADR-0013; Job and
   Workflow remain later verticals;
5. Auth/Files/Search/external integration plus Runtime/Fetch/client;
6. Execution Envelope, Studio, compiler realization and conformance — accepted
   by P6 and the post-P6 integration closure;
7. Service/Route/Auth, lifecycle/shared durable execution, and HA/optional
   acceleration — accepted by ADR-0015 through ADR-0017;
8. kernel minimization plus naming/import/export consolidation;
9. repository quality, contribution and CI foundation;
10. release slicing, accepted docs projection and implementation tickets.

Each wave uses several independent designs/research reports, compares them
against the acceptance lens, records one bounded decision, and leaves explicit
questions for the next wave. Claude is used only as Opus at medium or high.
The final acceptance review for a focused contract is a fresh Opus-medium run
after its proofs pass, never a continuation of exploratory review.
