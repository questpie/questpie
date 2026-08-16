# BETA-06 Change Ledger authority reconciliation

## Decision

The `committed change fact` artifact and the `Message/audit/change/Reaction
intent` fixture wording in P16 and GitHub issue #293 are a contradictory issue
projection. They are removed from BETA-06. The slice keeps its typed,
transaction-owned pending Reaction intent and exact result receipt.

Accepted ADR-0012 and P4 are the higher and more specific authority for Change
Ledger capture: compiler-owned PostgreSQL triggers append bounded facts in the
business transaction for reactive Collections. BETA-07 cites ADR-0012 and owns
`Change Ledger DDL/triggers`. BETA-06 neither cites ADR-0012 nor owns those
triggers. Synthesizing a fact in the Mutation Runtime would create a second
capture path, fail the raw-DML/external-writer contract, and invent the still
undefined reactive-Collection predicate and trigger-compatible schema.

ADR-0013's atomicity statement is preserved: when compiler-owned Change Ledger
capture exists, its facts join the same business transaction. It does not move
capture ownership from P4/BETA-07 into every earlier Mutation tracer. P3/P5's
pending intent remains required in BETA-06 and is not relabelled as a committed
change fact or durable Reaction run.

## Readiness

BETA-06 remains the sole agent-ready issue. Accepted BETA-05 merge
`740f2e0049a64f5a541f33ab8da44cf8e114041b` is pinned in `acceptedIssues`, is
an ancestor of this revision base, and GitHub issue #292 was observed closed.
This revision changes ownership wording and enforcement only; it does not
advance BETA-07 or accept BETA-06 implementation.

## Projection protocol

The exact repository projection is the reviewed branch diff from
`6006800b694bd2751e4f431b4be727245f5398c1`. `ISSUE-293.expected.md` is the
byte-exact body rendered from the revised queue with BETA-05 mapped to #292.
The live issue body is updated only after the deterministic gates and one fresh
stateless Opus-medium review pass. The issue remains open and its
`ready-for-agent` state is preserved.

The P16 checker now rejects four ownership regressions: restoring a BETA-06
change fact, deleting its pending intent, deleting its explicit Change Ledger
non-goal, or removing BETA-07's ADR-0012/compiler-trigger ownership.
