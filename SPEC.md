# QUESTPIE v4 Product and Architecture Specification

- Status: Canonical direction for continued grilling
- Date: 2026-08-10
- Audience: maintainers, contributors, and implementation agents
- Authority: this file defines the current product boundary and implementation order

## 1. Product statement

QUESTPIE combines an open Static Application Compiler with a PostgreSQL-native
QUESTPIE Runtime that runs as a standalone process by default.

It compiles owned application Definitions into:

- one Compiled Manifest;
- PostgreSQL schema and reviewed migrations;
- semantic Query, Mutation, Action, and Route execution;
- compiled authorization and explicit authority boundaries;
- Mutation-owned durable dispatch;
- observed-result Live Queries;
- one concrete generated App Contract and client;
- one operational model for CLI, Studio, telemetry, and a future managed Cloud.

PostgreSQL remains visible and portable. QUESTPIE does not publish a generic
database engine interface in v4.0.

## 2. Product boundary

QUESTPIE owns application semantics above PostgreSQL. It does not try to be a
general web framework, a database hosting platform, or a CMS product.

The default deployment runs QUESTPIE as its own long-lived application runtime.
The runtime exposes one low-level Fetch boundary for tests, special embedding,
and incremental adoption. QUESTPIE does not maintain a host-adapter matrix or
promise lifecycle parity with Next.js, Hono, Elysia, Adonis, or other hosts.

Frontend applications remain framework-neutral. They use the concrete generated
client or a small integration such as the TanStack Query package.

The optional Studio is an application inspector and operational control surface.
It is not an Operator App framework. Product-specific Operator Apps live in
userland and use the same generated client as every other client.

## 3. Why this is QUESTPIE v4

V3 supplied positive evidence that these guarantees belong together:

- PostgreSQL data and transaction semantics;
- generated application and client contracts;
- policy-aware CRUD;
- durable change capture and lossy wake separation;
- transaction identifiers, replay, reconciliation, and reconnect recovery;
- transactional Queue dispatch, leases, retry, and idempotency;
- real Barbershop and City Portal application models.

V3 also supplied negative evidence:

- runtime Module merge hid ownership and made import order significant;
- codegen plugins became a second framework for discovery and builder grammar;
- Admin extended backend builders and required private projection systems;
- public Drizzle generics leaked ORM identity and cost millions of TypeScript
  instantiations;
- provider and host adapter breadth multiplied correctness matrices.

V4 ports guarantees, behavior tests, failure cases, and performance gates. It
does not port v3 architecture or preserve v3 source compatibility by default.

The repository has no external production users. This removes source migration
risk. It does not remove product validation risk. The rewrite must therefore
start with one deletion-driven Barbershop tracer.

## 4. Sources of truth

QUESTPIE uses three explicit schema facts.

| Fact                      | Meaning                   | Authority                          |
| ------------------------- | ------------------------- | ---------------------------------- |
| Compiled Manifest         | Desired application state | Current Definitions and compiler   |
| Committed migration chain | Reviewed change history   | Version-controlled migration files |
| Schema Fingerprint        | Actual PostgreSQL state   | Connected database                 |

The CLI compares these facts. It never treats them as interchangeable.

The normal lifecycle is:

1. The compiler discovers and evaluates supported Definitions.
2. The compiler emits one deterministic Compiled Manifest and Origin Map.
3. The migration planner compares the Schema Projection with the Committed
   Migration chain and the target Schema Fingerprint.
4. The planner reports additions, removals, ownership, destructive changes, and
   required PostgreSQL features.
5. A developer or agent reviews and creates the Committed Migration.
6. The migration runner verifies history and checksum before apply.
7. The runner applies the migration and records the result.
8. Drift verification compares the new Schema Fingerprint with the target
   Schema Projection.
9. Code generation emits the App Contract from the same Compiled Manifest.

