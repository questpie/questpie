# ADR 0027: Simplify V4 Delivery Around Runnable Tracers

- Status: Proposed
- Date: 2026-08-23

## Context

QUESTPIE's proof-first design established the compiler, schema, Policy,
transaction, Change Ledger, durable execution, and Runtime guarantees needed
for v4. It also made proof ceremony the default for Product work that ordinary
integration tests can settle. This delayed runnable application feedback and
encouraged contract work ahead of its consumers.

The repository now has enough accepted kernel authority to invert that flow.
The runnable tracer should pull the next capability through the existing
kernel. Autopilot should then prove that the capability removes downstream
framework code. Formal semantic review remains valuable where a mistake changes
a cross-process integrity or public architecture guarantee, but not for every
Product increment.

## Decision

### Two rigor tiers

Every change is classified by the guarantee it changes, not by its package or
feature name.

**Kernel** work creates or changes a guarantee in static composition and
artifact compatibility, schema lifecycle, transaction scope, Policy and
nondisclosure, dispatch and Reaction, Change Ledger correctness, or durable
identity, lease, fencing, retry, cancellation, checkpoint and executable
compatibility. A Product feature uses Kernel rigor for the part that changes
one of these guarantees. A Route credential transition, for example, is not
ordinary Product work if it changes trusted Principal or Authority semantics.

**Product** work projects an accepted Kernel through Routes, application Auth
composition, Files, CLI behavior, documentation, Studio views, generated-client
ergonomics, and similar user-facing capabilities. It ships through tracer-led
TDD and ordinary integration tests. It does not maintain proof heads, manual
digest tables, or fresh-model acceptance records merely because it is public.

The classification, expected evidence, and overturn condition belong in the
issue before implementation. Uncertainty defaults to the narrow Kernel portion,
not to treating an entire feature as Kernel work.

### The runnable tracer pulls work

The first integration target is to establish one runnable backend journey:

```text
compile -> migrate -> start -> Query -> Mutation -> browser Live Query
        -> committed Reaction -> restart and recover
```

Once established, that journey remains the regression skeleton. It uses
disposable PostgreSQL and the real generated direct, Fetch, and client paths.
Shortcuts may omit Product polish. They may not bypass Policy,
transaction ownership, migration and Runtime artifact integrity, the Change
Ledger, or durable recovery.

No new contract is designed ahead of this tracer unless it removes a concrete
tracer blocker or supersedes an unsafe accepted decision. Each later capability
must first land in the tracer. The tracer retains the right established by
ADR-0004 to delete an abstraction that supplies no needed guarantee.

Autopilot is the second tracer. Each relevant v4 capability must name the
downstream duplication it removes and record net handwritten lines deleted.
Deletion is an adoption signal, not a correctness oracle or a target that may
be improved by moving or generating equivalent code.

### Bounded proof work

A focused Kernel proof has a default two-working-day construction budget. If it
cannot falsify or establish the proposed claim in that budget, the claim is
shrunk, split, or deferred. The budget never converts missing evidence into
acceptance and does not truncate a deterministic PostgreSQL, load, or soak run
required by the narrowed claim.

Exactly one fresh stateless Opus-medium acceptance review is reserved for:

1. a new or superseding Accepted ADR that changes a public Kernel or
   architecture guarantee; or
2. a release semantic boundary that combines Kernel guarantees which
   deterministic gates cannot completely review for consistency.

Ordinary Product slices, tracer increments, implementation of an already
accepted contract, refactors, and documentation projections do not receive a
formal model acceptance review. They use deterministic gates and normal human
or agent code review. Exploratory adversarial review may help development but
has no acceptance status.

When formal review is required, the repository-pinned manifest wrapper remains
the only protocol. Its generated SHA-256 authority-path and packet bindings are
retained. Historical manifests and review records remain immutable.

### Integrity digests are not documentation bookkeeping

Git commits and tags replace manually copied proof-head and canonical-artifact
digest tables in living prose. Proof measurements, raw output, and exact
commands belong in test artifacts or the exceptional acceptance manifest that
consumes them.

This does not remove semantic or integrity digests used by the product or its
verification. Runtime Build, executable, wire, artifact inventory, schema
fingerprint, migration checksum and Plan Digest, call/input/effect identity,
and Job checkpoint command digests remain part of their accepted contracts.
Generated acceptance-manifest hashes also remain. These values must be derived
or verified by tooling rather than copied into recurring status prose.

### Documentation and deletion discipline

A new contract document has a review budget of at most 300 normative lines.
When more is required, split the contract by owner or invariant. Types carry
shape; prose carries authority, lifetime, concurrency, failure, recovery, and
cross-process semantics. Measurements and proof transcripts live with test
artifacts rather than in the normative contract.

Once each week, review accepted and proposed abstractions against the runnable
tracer and Autopilot. An unaccepted abstraction with no consumer is deleted. An
Accepted abstraction with no current consumer is a deletion candidate, but a
focused superseding ADR is required when deletion changes public authority.
Named compatibility seams required by a release decision are consumers for
this purpose, not dead code by definition.

The executable flow and metrics are maintained in
[`docs/v4/DELIVERY-FLOW.md`](../v4/DELIVERY-FLOW.md).

## Consequences

- Runnable application feedback precedes further capability breadth.
- Product work normally ends at deterministic integration and repository gates.
- Formal acceptance cost is paid only at Kernel, public architecture, or
  exceptional release semantic boundaries.
- Proof scope shrinks when evidence is too expensive to obtain quickly.
- Living documentation stops duplicating content-addressed history.
- Runtime integrity and compatibility checks remain unchanged.
- Downstream deletion demonstrates adoption without replacing correctness,
  latency, resource, or user-journey evidence.

## Supersession

On acceptance, this ADR narrows ADR-0020's formal acceptance-review requirement
and replaces proof-phase sequencing for future delivery. It strengthens
ADR-0004's tracer ordering and changes ADR-0021's later-slice execution from a
fixed phase queue to tracer-pulled milestones. Historical accepted proofs,
heads, manifests, reviews, and released contracts are not reopened.

## Rejected alternatives

- Remove all digests, including Runtime and migration integrity contracts.
- Apply formal model acceptance review to every Product increment.
- Treat every Route, Auth, File, CLI, or Studio change as low risk regardless
  of the Kernel guarantee it crosses.
- Let a two-day deadline weaken or waive a Kernel claim.
- Use downstream line deletion as the sole progress or quality measure.
