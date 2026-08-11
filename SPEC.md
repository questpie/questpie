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

Public declarations do not expose Drizzle, Kysely, or another SQL engine type.
Broad `string`, `any`, ambient registry augmentation, and optional-capability
fallbacks fail the type contract.

V4 retains a TypeScript instantiation budget. The first Barbershop target must
use a fixed small fraction of the v3 baseline of 3,618,124 instantiations. The
exact fraction remains an implementation-gate decision.

## 7. Runtime and operations

The QUESTPIE Runtime owns Application, Execution, and Transaction lifetimes.

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

Direct Collection operations use the same Policy, transaction, error, and
observation machinery. They are not a private Admin API.

## 8. Data, authorization, and realtime

Fields, Collections, Globals, Relations, Constraints, Policies, Queries, and
Mutations form the first data contract. PostgreSQL-specific behavior is named
and available when it strengthens the contract.

Principal exists without credential Auth. Policy controls application
authorization. System Authority is explicit and cannot be obtained from normal
request input.

The Policy compiler pushes representable row filters into SQL. The relationship
between runtime Policy, PostgreSQL grants, and PostgreSQL RLS remains an open
grilling decision. QUESTPIE does not claim database-enforced authorization until
that decision has executable proof.

A Live Query records the supported reads that the handler actually executes.
The compiler instruments Collection, Policy, tenancy, Relation, and pagination
reads, and the Runtime replaces the dependency set after each recomputation.
Handler call sites alone are not sufficient. Raw SQL must declare an explicit
dependency token or the Query is not reactive.

Reactive Collections write to a durable PostgreSQL Change Ledger inside the
business transaction. A wake mechanism may be lossy because reconciliation reads
the ledger. Redis may later distribute wakes, but correctness remains in
PostgreSQL. Trigger-based capture for raw SQL, cascades, and external PostgreSQL
writers remains the leading mechanism for the tracer.

V4 does not yet promise an atomic transition across multiple independent Live
Queries. The realtime grill must choose a monotonic checkpoint contract or
state that each Query converges independently.

Automatic Mutation retries and duplicate network delivery remain open until the
operation grill defines safe Service use, call identity, deduplication, and the
response-lost-after-commit case.

Every execution surface needs explicit limits for duration, rows, bytes,
dependencies, active subscriptions, retained checkpoints, fanout, and
per-Principal concurrency. The tracer measures and exposes these limits before
the Runtime claims production readiness.

## 9. Durable execution

A Mutation commits business data and Transactional Dispatch intent atomically.
The Runtime then advances the durable intent through leases and attempts.

Jobs provide durable at-least-once execution, stable dispatch identity,
idempotency keys, retry, backoff, scheduling, cancellation, terminal failure,
and inspectable receipts.

Durable Workflow is built later on the same Job, lease, timer, signal, and
execution-history primitives. It does not create a second runtime. Workflow
handlers must define idempotent external effects or explicit compensation.

Queue, Job, and Workflow are a strong architectural fit. The first tracer proves
Mutation, dispatch, lease, idempotency, and observability before the complete
Workflow API is designed or implemented.

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
integration that resolves an external session or token into a Principal.

Better Auth can be a recommended first-party Package. Its native runtime and
plugins must remain usable. Better Auth schema and plugin ordering do not define
the core compiler ABI. The first tracer can use a small explicit bootstrap
integration while the full Auth package contract remains deferred.

Blob storage owns bytes. QUESTPIE File records own application metadata,
relations, Policies, and lifecycle. Complete upload and provider matrices remain
outside the first tracer.

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

The first implementation is one Barbershop slice.

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

Only the minimum Job/dispatch inspection needed to prove the transaction spine
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

## 17. Next grilling sequence

Grill and record these contracts in order:

1. schema, migrations, Seeds, drift, and idempotency — accepted for tracer;
2. Definition discovery, Resource naming, Owner, Origin, and Augmentation —
   accepted for tracer;
3. Field, Collection, Relation, Constraint, and Query grammar;
4. Principal, Authority, Policy, PostgreSQL grants, and RLS;
5. Query, Mutation, Action, Route, and declared errors;
6. observed Live Query dependencies and Change Ledger capture;
7. Transactional Dispatch, Job leases, retry, and idempotency;
8. Execution Envelope and minimal Studio;
9. Auth integration;
10. complete Workflow, Files, Search, OpenAPI, MCP, and Cloud slices.

Do not introduce syntax for a later item while grilling an earlier item. Record
an unresolved seam and continue with the current contract.