A normal QUESTPIE workflow does not mutate a database through an unrecorded
`db push`. A fast local command may plan and apply in one interaction, but it
must still show and preserve the same migration plan. There is one schema change
path.

Seeds are versioned declarative initialization artifacts. Each Seed declares a
stable identity, dependencies, typed data steps, and an idempotency contract.
Studio and CLI show every run, result, retry, and failure.

The first tracer uses the exact transactional v1 artifact contract in
`docs/v4/schema-lifecycle.md`. Application objects live in one explicit
application schema. The Compiled Manifest contains a versioned Schema
Projection so later non-schema Resources do not create migrations. Schema
Projection, Migration Plan, base and target snapshots, and Schema Fingerprint
use canonical versioned bytes and domain-separated digests. Renames require an explicit
planner mapping. Destructive migration creation requires the exact Plan Digest.
Migration and Seed receipts make a lost response after commit safe to retry.

V1 migrations are linear and transactional. Concurrent or other
non-transactional DDL, handwritten migration SQL, down migrations, mutable
repeatable Seeds, and existing-schema adoption remain outside the first tracer.

## 5. Static composition

Definitions carry explicit Resource Identity. File path and export name record
Origin. They do not create identity.

Each Resource has one Owner. A second establishing Definition with the same
Resource Identity is always a compiler error. An additional contribution is
valid only when the establishing Definition explicitly accepts that exact typed,
Resource-kind-specific Augmentation value; an Augmentation is not a second
Definition.

The compiler resolves all contributions before runtime. Runtime startup does not
merge Modules, inspect arbitrary plugin objects, or apply last-wins behavior.

Features are source folders with no framework semantics. Packages distribute
Definitions and Resource-kind Augmentations. Installation alone does not
activate a Package. `questpie.json` records direct Package activation and its
accepted public composition inventory. A Package composition value enters only
through an accepted active export. Local exported Definitions are discovered
under the configured source root. An Owner accepts an Augmentation by
referencing the exact typed value in its establishing Definition. A fixed
Package Definition is sealed; customization requires vendoring the Package
composition locally and deactivating the Package root.

Framework internals and external Packages normalize into the same downstream
primitives. First-party code may use private compiler helpers before
normalization. After normalization it receives no private identity, merge,
migration, policy, or runtime authority.

`Capability` is an inventory and documentation label. It is not a required
public composition object, root Definition, registry, or dependency protocol.
Concrete Definitions and explicit typed references carry application structure.

## 6. TypeScript contract

Leaf Definitions infer their local input and output. They carry small invariant
Definition Contracts. They do not recursively compute the whole application.

Authored Definition types remain leaf-local after Package composition. Typed
references carry identity, not the complete resolved target shape. The generated
App Contract is the only exact type source for resolved Resources, rows,
Operations, and client members.

The compiler emits concrete application files with:

- exact Resource maps;
- exact context Services and Operations;
- exact Query, Mutation, Action, and Route input and output;
- exact client exposure;
- exact declared errors;
- exact Origin and ownership metadata needed by tools.

Executable Definition handlers import the seven application-specialized
`defineQuery`, `defineMutation`, `defineAction`, `defineRoute`,
`defineReaction`, `defineJob`, and `defineWorkflow` factories from the Current
App Contract at `#questpie/app`. The Controlled Structural Evaluator substitutes
only these pure factory values. It never loads emitted Runtime output or another
generated value during structural compilation.

One scalar/codec kernel backs `codec.*`, stored `field.*`, and compatible
embedded `value.*` projections. Operation composes input/output codecs and owns
no second scalar grammar. Named `defineKind` constructors remain the public
factory family; `#questpie/package` specializes the same seven executable kinds
to a sealed Package Contract, while `#questpie/client` exposes no server
factory.

