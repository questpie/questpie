# QUESTPIE v4 Canonical Language

This file defines framework-specific terms. `SPEC.md` defines product behavior
and implementation order. `docs/adr/README.md` indexes current decisions.

## Product terms

### Codec

The transport-neutral runtime value grammar used by Operation input/output,
Context input, and durable payloads. Fields and embedded values are restricted
projections over the same scalar kernel.

Do not use: Operation schema, input-only schema, output-only schema.

### QUESTPIE Runtime

The process that runs one compiled PostgreSQL application. It runs as a
standalone process by default. It owns operation dispatch, workers, realtime
sessions, health, startup, and shutdown.

Do not describe the default product as: CMS server, host adapter, embedded
library. A low-level Fetch embedding seam remains supported.

### Studio

The optional inspector and operational control surface for one compiled
QUESTPIE application. It reads the App Contract and Operational Facts.
Application data it reads only as any client does, through generated Operations
under Policy.

Do not use: CMS Admin, Operator App framework, SQL console.

### Operator App

An application-specific business interface owned by the application team. It
uses the generated client and lives in userland.

Do not use: custom Admin.

### Static Application Compiler

The build system that discovers supported Definitions, resolves identity and
ownership, validates composition, and emits the Compiled Manifest and concrete
App Contract before runtime.

Do not use: runtime plugin loader, Module merger.

## Composition terms

### Definition

A declarative description of one framework Resource or behavior. A Definition
carries explicit Resource Identity. Its export and file path record Origin.

Do not use: Module, runtime plugin, Slice.

### Definition Contract

The small, invariant, Resource-specific type contract attached to one Definition
value. It contains local facts and typed references. It does not compute the
complete application type.

### Resource

One named semantic item compiled into the application. Collections, Queries,
Mutations, Jobs, and Policies are Resources.

### Resource Identity

The stable pair of Resource Kind and Qualified Resource Name. File path, export
name, Feature, Package, and discovery order do not change it.

### Resource Kind

A closed v4 compiler protocol for one class of Resource. V4.0 does not publish a
public protocol for Packages to add new Resource Kinds.

### Qualified Resource Name

An explicit lower-camel name with optional dot-separated lower-camel segments.
Examples include `appointments` and `booking.availability`.

### Owner

The one Definition authorized to establish a Resource and accept its
Augmentations. Owner is a role, not a separate identity namespace. The Resource
Identity names the Owner in artifacts. Ownership does not grant runtime System
Authority.

### Origin

The Package, file, export, and source location from which a Definition or
contribution came. Origin explains provenance. It does not create identity or
precedence.

### Origin Map

The compiler artifact that maps resolved Resources and members to their Origins,
Owners, and accepted Augmentations.

### Augmentation Contract

The explicit acceptance of one typed, Resource-kind-specific Augmentation value
inside the establishing Definition. It permits only the additive contract that
the accepted value carries.

### Augmentation

One contribution accepted through an Augmentation Contract. Import order cannot
authorize or reorder it.

### Feature

A userland source folder for related behavior. It has no compiler, ownership,
configuration, or runtime semantics.

Do not use: Module, Slice, Feature Kit.

### Package

A distribution unit that exports Definitions, Resource-kind Augmentations, and
normal TypeScript values. Installation alone does not activate composition
exports. The application records direct activation and the accepted Package
inventory in `questpie.json`.

### Application Root

The one committed, non-executable `questpie.json` file that identifies the
application and records compiler configuration plus direct Package activation.

### Package Inventory

The accepted identity and structural-contract list from one active Package's
fixed `./questpie` composition export. Installing or importing a Package does
not accept its Package Inventory.

### Build Input

The complete versioned compiler input graph for one application compile. It
contains application configuration, TypeScript configuration, dependency
resolution, the framework, active Package content, and structural library
modules.

### Build Input Digest

The domain-separated digest of one exact canonical Build Input.

### Controlled Structural Evaluator

The compiler boundary that evaluates structural authoring modules without
environment, I/O, clock, random, process, or other nondeterministic build-time
effects. It proves deterministic compilation; it is not a security sandbox for
hostile Package code.

