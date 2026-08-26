# QUESTPIE v4 deep DX decision map

- Status: research bootstrap; no public-interface authority
- Goal: make a substantial application easy to author, understand, operate,
  and extend without weakening the accepted v4 guarantees
- Consumer tracer: Team Support Desk first, then representative Autopilot
  slices with measured handwritten-code deletion
- Delivery rule: design fiction and public documentation before implementation;
  user approval before any superseding ADR or public API
- Evidence:
  [current framework atlas](../framework-api-atlas/DECISION-MAP.md),
  [Support Desk DX evidence](../../implementation/team-support-desk/DX-EVIDENCE.md),
  the three benchmark reports beside this map, and the
  [Fable cross-model synthesis](./FABLE-SYNTHESIS.md)

Every ticket must compare materially different interfaces against one complete
vertical. A convenience is not earned by one fixture: it needs a deep owner,
at least two real consumers or adapters, exact lifecycle and failure semantics,
and a deletion test. Accepted ADR guarantees remain in force until a focused
superseding decision is approved.

## #0: Which document governs this redesign?

Blocked by: none
Type: Discuss

### Question

Declare the relationship between the historical framework API atlas, this
deep-DX map, earlier candidate redesign documents, Accepted ADRs, and current
implementation evidence. Enumerate the exact Accepted clauses that later
packets may propose to supersede and rule whether ADR-0008 freezes TypeScript
authoring spelling or only semantic and artifact contracts.

### Answer

Partial direction. Accepted ADRs, `SPEC.md`, and `CONTEXT.md` remain product
authority. The historical atlas explains how that baseline was selected;
earlier redesign documents and the reports beside this map are research
evidence only. This map governs sequencing of the new investigation but cannot
supersede product authority. The exact supersession inventory and ADR-0008
scope belong in approval packet 1.

## #1: What is the one teachable application mental model?

Blocked by: #0
Type: Discuss

### Question

Define the smallest vocabulary and import map that explains Collection,
Structural Query, Query, Mutation, Action, Route, Service, credential resolver,
Context, Policy, Job, generated App Contract, and generated client without
requiring implementation history. Decide which concepts a beginner must name
and which should remain compiler/runtime machinery.

### Answer

Open; this is the current frontier. Fixed constraints: stored data is not an
endpoint declaration, Policy is transport-neutral authorization, semantic
Operations own execution guarantees, Route owns explicit HTTP, Job owns durable
work, and generated contracts are the exact application type source. Candidate
naming must be demonstrated as a complete Support Desk slice, not a glossary in
isolation.

## #2: How is an application composed and configured?

Blocked by: #1, #3 for provider-owned schema participation
Type: Prototype

### Question

Design one full Service/Auth/Route composition using Better Auth and one other
external integration. Close typed deployment configuration, application and
execution lifetimes, dependency ownership, runtime-package bundling, database
adapter access, disposal, credential multiplexing, failure, and testing. Decide
whether application composition can remove the current manual Service,
credential-resolver, and Route wiring without creating an Auth provider ABI.

### Answer

Open. Preserve Principal/Context/Policy authority and the accepted rule that
Auth is application or Package composition rather than framework policy.

## #3: What does every Collection own internally?

Blocked by: #1
Type: Prototype

### Question

Close canonical Policy-aware CRUD, Field write provenance, lifecycle phases,
validation, server/database values, invariants, audit, Change Ledger capture,
and transaction-owned Job acceptance. Decide how named Mutations compose the
kernel without bypassing it and whether any CRUD exposure shorthand survives.
Test simple CRUD and a cross-Collection state transition.

### Answer

Open. Internal CRUD and public network exposure are separate decisions. A
Collection must not silently publish new caller input or output when a Field is
added.

## #4: What is the reusable read and predicate language?

Blocked by: #1, #3
Type: Prototype

### Question

Design selection, filters, bounded parameters, nested Relations, ordering,
pagination, aggregates, reuse, prepared lowering, and Live Query observation as
one coherent structural language. Explain the boundary between Structural Query
and semantic Query. Unify ordinary row predicates and boolean-only Policy
evidence where that improves the surface without confusing disclosure or
authorization semantics.

### Answer

Open. `dataQuery`, `query.*`, and `policy.exists` are current evidence, not
protected spelling. Boolean Policy evidence must remain nondisclosing and may
not become an ordinary row read.

## #5: How is one semantic Operation projected to callers?

Blocked by: #1, #4
Type: Prototype

### Question

Project the same Query, Mutation, or Action semantics into direct server calls,
the generated first-party RPC client, optional real HTTP/OpenAPI endpoints, MCP
tools, and framework-neutral reactive descriptors. Close route matching,
operation identity, errors, context input, cancellation, invalidation/watch
lifecycle, named generated types, React integration, and capability-negative
imports without duplicating handlers or Policy.

### Answer

Open. The single `/_questpie/operation` Wire endpoint remains a valid candidate
for the first-party generated client; it must not be mistaken for the complete
HTTP/OpenAPI story. Route remains the raw HTTP escape hatch unless an explicit
Operation-to-HTTP projection is earned. Projection ownership and delegation to
the same executor are already Accepted; only optional shape and DX are open.

## #6: What is the ordinary Job interface?

Blocked by: #1, #2; coordinate generated acceptance with #5
Type: Prototype

### Question

Make the implemented ordinary Job acceptance, delay, idempotency, retry,
cancellation, heartbeat, abort handling, scheduling, and later checkpoints understandable
without exposing lease machinery as everyday ceremony. Decide which controls
are automatic, which need explicit cooperative calls, and how docs explain the
failure windows. Re-evaluate Reaction only through migration and deletion
evidence, not a second payload/event abstraction.

### Answer

Open. PostgreSQL durable identity, leases, fencing, retry, cancellation, and
fresh Policy remain fixed. Generic browser Job control and a generic event bus
remain absent unless a whole-product journey earns them. Collection-change
triggers are a later sub-ticket blocked by #3 and must not delay ordinary Job
ergonomics.

## #7: How does a Package add a vertical capability?

Blocked by: #1; capability-specific blockers from #2 through #6 apply
Type: Prototype

### Question

Author and consume at least two Packages, such as Better Auth composition and a
PostGIS, full-text, or pgvector capability. Close activation, typed config,
Definitions and Augmentations, migrations, runtime dependencies, generated
types/client projections, version compatibility, Origins, diagnostics,
testing, and removal. Determine the deepest reusable seam without a runtime
plugin registry or privileged compiler ABI.

### Answer

Open. Installation alone cannot activate a Package, and a Package cannot gain
host-only authority through ambient imports.

## #8: What proves the redesign is simpler?

Blocked by: #2, #3, #4, #5, #6, #7
Type: Discuss

### Question

Define the documentation information architecture and the adoption scorecard.
Run the approved interfaces through Team Support Desk and representative
Autopilot slices; measure deleted handwritten code, concepts named per journey,
generated declaration quality, editor inference, compiler diagnostics, SQL and
Policy parity, runtime limits, and migration effort. Identify compatibility
shims and their deletion conditions before entering maintenance mode.

### Answer

Open. Correctness gates remain mandatory; line deletion and fewer public
concepts are adoption evidence, not substitutes for semantic parity.