The compiler owns handler slicing, local output materialization, and static
Executable Slot binding. A recursive Operation output component needs an
explicit output pin. A closed Collection Operation Set expands before Manifest
emission into ordinary Query and Mutation Resources. The Runtime Build pairs
all executable bytes to the exact current artifacts and refuses any missing,
duplicate, stale, wrong-kind, or cross-build binding.

Public declarations do not expose Drizzle, Kysely, or another SQL engine type.
Broad `string`, `any`, ambient registry augmentation, and optional-capability
fallbacks fail the type contract.

V4 retains a TypeScript instantiation budget. The first Barbershop target must
use a fixed small fraction of the v3 baseline of 3,618,124 instantiations. The
exact fraction remains an implementation-gate decision.

## 7. Runtime and operations

The QUESTPIE Runtime owns Application, Execution, and Transaction lifetimes.

One compiler-owned Service graph owns application- and execution-lifetime
dependencies. Application lifetime is per Runtime instance, never a cluster
singleton. Execution lifetime is per root and extends through Route response
stream EOF, error, or cancellation. Service dependency direction and effect
classification prevent application-to-execution and transaction-safe-to-
external edges; Query and Mutation cannot receive external-effect Services.

Every Execution has immutable Principal, Tenant, Authority, cancellation,
deadline, locale, and trace context. A handler receives the concrete `ctx`
generated for its application. It does not enumerate the Services that it may
use at each call site.

The semantic Operations are:

- Query: read-only application computation that can produce a Live Query;
- Mutation: one PostgreSQL transaction and its atomic durable-dispatch boundary;
- Action: external effects outside any automatic transaction-retry guarantee;
- Route: an explicit HTTP escape hatch for webhooks, streaming, files, or custom
  protocol control.

Routes are mounted into the single generated `app.fetch` and have a generated
direct projection requiring an explicit ingress Principal. Raw Route context
has exact Fetch values, cancellation/deadline, and Route-safe Services, but no
data facade, Mutation facade, raw database, or System elevation. It enters the
normal Context/Policy/Operation engine through an explicit Execution
transition. Routes are not generated JSON client Operations.

Direct Collection operations use the same Policy, transaction, error, and
observation machinery. They are not a private Admin API.

## 8. Data, authorization, and realtime

Fields, Collections, Globals, Relations, Constraints, Policies, Queries, and
Mutations form the first data contract. PostgreSQL-specific behavior is named
and available when it strengthens the contract.

Principal exists without credential Auth. Policy controls application
authorization. System Authority is explicit and cannot be obtained from normal
request input.

The Policy compiler pushes representable row filters into SQL. Policy remains
the only product authorization model. PostgreSQL grants and managed writer
roles enforce operational boundaries beneath it. PostgreSQL RLS remains
deferred, and QUESTPIE makes no database-enforced authorization claim.

A Live Query records the supported reads that the handler actually executes.
The compiler instruments Collection, Policy, tenancy, Relation, and pagination
reads, and the Runtime replaces the dependency set after each recomputation.
Handler call sites alone are not sufficient. Raw SQL must declare an explicit
dependency token or the Query is not reactive.

Reactive Collections write to a durable PostgreSQL Change Ledger inside the
business transaction. A wake mechanism may be lossy because reconciliation
reads the ledger. Redis may later distribute wakes, but correctness remains in
PostgreSQL. Compiler-owned triggers capture the supported raw DML, cascade,
bulk, conflict, merge, truncate, and managed external-writer boundary.

Each consumer advances an exclusive PostgreSQL `xid8` visibility horizon. A
fact identity, sequence maximum, timestamp, or trigger transaction identifier
is not the commit frontier. V4 does not promise an atomic transition across
multiple independent Live Queries; each Query converges independently.

Mutation call identity and duplicate delivery are accepted. A call binds the
application, Tenant, Operation, Principal, call ID, and canonical input digest
to one transaction-owned result receipt. Exact retries recover the committed
result without a second business write; changed-input reuse fails. Automatic
retry of arbitrary handler code remains deferred.

