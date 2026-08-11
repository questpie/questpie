# QUESTPIE v4 Canonical Language

This file defines framework-specific terms. `SPEC.md` defines product behavior
and implementation order. `docs/adr/README.md` indexes current decisions.

## Product terms

### QUESTPIE Runtime

The process that runs one compiled PostgreSQL application. It runs as a
standalone process by default. It owns operation dispatch, workers, realtime
sessions, health, startup, and shutdown.

Do not describe the default product as: CMS server, host adapter, embedded
library. A low-level Fetch embedding seam remains supported.

### Studio

The optional inspector and operational control surface for one compiled
QUESTPIE application. It reads the App Contract and Execution Envelope.

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

### App Contract

The concrete generated TypeScript and runtime surface of one compiled
application. It includes exact Resources, context, operations, client exposure,
errors, and required metadata.

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

### Application Scope

The lifetime of one running QUESTPIE Runtime and its shared resources.

### Execution Scope

The lifetime of one request, Job attempt, Workflow step, script call, or test
execution. It carries immutable Principal, Tenant, Authority, cancellation, and
trace context.

### Transaction Scope

The PostgreSQL transaction owned by one Mutation or explicit transactional
operation.

### Principal

The authenticated or anonymous identity facts used by Policy. Principal exists
without a credential Auth integration.

### Tenant

The immutable application-selected isolation identity for one Execution.

### Authority

The immutable class of actions an Execution may request. System Authority is an
explicit trusted capability and cannot be derived from request input.

### Policy

A typed authorization rule that allows, denies, or adds a row filter. Policy
applies to normal clients, direct operations, and Studio.

### Query

A read-only semantic Operation. A supported Query can be watched as a Live
Query.

### Mutation

A semantic Operation that owns one PostgreSQL transaction and its atomic
Transactional Dispatch boundary.

### Action

A semantic Operation for external effects outside the Mutation transaction and
automatic retry guarantee.

### Route

An explicit HTTP Operation for webhooks, streaming, file transfer, or custom
protocol control.

### Change Ledger

The durable PostgreSQL record of reactive data changes written inside the
business transaction. Lossy wake mechanisms only announce possible progress.

### Live Query

A subscription to the recomputed authorized result of one Query. The Runtime
records the supported data, Policy, tenancy, Relation, and pagination reads that
the handler actually executes, then replaces the dependency set after each run.

### Transactional Dispatch

Durable follow-up intent committed in the same transaction as business data and
advanced later by a worker.

### Reaction

A declared durable handler that follows committed application state. It is the
first tracer form of work advanced by Transactional Dispatch and at-least-once
execution.

### Queue

The Runtime scheduling and lease surface that advances durable work. Queue is
an operational product area, not a source-composition primitive.

### Job

A durable unit of background work with dispatch identity, lease, attempt,
idempotency, retry, cancellation, and terminal state.

### Durable Workflow

A persisted orchestration built on Job, timer, signal, lease, and execution
history primitives. It is not a second runtime.

### Execution Envelope

The versioned correlation schema carried by each append-only Runtime event. It
correlates operation, transaction, causation, idempotency, dispatch, Job or
Workflow attempt, error, log, span, and audit identities. It is not one mutable
execution record.

## Compatibility terms

### Data Compatibility

The ability to preserve or migrate persisted PostgreSQL data.

### Behavior Compatibility

The ability to preserve externally observable application guarantees.

### Source Compatibility

The ability to compile existing v3 application source without changes. V4 does
not require Source Compatibility by default.