### Capability

A product-inventory or documentation label such as Data, Realtime, or Auth. It
is not a required public composition object, registry, or root Definition.

### Same-Primitives Law

After normalization, first-party, application, and Package contributions use
the same identity, ownership, collision, migration, policy, generation, and
runtime rules. Private pre-normalization helpers cannot grant downstream
authority.

## Compiler and schema terms

### Application Identity

The stable Qualified Resource Name that identifies one compiled application in
configuration, locks, bindings, and receipts.

### Compiled Manifest

The deterministic, serializable desired state of one application after all
Definitions and authorized Augmentations resolve.

### Schema Projection

The versioned part of the Compiled Manifest that contains desired PostgreSQL
state. Migration planning and schema history use its digest, so non-schema
Compiled Manifest changes do not create migrations.

### Schema Projection Digest

The domain-separated digest of one exact canonical Schema Projection.

### Field

A typed data member owned by a Collection. A Field has one semantic identity,
one canonical path, and one runtime value contract.

### Inline Shape

A logical nested group of ordinary Fields stored as separate PostgreSQL
columns. It has no value, identity, or database object of its own.

_Avoid_: nested object Field, embedded row

### Embedded Value

A bounded typed value stored inside one JSONB Field. Its members have codecs
but no independent Field identity, Relation, Policy boundary, or lifecycle.

_Avoid_: nested Collection, hidden table

### Open JSON

A tagged JSON value stored in one JSONB Field without a closed property schema
or typed interior paths.

### Field Path

The non-empty ordered key segments that locate one Field in a Collection's
logical shape. A dotted string is one key and is never parsed as a Field Path.

### Data Contract Projection

The versioned Compiled Manifest member that contains resolved Collection,
Field, key, codec, and Relation facts used by generated contracts and structural
Queries without duplicating physical schema authority.

### Structural Query

A closed read template with explicit selection, filter, total order, forward
page, and declared data dependencies. It is a structural value, not a Resource
or executable handler.

### Binary Text Order

The one foundational deterministic text comparison named `questpie.binary`.
Locale-sensitive text order is a separate capability.

### App Contract

The concrete generated TypeScript and runtime surface of one compiled
application. It includes exact Resources, context, operations, client exposure,
errors, and required metadata.

### Current App Contract

The exact application contract constructed from the current compiler draft.
QUESTPIE sync, check, and build use it before they publish generated files. The
last generated disk contract is editor input, not current-build authority.

### Executable Slot

The one compiler-owned binding location for an executable member of a
Definition. It joins one Resource to its statically bundled handler without a
source registry or file-pairing rule.

### Collection Operation Set

A closed compile-time shorthand whose literal members establish ordinary Query
and Mutation Resources. The set is not a Resource or runtime dispatcher.

### Runtime Build

The versioned executable artifact paired with one exact Build Input, executable
Manifest projection, App Contract, runtime graph, toolchain, and server bundle.
It contains static Executable Slot bindings and cannot be mixed with another
compiled application build.

### Runtime Bundle

The checksum-verified immutable directory published by `questpie build` for one
exact Runtime Build. It contains the matched executable, schema, migration,
wire, Origin, and generated-contract artifacts used at startup.

### Operation Wire

The generated versioned protocol that carries one exact Operation call and its
closed result, declared-error, framework-failure, or rejection frame between a
client and the QUESTPIE Runtime.

### Migration Plan

The ordered database change proposal derived from the Compiled Manifest,
committed migration history, and target Schema Fingerprint.

### Plan Digest

The domain-separated digest of one exact canonical Migration Plan. It is the
approval identity for creating that Committed Migration.

### Committed Migration

A reviewed and version-controlled database change artifact with stable identity
and checksum.

### Migration Receipt

The immutable database record that one exact Committed Migration checksum
applied successfully. It is the idempotency authority for migration apply.

### Physical Name

The deterministic or explicit PostgreSQL identifier that stores a Resource or
member. It is a projection of semantic identity and does not create identity.