Every execution surface needs explicit limits for duration, rows, bytes,
dependencies, active subscriptions, retained checkpoints, fanout, and
per-Principal concurrency. The tracer measures and exposes these limits before
the Runtime claims production readiness.

Multi-instance operation is the default correctness model. Ten compatible
Runtime instances may accept arbitrary requests, reconnects, scheduler ticks,
and durable claims without a leader, process registry, or sticky-session
requirement. PostgreSQL owns every retained frontier, receipt, tick, event,
run, attempt, lease, timer, signal, and history fact.

Query caching is compiler-controlled and validates fresh Context, Policy,
authority partition, and durable dependency generations before disclosure.
Memory and Redis/KV are optional byte stores, not raw application APIs.
Notification brokers carry possible-progress hints only. Losing cache or wake
state causes a miss, scan, reconnect, or reset and cannot change results or
authority.

The first realtime carrier is one multiplexed SSE downstream plus Fetch/POST
upstream. A reconnect or upstream request may reach another compatible
instance. Channel is a typed compiler Resource whose codecs, publish/subscribe
Policy, resolved identity, PostgreSQL event order/replay, authority
invalidation, and limits are independent of the carrier. WebSocket and
Pusher-compatible delivery remain later measured carriers of the same frames,
not provider-specific semantic runtimes.

## 9. Durable execution

A Mutation commits business data and Transactional Dispatch intent atomically.
The Runtime then advances the durable intent through leases and attempts.

The first accepted durable vertical is Reaction. One typed Reaction intent,
the business write, Change Ledger fact, audit, and Mutation result receipt share
the Mutation transaction. Every physical attempt uses a short fenced claim, a
fresh caller Execution, current Policy, bounded retry and timeout, cooperative
cancellation, and one stable logical external-effect identity. Physical
execution is at least once. An unknowable provider outcome is explicit
ambiguity, never an exactly-once claim.

Jobs are explicitly dispatched durable work. Direct, Mutation-owned, delayed,
and scheduled acceptance use scoped idempotency and the same Durable Run,
attempt, lease, fencing, retry, cancellation, result, retention, executable-
compatibility, and event kernel as Reaction. Removing a schedule prevents
future ticks and never cancels an accepted run.

Reaction is the committed-fact projection of that kernel. Its causation and
deduplication derive from the exact transaction fact and static dispatch slot;
it has no independent producer or author-supplied second key.

Durable Workflow is a checkpoint/history projection over the same kernel. Its
closed commands call a generated Mutation or Action, sleep on a durable timer,
or wait for a typed durable signal. It does not expose a generic callback step
or create a second runtime. Live histories pin semantic version and executable
bytes instead of replaying arbitrary latest TypeScript.

Queue names the operational scheduling, admission, lease, and backpressure
surface, not a Definition or composition container. Full Workflow breadth
still requires signal authorization, child work, compensation, bounded
continuation/history, and multi-version evidence before public release.

## 10. Execution Envelope and Studio

The Runtime emits an append-only event family. Every event carries the same
versioned Execution Envelope correlation schema. It correlates:

- operation identity and run identity;
- Principal, Tenant, and Authority class without leaking secrets;
- transaction identity;
- idempotency and causation identity;
- change-ledger and dispatch identity;
- Job or Workflow attempt identity;
- timing, declared errors, logs, spans, and audit events.

CLI, Studio, OpenTelemetry exporters, tests, and a future Cloud consume this
contract. They do not reconstruct separate truths from text logs or private
tables.

Studio shows:

- Compiled Manifest, Origins, Owners, and authorized Augmentations;
- migration plan, migration checksum history, database drift, and Seeds;
- operation calls, Policy decisions, transactions, and declared errors;
- Change Ledger and Transactional Dispatch state;
- Queue, Job, and Workflow attempts, leases, retries, cancellation, and dead
  letters;
- Live Query dependencies, cursor, lag, wake reason, recomputation, and
  reconnect state;
