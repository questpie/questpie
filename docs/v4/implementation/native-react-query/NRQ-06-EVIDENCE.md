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

## SLA browser build repair

The second full attempt, on clean `640694e8d`, passed the repaired native
consumer in its original suite position, including the nested 39 assertions.
It also passed the 111-assertion Team Support Desk PostgreSQL/Firefox journey.
The lane then failed at the static SLA sweep's browser bundle after 408,033 ms;
no load/soak stage ran. `attempt-MIpSrV` retains the logs and a failed result
with completed cleanup.

The failing helper could not resolve the existing `web/questpie.ts` and
`web/main.tsx` imports under repository Bun test discovery. A focused build
reproduced the same error; the identical browser build in an ordinary Bun child
succeeded, and an explicit fixture build root did not repair the test-host
failure. This is test-harness evidence, not a missing product module or a
Runtime failure.

The helper now invokes one ordinary Bun CLI browser build with the same real
entrypoint, ESM target and minification. There is no retry or alternate path.
The build has a 30-second kill deadline inside the regression test's 35-second
harness limit. The focused bundle regression passes five assertions, and the
unchanged PostgreSQL/Firefox SLA sweep passes all 32 assertions in 13.16 seconds
at `attempt-4lSHBe`, with completed owned-resource cleanup. Formatting, lint,
strict helper types and `git diff --check` pass. An independent non-author review
reports no finding in the unchanged bundle behavior, deadline or regression
checks. These focused checks did not close full-suite verification; the frozen
rerun below does.

## Frozen local release checks

All following checks ran on clean `ecf03f317`, without changing HEAD or tracked
files during either coordinator. They are `reference-local`, not dedicated
release-runner measurements.

| Check                                                     | Result                                                                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete PostgreSQL 17 lane                               | PASS: 187 tests, four PG18/PgBouncer environment skips, zero failures, 2,135 assertions across 45 roots; 405.934 seconds                                                           |
| Worker contention                                         | PASS: 5.846 seconds                                                                                                                                                                |
| Ten-instance workload                                     | PASS: 9.206 seconds                                                                                                                                                                |
| Mutation transaction-tail workload                        | PASS: 13.691 seconds                                                                                                                                                               |
| Soak/chaos workload                                       | PASS: 12.323 seconds                                                                                                                                                               |
| `quality:release`                                         | PASS: 1,229 ordinary tests, 198 gated skips, zero failures; separate Desk DOM, real release contract, native packed browser, basic/Start tutorial browser, OTel and CLI gates pass |
| Forward TypeScript; Knip and acceptance negative controls | PASS                                                                                                                                                                               |
| Two separately forced builds and release dry-runs         | PASS; both public package archives directly compared byte-for-byte after both runs                                                                                                 |
| Measured release budget                                   | PASS: 14,575.42 ms under the unchanged 15,000 ms limit; nine assertions                                                                                                            |
| `git diff --check`                                        | PASS                                                                                                                                                                               |

The PostgreSQL/workload coordinator retains logs and its successful cleanup
record in `attempt-16F2eZ` under the local coordinator directory above. The final
quality/build coordinator retains its result, logs, two tool-generated manifests
and both archive pairs under
`/home/drepkovsky/code/questpie-nrq06-final.LFBkPw/attempt-gxFoWj`.
Its scratch cleanup completed. The two archives are 554,483 bytes (`questpie`)
and 14,850 bytes (`questpie-opentelemetry`); their tool-derived identities match
`quality/release/package-artifacts.json`.

An independent non-author review checked both result records, summed the
PostgreSQL logs, verified the separate release gates and compared both archive
pairs and manifests. It reports no finding in this evidence or the handoff.

## Manual preview and remaining release prerequisites

A separate task-owned coordinator snapshots the checked fixture and uses its
built public packages with a fresh loopback-only PostgreSQL 17 container. It
starts the normal app, without tracer query parameters, and runs the existing
migration, Seed, auth and explicit schedule activation commands. App, Scalar
and OpenAPI each return HTTP 200. The current control record is
`/home/drepkovsky/code/questpie-desk-preview-control.DEFL38/control.json`;
read it for the live port and owned process before cleanup. This intentionally
running preview is separate from the cleaned verification resources.

Interactive browser discovery returned no available browser. No fresh manual
visual inspection is claimed; the automated Firefox checks above are separate
evidence. User inspection and final manifest binding remain required.

The repository's runner inventory reported zero registered runners. The owner
subsequently chose the [manual beta.2 release route](../beta2-closure/MANUAL-RELEASE.md)
and deferred CI/CD. Dedicated-runner execution is therefore no longer a
prerequisite for this beta. The results above retain their actual local
classification; no stable-runner measurement is inferred or manufactured.

Only after all prerequisites pass may the existing ticket-specific manifest
invoke its one permitted acceptance review. A committed, verified PASS precedes
a separate authority projection. Push, tag, publish, deploy and registry
deprecation remain unauthorized.