### Schema Fingerprint

The normalized identity of the actual PostgreSQL schema and required features at
one point in time.

### Schema Fingerprint Digest

The domain-separated digest of one exact canonical Schema Fingerprint
comparable value.

### Drift

A reported difference in one named comparison: local Committed Migration chain
against Migration Receipts, current Schema Projection against the committed
Schema Projection, applied-head Schema Projection against the live Schema
Fingerprint, or required provider profile against PostgreSQL.

### Seed

A versioned declarative initialization artifact with stable identity,
dependencies, typed data steps, and an explicit idempotency contract.

### Steps Digest

The domain-separated digest of the exact canonical data steps in one Seed.

### Seed Receipt

The immutable database record that one exact Seed checksum committed with its
data writes. It is the idempotency authority for Seed execution.

## Runtime terms

### Operation

A statically bound semantic execution Resource with an exact input, output,
error, Policy, consistency, limit, and exposure contract.

Do not use: runtime CRUD handler, endpoint registry.

### Application Scope

The lifetime of one running QUESTPIE Runtime and its shared resources.

### Service

A statically composed dependency with compiler identity, explicit dependencies,
an Application or Execution lifetime, and a transaction-safe or external-effect
classification. Its runtime instance is never a Context fact or durable state.

### Credential Resolver

The optional single application ingress Definition that maps request
credentials through one explicit application Service to a Principal,
anonymous, or a typed failure. It does not decide Policy or Authority.

### Execution Scope

The lifetime of one request, Job attempt, Workflow step, script call, or test
execution. It carries immutable Principal, Tenant, Authority, cancellation, and
trace context.

### Context Definition

The one application Definition that decodes transport-neutral input and
resolves immutable Tenant and application values for a root Execution.

### Context Resolution

The once-per-root construction of resolved Context from decoded input,
Principal, and bounded read-only bootstrap reads. Nested work inherits the
result.

### Bootstrap Read

A bounded read-only exact-key Collection lookup available only during Context
Resolution. It has explicit selection and cannot expose general data, Service,
Queue, write, raw SQL, or System capabilities.

### Transaction Scope

The PostgreSQL transaction owned by one Mutation or explicit transactional
operation.

### Call Identity

The stable identity of one logical Operation call. For a Mutation it binds the
application, Tenant, Operation, Principal, call ID, and canonical input digest
to one committed result receipt.

### Principal

The authenticated or anonymous identity facts used by Policy. Principal exists
without a credential Auth integration.

### Tenant

The immutable application-selected isolation identity for one Execution.

### Authority

The immutable class of actions an Execution may request. System Authority is an
explicit trusted capability and cannot be derived from request input.

### Policy

A compiled Collection-bound authorization rule for admission, relational row
scope, supplied-input Fields, selected-output Fields, current rows, and
candidate rows. Policy applies to normal clients, direct operations, workers,
recomputation, and Studio.

### Policy Evidence Read

A bounded boolean-only relational read inside Policy. It can authorize from a
target Collection without disclosing the evidence row, and its mutable reads
remain Policy dependencies.

### Query

A read-only semantic Operation. A supported Query can be watched as a Live
Query.

### Mutation

A semantic Operation that owns one PostgreSQL transaction and its atomic
Transactional Dispatch boundary.

### Operation Result Receipt

The transaction-owned record of one committed Mutation call and its exact
result bytes. It lets an exact duplicate recover a committed result without
applying the business change again.

### Action

A semantic Operation for external effects outside the Mutation transaction and
automatic retry guarantee.

### Route

The bounded raw Fetch escape hatch for webhooks, streaming, file transfer, or
custom protocol control. It has no ambient data, transaction, or System
capability and enters application behavior through an explicit Execution.

### Change Ledger

The durable PostgreSQL record of reactive data changes written inside the
business transaction. Lossy wake mechanisms only announce possible progress.

### Reconciliation Frontier

The durable per-consumer progress boundary that prevents committed Change
Ledger facts from being skipped or pruned before that consumer can process
them.