- correlated logs, traces, metrics, and audit history;
- safe data inspection and edits through normal generated operations.

Studio is not a general SQL console, database hosting dashboard, CMS page
builder, or Operator App platform.

## 11. Auth, files, and external systems

Core owns Principal, Tenant, Authority, and Policy. Credential Auth is an
integration that resolves an external session or token into a Principal. An
application installs at most one credential resolver bound to one explicit
application/external Service. Absence produces anonymous; provider failure is
typed and cannot silently downgrade to anonymous. Policy remains the only
authorization model.

Better Auth can be a later reference Package. Its native runtime, plugins,
application-owned Collections, migration participation, and native client
remain usable. It normalizes to ordinary Service, credential-resolver, and
Route Definitions and cannot define a privileged compiler ABI, mandatory
schema, separate migration path, or generated-client authority.

Blob storage owns bytes. QUESTPIE File records own application metadata,
relations, Policies, and lifecycle. A closed structural File projection lowers
exact metadata Field roles to ordinary reserve/finalize/abort/delete Operations,
bounded Routes/SDK, and durable cleanup. Metadata Policy always runs before a
narrow filesystem or S3-compatible byte capability; storage receives no
application authority. PostgreSQL/object-store non-atomicity is explicit in the
pending, ready, aborted/failed, and deleted lifecycle.

Search is a compiler Resource and committed derived projection, not an
authorization system. An index returns candidate keys; one bounded source plan
applies current Tenant, Collection Policy, deletion, Field output authority,
facets, totals, statistics, cursor, and `first + 1` page over the same authorized
universe. PostgreSQL is the first engine seam. The public Index contract remains
B-tree-only; full-text physical indexes and external engines require separate
focused decisions rather than a provider matrix.

OpenAPI, MCP, and skills are compiler-owned projections of canonical App
Contract members and Origins. Unsupported contracts produce diagnostics. Their
invocations reuse the accepted Execution, Policy, Operation, limits, errors,
and Execution Envelope and cannot own business handlers or authority.

## 12. Hosting and Cloud

The open product includes the compiler, standalone Runtime, migrations, Change
Ledger, worker, realtime protocol, generated client, CLI, conformance tests, and
a minimal Studio.

A managed control plane can later add projects, organizations, deployment
artifacts, migration gates, preview environments, secrets, backups, PITR,
autoscaling, regional realtime delivery, fleet observability, team RBAC, audit,
and billing.

The Cloud moat is semantic deployment based on the Compiled Manifest. It is not
generic Bun and PostgreSQL hosting. No control-plane implementation starts until
the open Runtime works in external production applications.

QUESTPIE can run against PostgreSQL hosted by Supabase, Neon, RDS, or another
compatible provider. Provider-specific limits require conformance tests, not a
public generic data-provider SPI.

## 13. First implementation tracer

The first implementation is one Barbershop slice. The accepted proof fixture
uses the equivalent Company, Space, Channel, Membership, and Message path plus
an Archive, Record, and Research Permit portability domain; implementation
maps those proven jobs to Barbershop names without changing their contracts.

It is complete only when:

1. `appointments` has explicit identity, Owner, and Origin.
2. A second Package applies one authorized Augmentation.
3. A typed Policy uses Principal, Tenant, and a membership Relation.
4. A Query returns a selected, sorted, paginated appointment view.
5. The generated client infers exact input, output, and errors.
6. A client watches the Query.
7. A Mutation changes an appointment and writes durable Reaction intent in the
   same transaction.
8. The Change Ledger captures the commit before any wake.
9. The dependency plan includes data, Policy, Relation, tenant, and pagination
   reads.
10. The client receives one correct recomputed result after commit.
11. A process crash after commit and before wake loses neither refresh nor
    Reaction.
12. Direct execution, network client, and minimal Studio return the same
    authorized result.
