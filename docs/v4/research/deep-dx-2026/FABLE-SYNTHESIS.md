# Fable cross-model synthesis

- Date: 2026-08-26
- Status: exploratory adversarial review; no PASS or acceptance authority
- Inputs: the three benchmark reports beside this file, the Support Desk DX
  evidence, the earlier redesign candidates, and their cited Accepted ADRs
- Review shape: Fable 5 synthesis after independent Sonnet reviews of data and
  Policy, composition and durable work, and client and transport

## Convergence worth preserving

All three lanes independently converge on one deep semantic owner with smaller
capability-scoped projections:

- one relational and expression kernel, with ordinary disclosed reads and
  boolean-only nondisclosing Policy evidence as distinct projections;
- one application composition graph, with configuration, Service lifetime,
  provider integration, credential resolution, and Route mounting exposing only
  their legitimate capabilities;
- one Operation executor, with direct, generated Wire, optional HTTP/OpenAPI,
  MCP, and client/reactive views delegating rather than re-authoring behavior;
- one PostgreSQL durable kernel, with ordinary and checkpointed Job behavior
  revealed progressively instead of separate Queue, Scheduler, or Workflow
  products.

This is stronger evidence than agreement on a helper name: the same ownership
shape survived different domains and different benchmark sets.

The review also confirms these stable boundaries:

- Auth yields credential facts and Principal; current Context and relational
  Policy remain QUESTPIE authority.
- A raw Route owns protocols where HTTP itself matters. A semantic Operation
  owns application calls where HTTP is merely a carrier.
- Stored Collection shape, internal CRUD capability, and public client exposure
  are separate decisions.
- React is a projection over a framework-neutral generated client lifecycle,
  not a second contract or identity owner.
- Background work alone does not earn an Event Resource or event-to-Job payload
  relay.

## Adversarial findings accepted into the map

### The research has two maps

The older
[framework API atlas](../framework-api-atlas/DECISION-MAP.md) records the path
that produced much of the Accepted v4 baseline. This deep-DX map governs only
the new redesign investigation. Until that relationship is explicit, agents
can incorrectly treat old candidate answers and new open tickets as competing
authority.

The first ticket must therefore establish provenance and list every Accepted
clause that a later packet may propose to supersede. Research prose never
supersedes an ADR.

### Candidate examples are leaking decisions forward

Earlier redesign examples use spellings such as `expose`, `admission`, and
Collection-local read methods before the mental-model ticket has selected a
vocabulary. They remain design fiction only. Packet 1 must compare complete
journeys with placeholder status clearly visible; later packets may not cite
one candidate example as settled syntax.

### The two-consumer and deletion bars are not met

Support Desk is implemented evidence. Autopilot is currently an audit target,
not a port of the candidate interfaces. Reported handwritten-line savings are
estimates until the adoption ticket measures real deletion. Likewise, Better
Auth is one composition adapter, while HTTP/OpenAPI and MCP are accepted seams
without current implementation evidence.

No public primitive can claim generality from those single examples. The
approval packets may select prototype candidates, but acceptance requires the
named second adapters or an explicit narrower scope.

### Error and failure fidelity must precede projection syntax

HTTP and MCP mappings cannot reinterpret Mutation replay, post-commit outcome,
or Action ambiguity as ordinary transport retry advice. Credential absence,
malformation, conflict, provider outage, cancellation, and anonymous ingress
also need a closed precedence rule. Application Service construction failure
currently caches a rejected creation Promise for the Runtime lifetime; a later
composition packet must deliberately choose fail-readiness, cached failure, or
safe retry.

### Known current-contract repairs must not hide inside redesign

The earlier holistic audit reports a possible multi-read Query snapshot gap and
an unenforced purity claim for closed lifecycle callbacks. These require fresh
verification against the current tree. If they reproduce, they are repairs to
Accepted guarantees, not reasons to invent a new public API.

## Corrections to the cross-model review

The reviewers also consumed stale pre-closure research. The current canonical
tree corrects these claims:

- ordinary Job is not an unexecuted primitive. It is integrated through
  `a55dabf4` and closed through `84cb374e`, including claim, execution,
  settlement, retry, cancellation, heartbeat, stale fencing, and restart
  recovery; see [HANDOFF](../../../../HANDOFF.md);
- generated Collection `update` is no longer merely typed and filtered out. The
  Support Desk tracer pulled its PostgreSQL compiler/runtime program at
  `83791c0a`; the remaining CRUD inventory must be inspected member by member;
- Operation projection ownership is not open. ADR-0018 already assigns it to
  the compiler and the same executor. Only the optional public projection shape
  and DX remain open.

This reinforces the need to mark stale candidate documents as evidence rather
than letting a reviewer infer current implementation state from them.

## Corrected decision order

1. Establish research authority, supersession targets, vocabulary, imports,
   and beginner disclosure order.
2. Verify and repair current Accepted invariants in parallel where no new API
   is required.
3. Design Collection CRUD, write provenance, lifecycle, and the structural
   read/predicate language together.
4. Design application configuration, Service/Auth/Route composition; provider
   schema participation depends on the Collection and migration decision.
5. Design the Operation descriptor and generated client/reactive projections;
   optional HTTP/OpenAPI and MCP are later views of the same executor.
6. Design ordinary Job ergonomics independently from later Collection-change
   triggers. Coordinate generated Job acceptance with the server projection,
   but do not make Job a browser Operation.
7. Prove capability-specific Package verticals rather than a universal plugin
   API.
8. Measure Team Support Desk and Autopilot adoption; only here do deletion
   estimates become claims.

## Exact scope of approval packet 1

Packet 1 is a paper design comparison, not an implementation ticket. It must
contain:

1. the relationship between this map, the historical atlas, Accepted ADRs, and
   earlier candidate redesign documents;
2. an explicit list of live Accepted clauses and potential supersession targets,
   including the authoring-surface scope of ADR-0008;
3. a vocabulary and import map showing which concepts a beginner names and
   which remain compiler/runtime machinery;
4. the same Support Desk journey in three materially different directions: a
   paged filtered Query, the trusted `closedAt` Mutation assignment, one Job
   acceptance, and browser consumption;
5. per direction, concept count, imports, progressive disclosure, authority
   owners, and what adding a Field changes silently—it must change no public
   input/output surface;
6. explicit non-scope: final syntax, Reaction removal, OpenAPI/MCP shape,
   Package ABI, implementation, or ADR edits.

The three directions to compare are:

- **Domain-noun local:** Collection nouns are the discoverability root and
  Structural Query is mostly hidden machinery.
- **Small algebra and minimal supersession:** retain explicit structural plans
  and a small shared expression language, repairing measured friction without
  replacing the accepted authoring surface wholesale.
- **Kernel and projection:** teach a few deep kernels and expose generated
  capability projections explicitly, optimizing for authority clarity and AI
  navigation at the cost of a more architectural first page.

No direction is selected by this research.

## Hard stops before implementation

- No change to an Accepted public clause without user-approved design fiction
  and, where required, a focused superseding ADR.
- No public syntax chosen from a single fixture or benchmark aesthetic.
- No composition surface before credential conflict/anti-downgrade, Service
  construction failure, typed configuration, and disposal semantics close.
- No HTTP/MCP projection before an exact outcome-fidelity rule proves it cannot
  weaken Mutation or Action semantics.
- No lifecycle purity promise without an enforceable evaluator/compiler seam.
- No deletion or simplification claim before measured downstream adoption.
- No production implementation in the research worktree.