### Live Query

A subscription to the recomputed authorized result of one Query. The Runtime
records the supported data, Policy, tenancy, Relation, and pagination reads that
the handler actually executes, then replaces the dependency set after each run.

### Resume Token

An opaque generated-client continuation value for one Live Query. Application
code does not interpret or authorize from it.

### Optional Accelerator

A discardable capability implementation that can avoid work or latency but
owns no application, authorization, realtime, or durable fact. Its loss causes
a miss, reconciliation, reconnect, or reset rather than a semantic change.

### File Projection

A closed structural mapping from exact Fields of one ordinary metadata
Collection to byte-lifecycle roles. It generates ordinary operations and uses
a narrow Byte Store; it is not a hidden Collection or independent authority.

### Byte Store

The capability that stores and retrieves opaque File bytes under bounded,
checksummed, cancellable operations. It receives no Principal, Context, Policy,
transaction, raw database, or System Authority.

### Search Projection

A compiler Resource that derives a versioned searchable document index from
committed source Collection rows. Candidate keys become results only through
the source Collection's current Policy and disclosure rules.

### Contract Projection

A compiler output such as OpenAPI, MCP, or a skill bundle derived from exact
App Contract members and Origins. It grants no handler or authorization
authority.

### Transactional Dispatch

Durable follow-up intent committed in the same transaction as business data and
advanced later by a worker.

### Reaction

A declared durable handler created only from one exact committed application
fact. Its stable causation and acceptance identity are compiler-derived; it has
no independent producer or author-supplied second deduplication key.

### Durable Run

One logical durable execution accepted by Transactional Dispatch. It remains
stable across retry and lease recovery.

### Physical Attempt

One invocation of a durable handler. A retry or reclaimed lease creates a new
Physical Attempt for the same Durable Run.

### Lease Token

The opaque fencing identity that permits one current Physical Attempt to
heartbeat or request a durable state transition.

### Effect Identity

The stable identity of one logical external effect for a Durable Run. It is
derived from the Resource, Durable Run, and a declared literal effect name.

### Queue

The Runtime scheduling and lease surface that advances durable work. Queue is
an operational product area, not a source-composition primitive.

### Job

A declared explicitly dispatched durable command. It uses the shared Durable
Run, attempt, lease, retry, cancellation, result, retention, and executable-
compatibility kernel and may be accepted directly, by a Mutation, after a
delay, or from a durable schedule.

### Durable Schedule

A persisted producer of independently deduplicated Job ticks. Removing a
schedule prevents future acceptance and never cancels an already accepted run.

### Workflow Checkpoint

One named ordered durable Workflow command and its canonical digest, stable
Mutation Call Identity or Effect Identity, and validated result, timer, or
signal receipt. Arbitrary callback effects are not checkpoints.

### Durable Workflow

A persisted orchestration projection over the shared Durable Run kernel. It
adds checkpoint history, durable timers, typed signals, and explicit semantic-
version and executable compatibility; it is not a second runtime.

### Operational Fact

A fact about how one compiled application executed rather than about what it
stores: Durable Run and Physical Attempt state, transitions, Effect Identities,
Lease facts, and receipts. An operational record may carry application data as
its payload, and carrying it never makes that payload an Operational Fact.

Do not use: internal state, kernel row, telemetry.

### Execution Envelope

The versioned correlation schema carried by each append-only Runtime event. It
correlates operation, transaction, causation, idempotency, dispatch, Job or
Workflow attempt, error, log, span, and audit identities. It is not one mutable
execution record.

### Deployment Compatibility

The separate schema, wire, Policy and Context, realtime, executable, and
internal-protocol decisions that determine whether a Runtime Build can start,
resume retained work, roll back, or retire.

## Compatibility terms

### Data Compatibility

The ability to preserve or migrate persisted PostgreSQL data.

### Behavior Compatibility

The ability to preserve externally observable application guarantees.

### Source Compatibility

The ability to compile existing v3 application source without changes. V4 does
not require Source Compatibility by default.