13. Migration create, apply, checksum, and drift checks are deterministic.
14. Public declarations contain no ORM types.
15. Type-performance and runtime-performance budgets pass.
16. The same Definitions run on local PostgreSQL and one managed Supabase
    PostgreSQL project.
17. Raw SQL, a cascade, and an external PostgreSQL writer cannot bypass the
    tested change-capture and reconciliation path.
18. Duplicate Mutation delivery and a lost response after commit do not apply
    the business change twice.
19. A retryable transaction cannot call a Service with unsafe external effects.
20. Query, dependency, subscription, and fanout budgets fail with explicit
    diagnostics.

Exact TypeScript output does not by itself validate runtime values or make an
OpenAPI schema. The operation API grill must decide when the compiler can
materialize a runtime schema and when the author must supply an explicit output
contract.

Only the minimum Reaction/dispatch inspection needed to prove the transaction spine
belongs in this tracer. Complete Workflow, Auth, Files, Search, KV, OpenAPI, MCP,
Channels, and managed Cloud remain later slices.

## 14. V3 port policy

Preserve these v3 assets as evidence:

- transaction and nested-transaction tests;
- realtime Change Ledger, replay, authorization fence, and recovery tests;
- Queue dispatch, lease, retry, terminal state, and idempotency tests;
- Policy fail-closed and field-output filtering tests;
- relation, localization, constraint, concurrency, bulk, and migration tests;
- Barbershop and City Portal domain fixtures;
- generated-layer cycle checks and built-consumer tests;
- TypeScript, package, bundle, `any`, dead-module, clone, export, and audit
  budgets.

Do not port these mechanisms:

- runtime Module flattening or generic merge;
- last-wins composition or implicit application override authority;
- arbitrary codegen categories and builder extensions;
- global type registries and fallback discriminants;
- recursive application-wide builder inference;
- public ORM types;
- Admin-specific backend builder methods;
- the CMS Admin extension framework;
- the host-adapter matrix;
- Better Auth plugins as a required compiler protocol;
- provider abstractions without a second required engine.

## 15. Non-goals for the first tracer

- Source compatibility with v3.
- A general database framework.
- A general web framework.
- A Supabase replacement.
- A Convex-compatible runtime.
- A full CMS Admin.
- An Operator App builder.
- A public compiler plugin API.
- A full Workflow product before the dispatch spine passes.
- A managed control plane.

## 16. Current decision state

The canonical ADR index is `docs/adr/README.md`.

Research notes are evidence, not decisions:

- `docs/v4/research/data-engine-and-framework-boundary.md`;
- `docs/v4/research/convex-comparison.md`;
- `docs/v4/research/supabase-v3-v4-comparison.md`;
- `docs/v4/research/configuration-and-extension-models.md`;
- `docs/v4/research/compiler-primitives-adversarial-review.md`.

The executable Definition compiler contract is accepted in ADR-0009 and
`docs/v4/executable-definition-compiler.md`. It accepts compiler mechanics, not
Context, Policy, Operation, realtime, durable-work, or production Runtime
semantics.

Trusted Context Resolution and relational Collection Policy are accepted in
ADR-0010 and `docs/v4/context-and-policy.md`. They accept immutable root facts,
bounded bootstrap, relational evidence, fail-closed Policy phases, SQL
pushdown, nondisclosure, and execution-surface parity. They emit no RLS claim
and do not accept Query, Mutation, transaction, lifecycle, or production
Runtime semantics.

Semantic Query, transactional Mutation, Collection Operation Sets, exact
Operation codecs/errors, stable call identity, and explicit lifecycle ownership
are accepted in ADR-0011 and `docs/v4/query-mutation-and-lifecycle.md`. They
accept one read snapshot, one Mutation-owned transaction, duplicate/lost-result
recovery, closed normalization and values, and typed pending dispatch intent.
They do not by themselves accept Live Query/Change Ledger, durable Reaction
delivery, or a production Runtime.

