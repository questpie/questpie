# QUESTPIE v4 deep DX decision map

- Status: directionally approved research; pending focused ADR/public-doc
  ratification, with no public-interface authority yet
- Goal: make a substantial application easy to author, understand, operate,
  and extend without weakening the accepted v4 guarantees
- Consumer tracer: Team Support Desk first, then representative Autopilot
  slices with measured handwritten-code deletion
- Delivery rule: design fiction and public documentation before implementation;
  user approval before any superseding ADR or public API
- Evidence:
  [current framework atlas](../framework-api-atlas/DECISION-MAP.md),
  [Support Desk DX evidence](../../implementation/team-support-desk/DX-EVIDENCE.md),
  the three benchmark reports beside this map, the
  [Fable cross-model synthesis](./FABLE-SYNTHESIS.md), and the repaired
  [approval packet #1 v2](./APPROVAL-PACKET-1.md) with its four recorded
  adversarial review lanes plus one later focused repair pass (packet
  section 23) that closed ten blockers found in review: Field/Constraint/
  Relation authoring consistency, complete pg_search and PostGIS worked
  examples, ordinary delayed-Job direction, three unratified numeric
  constants, the questpie.json/per-Operation projection ledger entry, exact
  ADR-0023 HTTP preservation, a dedicated Better Auth provider schema,
  Search embedding composition over Job and Action, and collision-domain
  terminology. A final naming/ownership repair then fixed core and capability
  namespaces, explicit named Index ownership, Search/PostGIS authoring,
  approved plan-scope facts, and honest Action Effect Identity limits.

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
scope are now recorded in
[approval packet #1 v2, section 20](./APPROVAL-PACKET-1.md). Its listed
directions are human-approved where section 24 says so, but every actual ADR,
SPEC, CONTEXT, or public-documentation change still awaits focused formal
ratification.

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

Directionally approved answer recorded in
[approval packet #1 v2](./APPROVAL-PACKET-1.md) sections 2 and 3: seven
beginner concepts (Collection, Query, Mutation, Action, Route, Job, Service)
over one import map, demonstrated as a complete Support Desk vertical. Core
category namespaces come from `questpie`; capability constructors stay under
their own `geo.*` and `search.*` namespaces without ambient augmentation. Fixed
constraints stand: stored data is not an endpoint declaration, Policy is
transport-neutral authorization, semantic Operations own execution
guarantees, Route owns explicit HTTP, Job owns durable work, and generated
contracts are the exact application type source. This remains research
direction, not an Accepted product contract.

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

Direction approved, pending ratification. Preserve Principal/Context/Policy
authority and the accepted rule that Auth is application or Package
composition rather than framework policy. Application composition places
Better Auth objects in a provider-owned PostgreSQL schema outside the
application schema; a reusable Auth Package must join the one compiled
schema/migration/fingerprint/drift lifecycle.

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

Direction and Field provenance spelling approved, pending ratification, as recorded in
[approval packet #1 v2](./APPROVAL-PACKET-1.md) sections 5 and 8. Internal
CRUD and public network exposure remain separate decisions. The earlier
statement that adding a Collection Field must change no public input or
output surface was too strong and is corrected: every Operation explicitly
chooses a derived or pinned surface. A derived surface (for example
`select: true` or a provenance-derived caller input) intentionally evolves
with its Collection; a pinned selection stays stable. The compiler emits the
exact App Contract change and generated TypeScript directs consumers; a
change is never hidden, and retained clients of a changed derived Operation
receive the explicit compatibility outcome rather than silent drift.

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

Direction approved, pending ratification. Collection-noun `list`/`get`, the
shared `expr` vocabulary, Policy-only nondisclosing `expr.exists`, object
selectors/orderings, and bounded multi-hop Relations are the proposed
surface. Plan-backed predicates may use read-only `principal`, `tenant`, and
declared `values`; every reached fact enters the plan and cursor dependency
scope. Exact Relation depth and aggregate ceilings remain measurement inputs,
not accepted constants. See packet sections 6, 7, 19, 22, and 24.

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

Direction approved, pending ratification. The single
`/_questpie/operation` Wire endpoint remains the first-party generated-client
RPC transport and is not the complete HTTP/OpenAPI story. Explicit
per-Operation `http`/`mcp` projection is orthogonal to global artifact
emission. Q63 uses exclusive per-pattern subtree ownership; raw Routes and
HTTP projections share one global routing trie, while MCP uses one global tool
namespace. The generated client uses nested kind/domain maps and one-object
envelopes over the same callable descriptors.

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

Direction approved, pending ratification. PostgreSQL durable identity, leases,
fencing, retry, cancellation, and fresh Policy remain fixed. Ordinary delay is
acceptance with `notBefore`; `sleepUntil` is only an advanced bounded
in-attempt wait. The Runtime owns routine heartbeat/cancellation propagation.
Generic browser Job control and a generic event bus remain absent; triggers,
service-principal run-as, and durable fan-out remain named later gaps.

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

Direction approved, pending ratification. Installation alone cannot activate
a Package, and a Package cannot gain host-only authority through ambient
imports. Core remains `index.btree`; capability Packages expose focused named
constructors only through their namespaces (`search.index.fullText`,
`geo.field.point`, `geo.codec.point`, `geo.index.spatial`). Every physical
Index is explicitly named in the owning Resource's `indexes` map. Core
`defineSearch` is the sole semantic Search Resource constructor. The packet
ledgers the required bare-index, object-map, and non-B-tree capability
supersessions; it does not edit their current authority.

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

Open, with the first measurement instrument in place. Correctness gates
remain mandatory; line deletion and fewer public concepts are adoption
evidence, not substitutes for semantic parity. The first clean-room AI
authoring audit ([ai-audit/AUTHORING-AUDIT.md](./ai-audit/AUTHORING-AUDIT.md),
evaluated in [approval packet #1 v2](./APPROVAL-PACKET-1.md) section 21)
authored a complete unfamiliar vertical from only the proposed beginner
guide and API reference: zero wrong primitive choices, zero
implementation-source lookups, seven hesitations that drove documentation
repairs, two kernel refinements, and three named capability questions.
Every implementation slice now carries the acceptance criterion that its
golden path needs no Runtime, compiler, or generated implementation
source.
