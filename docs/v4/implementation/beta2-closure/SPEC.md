# Beta.2 closure repair

## Problem

The implemented DX candidate still contains duplicated carrier parsing and
Operation adaptation, transport-neutral metadata under HTTP ownership, and
documentation/proof staging inconsistencies. These are closure work, not new
product scope. The human confirmed this boundary and its ticket breakdown.

## Solution and user stories

1. Application authors keep the same public API and generated contract.
2. Maintainers change strict JSON parsing once for HTTP and MCP.
3. Projection consumers share neutral Operation metadata without depending on
   another transport's implementation.
4. Callers retain exact credential ordering, Policy nondisclosure, cancellation,
   declared failures, Mutation replay, and Action ambiguity.
5. Readers can distinguish a candidate from a released beta and see every
   implemented executable Definition kind.
6. Reviewers receive a fresh candidate with consistent policy and proof bindings.
7. Release operators receive verified artifacts without implicit publication.

## Implementation decisions

Preserve Accepted ADRs, one execution kernel, and all transport-specific
semantics. Extract only responsibilities with current duplicate consumers.
Do not create a provider framework, public helper, compatibility alias, fallback,
or file split justified only by line count. Any required behavior change stops
that specific extraction for a separate decision.

## Testing decisions

Use existing HTTP/MCP ingress, compiler outputs, and generated-client seams.
Characterize accepted behavior before refactoring; do not invent a failing
behavior expectation for a behavior-preserving move. New defect repairs need a
failing regression first. Preserve artifact semantic bytes; rebuild executable
and archive digests from tools when source relocation changes them.

Run focused tests and workspace types per slice, then independent Standards and
Spec reviews, PostgreSQL 17/browser, quality:release, TypeScript-forward, two
byte-identical release dry-runs, and git diff --check on the final candidate.

## Sequence

1. Shared strict JSON through HTTP/MCP: no blockers.
2. Neutral Operation metadata through projections: no blockers.
3. Shared admission/outcome responsibility: blocked by 1.
4. Public documentation and proof staging: no blockers.
5. Aggregate acceptance and authority projection: blocked by 1 through 4.

The issue tracker owns ticket status and native blocking links. Existing parent
issue #359 remains unchanged until its own closure procedure.

## Release boundary

ADR-0039 stays Proposed until a verified acceptance PASS and a separate authority
projection. The human requested Fable 5.1; its output must never be labeled as
the pinned Opus profile. Reconcile reviewer provenance explicitly before an
acceptance invocation. No acceptance review runs during these repairs.

Autopilot implementation, new framework features, lifecycle redesign, broader
explain, push, tag, publish, and deployment remain outside this work.