Observed Live Query dependencies, complete-result watch delivery, fresh
reauthorization, transactional Change Ledger capture, commit-safe
reconciliation, opaque resume/reset, and bounded client behavior are accepted
in ADR-0012 and `docs/v4/live-query-and-change-ledger.md`. They do not accept
durable Reaction delivery, atomic multi-Query publication, persistent offline
resume, or a production Runtime.

Transactional Dispatch, caller-run-as Reaction, attempt/lease fencing, bounded
retry and timeout, cancellation, external-effect ambiguity, retention, and
executable compatibility are accepted in ADR-0013 and
`docs/v4/transactional-dispatch-and-reaction.md`. They do not accept Job,
Workflow, a Queue composition surface, provider-specific Action semantics, or a
production Runtime/Fetch/Studio protocol.

ADR-0016 and `docs/v4/lifecycle-jobs-and-shared-durable-kernel.md` accept the
complete v3 lifecycle-job mapping, explicit Job acceptance, committed-fact
Reaction distinction, and one Job/Reaction/Workflow durable kernel with a
closed checkpoint seam. Final factory spelling is accepted by ADR-0019;
complete Workflow product breadth remains a later vertical.

ADR-0017 and `docs/v4/multi-instance-and-optional-acceleration.md` accept
ten-instance HA, arbitrary routing, concurrent schedulers/workers, rolling
executable compatibility, discardable Query-cache and wake acceleration, one
multiplexed SSE/Fetch-POST transport, and compiler/Policy/PostgreSQL-owned
Channels. PostgreSQL remains the only hard durable dependency.

ADR-0018 and `docs/v4/files-search-and-contract-projections.md` accept ordinary
File metadata plus a narrow filesystem/S3-compatible byte capability, explicit
non-atomic File lifecycle, committed Search projection with one authorized
result universe, and compiler-owned OpenAPI/MCP/skill outputs. Final public
spelling is accepted by ADR-0019; public full-text Index syntax and external
Search/storage provider breadth remain later decisions. ADR-0019 and
`docs/v4/semantic-kernels-and-public-surface.md` freeze their public spelling,
the shared scalar/relational/durable/Fetch kernels, `defineChannel` versus Query
`.watch`, exact structural/app/package/client exports, and distinct
`runtime.cache`, `runtime.wakeBroker`, `runtime.channelCarrier`, and
`runtime.byteStore` bindings without a provider registry.

The immutable Runtime bundle, generated App and client, Operation Wire,
combined-role Runtime lifecycle, deployment compatibility, Execution Envelope,
and minimal Policy-protected Studio are accepted in ADR-0014 and
`docs/v4/runtime-client-envelope-and-studio.md`. They do not accept split
Runtime roles, host/provider SPIs, remote Studio, complete migration execution,
or later product breadth. ADR-0015 additionally accepts Service lifetime,
Route/Fetch mounting, generated direct Route invocation, and Auth composition.
Its factory spelling is finalized by ADR-0019.

## 17. Next grilling sequence

Grill and record these contracts in order:

1. schema, migrations, Seeds, drift, and idempotency — accepted for tracer;
2. Definition discovery, Resource naming, Owner, Origin, and Augmentation —
   accepted for tracer;
3. Field, Collection, Relation, Constraint, and structural Query grammar —
   accepted for the foundational v1 contract;
4. Principal, Authority, trusted Context Resolution, relational Policy, and
   Policy-enforced framework SQL — accepted; PostgreSQL RLS remains deferred;
5. Query, Mutation, Collection Operations, explicit lifecycle, and declared
   errors — accepted; Action remains later, while raw Route composition is
   accepted by item 9;
6. observed Live Query dependencies and Change Ledger capture — accepted;
7. Transactional Dispatch, Reaction leases, retry, and idempotency — accepted;
8. Runtime/Fetch, Execution Envelope, generated client, and minimal Studio —
   accepted; split roles, host/provider SPIs, and remote Studio remain later;
