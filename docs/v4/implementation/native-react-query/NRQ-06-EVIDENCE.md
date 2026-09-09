# NRQ-06 aggregate release frontier

This records final integration checks, not beta.2 acceptance. ADR-0039 remains
Proposed. NRQ-01 through NRQ-05 are complete under Accepted ADR-0044; schedules
and minimum Mutation checkpoints are accepted under ADR-0043. No new lifecycle,
React, schedule or optimistic-engine design is opened by this work.

## Candidate reconciliation

The Proposed release ADR now includes native React Query and Start SSR/hydration
instead of the deleted hook, and static UTC schedules with the named-Mutation
checkpoint instead of blanket Cron exclusion. It states the exact optional
React/TanStack peers, actual-use package checks and protocol-v9 non-rolling
boundary. The public latest-release projection is unchanged.

The historical aggregate acceptance manifest still describes the earlier
candidate. It is not ready to submit: final evidence and tool-derived bindings
must replace its old scope and measurements. No acceptance reviewer has been
invoked for this integration.

## Independent static integration review

Two fresh non-author agents reviewed `97910dac9...68abbec95` separately, reading
the canonical specification, repo standards and Accepted ADR-0043/0044.

- Standards: no actionable hard violation or substantiated design-smell finding
  in the inspected native ownership/projection, package, schedule/checkpoint,
  compiler-resolution and CLI boundaries.
- Spec: no confirmed missing or incorrect guarantee in inspected native input/
  identity, pagination, failure provenance, invalidation/retirement/SSR and
  schedule activation/frontier/checkpoint/cutover paths. Already-running native
  callbacks remain the documented already-disclosed-work limitation.

Both reviews were targeted static inspections, not exhaustive line-by-line
reviews of all 441 changed files. Neither reviewer ran builds, PostgreSQL,
browser or workload tests. Exact-range `git diff --check` passed. Their reports
do not close the deterministic gates below or constitute formal acceptance.

## Full PostgreSQL attempt

The task-owned local coordinator started all registered PostgreSQL tests on
clean `68abbec95`, using an explicit local Docker socket, a fresh PostgreSQL 17
container, loopback-only port and disk-layer database storage. Only allowlisted
host environment enters the process. Child groups have bounded cancellation;
container identity and ownership label are checked before cleanup.

The first full attempt failed after 154,146 ms at the native consumer's
migration setup, before its live/refresh scenarios. It did not run the queued
load/soak stages. Logs remain under
`/home/drepkovsky/code/questpie-nrq06-local.PZlb6l/attempt-RqAstP/logs` and the
result records `FAIL` with completed cleanup. No product PASS is inferred from
the preceding successful roots.

Minimization disproved two suspected predecessor sequences: Mutation-list then
native passed, and durable-executable then inverse then native passed. Those
tests use private databases or clean their own schema. The concrete failure
state is an existing Collaboration schema with its migration ledger removed:
native migration/scenarios pass first; deleting only `questpie_internal` leaves
the fixture present and the ledger absent; another native invocation then
fails at migration. The inverse tracer removes that ledger as part of its own
fixture cleanup, so the native test must establish its own schema precondition.
The diagnostic result is retained under `attempt-gA5lPC`, with cleanup complete.

The repair is limited to the owned test database. After validating container,
loopback endpoint and exact database, the native case uses that explicit
connection and resets only its Collaboration and internal fixture schemas.
It still applies the unchanged immutable migrations and requires all 39 native
assertions. Runtime and migration behavior are unchanged; no already-applied
or missing-test fallback is introduced. The repaired fresh-then-ledger-removal
sequence passes both actual native invocations and strict generated types at
`attempt-2eqrr1`, with cleanup complete. That is working-tree red/green evidence,
not a frozen final-head result. The full rerun remains required.

An independent non-author review confirms that all container/endpoint/database
and PostgreSQL-major guards precede the fixed two-schema reset; it reports no
finding. The same reviewer found no divergence in the Proposed release-scope
reconciliation. Changed-scope formatting/lint, the preview-staging tests
(2 / 31), questpie types and `git diff --check` pass.

## Gates still required

The corrected full PostgreSQL 17 lane, four actual local load/soak scenarios,
final quality/dependency/type checks, two forced byte-identical builds/dry-runs,
final manifest binding and user's manual preview remain required. Local
measurements are always `reference-local`.

Actual unchanged-budget execution on the dedicated `questpie-release` runner
remains an external release prerequisite; the repository's runner inventory
reported zero registered runners. The owner was asked for the prepared machine,
not credentials. Registration alone would not supply workload evidence.

Only after all prerequisites pass may the existing ticket-specific manifest
invoke its one permitted acceptance review. A committed, verified PASS precedes
a separate authority projection. Push, tag, publish, deploy and registry
deprecation remain unauthorized.