9. Service, Route/Fetch, and Auth composition — accepted by ADR-0015;
10. lifecycle jobs and one Job/Reaction/Workflow durable kernel — accepted by
    ADR-0016; complete Workflow breadth remains later;
11. Files, Search, OpenAPI, MCP, and skills ownership — accepted by ADR-0018;
    public breadth remains a later slice;
12. semantic kernels, naming, imports, exports, and optional Runtime binding
    names — accepted by ADR-0019;
13. repository foundation and measured quality loops — accepted by ADR-0020;
14. conformance collapse, beta slicing, and agent-ready issue queue — active
    atlas #14–#16 frontier;
15. Cloud slices.

Do not introduce syntax for a later item while grilling an earlier item. Record
an unresolved seam and continue with the current contract.

Before the first large implementation wave, run one bounded seam-preservation
pass over items 9 and 10 plus Service, Route, lifecycle, durable execution and
multi-instance operation. It must preserve these product jobs without assuming
their final spelling:

- Auth is application composition, not a second authorization model. A user
  may bring Better Auth or another package, own the needed Collections and
  client, mount its standard Fetch handler, and resolve its identity into
  trusted Context and Principal. QUESTPIE must first provide the clean typed
  Package, Service, Route/Fetch and Context seams; a Better Auth Package is an
  optional reference integration, not beta-owned schema authority.
- `beforeValidate`, `beforeChange`, `afterChange`, and `afterRead` jobs must be
  mapped deliberately. Pure validation/normalization, transaction-owned work,
  result projection and post-commit durable work are distinct phases; Reaction
  is not a replacement name for every lifecycle extension.
- Job, Reaction and Workflow should share the smallest viable durable
  execution kernel. Their differences are trigger/dispatch authority and
  available capability: a Reaction is derived from a committed fact; a
  Workflow adds checkpointed `step` semantics. Do not build three queues merely
  because three authoring jobs exist.
- HA is a default correctness target. Ten compatible application instances
  must not change Context, Policy, Live Query or durable semantics. Correctness
  cannot depend on process-local registries, singleton ownership or a unique
  application leader.
- PostgreSQL remains the only hard infrastructure dependency and durable source
  of truth. Memory, Redis/KV, notification brokers, typed Channels and object
  storage may be optional capabilities for cache, invalidation distribution,
  collaboration or Files, but loss or absence of an accelerator must fall back
  safely and cannot change authority.
- Preserve one transport-neutral realtime frame contract, but begin with one
  physical transport: a multiplexed SSE downstream and Fetch/POST upstream.
  An upstream request or reconnect may reach any compatible Runtime instance;
  correctness cannot require sticky sessions. Redis may later accelerate
  cross-instance wakes. WebSocket may later carry the same frames, first in the
  standalone Runtime, only after a measured workload and a second concrete
  conformance implementation justify the seam. Beta does not own a Pusher or
  realtime-provider matrix.
- OpenAPI, MCP and skills are compiler-owned projections of accepted contracts,
  not parallel authoring systems. Telemetry remains part of the accepted
  Execution Envelope/event model.

The pass may defer breadth or reject a feature only with a named invariant or
failure case. Deferral must preserve the ideal ownership seam so beta.1 does
not need a replacement public architecture later.

After the naming/export contract settles and before production tickets become
assignable, establish the repository quality foundation as its own measured
gate. Keep one fast scoped TDD loop for ordinary red-green work and one cached
full CI/release loop. Oxlint, formatting, focused tests and relevant typechecks
belong in the fast path; repository-wide Knip, PostgreSQL integration, complete
goldens/builds and package/release audits belong in the full path unless
measurement proves them cheap enough. Generated output, convention entrypoints,
virtual modules and proof fixtures require explicit classification rather than
broad ignores. Contribution documentation points to executable scripts and CI
as truth.
