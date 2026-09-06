# Durable executable pinning: regression and repair

The pre-repair Job claim path compared only a contract digest where Accepted
ADR-0016, ADR-0017, ADR-0026, and implementation Gate 7 require compatible
executable bytes. This regression blocks checkpoint recovery proof.

The source audit is now reproduced through two compiled applications on
PostgreSQL 17. The regression in
`tests/integration/postgres/durable-executable-pin.test.ts` accepted delayed
Jobs on build A, then polled build B with the same Job contract and a different
handler. Before repair, B claimed one A-pinned run, returned marker `B`, and
consumed attempt 1. The retained A Runtime returned marker `A` for another run.
The stored Runtime Build remained A. This is an executable-pin defect, not
a proposed change to compatibility authority.

The initial test setup failures were not counted as RED evidence. Bun SQL's
`PGDATABASE` selection initially disagreed with the requested URL. The test now
creates its own database, aligns the process environment, and verifies the
connected database before migration. Three empty test schemas from the earlier
attempts were individually inspected and removed with their exact migration
bindings; the shared internal protocol was retained. Current teardown removes
only the database whose CREATE succeeded and its generated temporary apps.
The test requires a PostgreSQL 17 role with CREATEDB permission.

## Before-repair source findings

The following table records the RED implementation, not the repaired claim path.

| Owner                                                  | Source finding                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler `runtime/index.ts`, `projectRuntimeContract`  | A slot's runtime graph includes the entire origin module's content digest and the normalized Resource contract digest.                    |
| Compiler `job/index.ts`, `projectJobContracts`         | A Job's `contractDigest` hashes only its normalized contract.                                                                             |
| Runtime `durable/acceptance.ts`, `createJobAcceptance` | Acceptance stores `executableDigest: job.contractDigest`; it separately stores the supplied `runtimeBuildDigest`.                         |
| Runtime `durable/postgres-database-kernel.ts`          | Admission derives its available executable list from `definition.contractDigest`.                                                         |
| Runtime `durable/postgres-database-claim.ts`           | Claim compares semantic version and `job.contractDigest` with the stored executable digest; it does not compare the stored Runtime Build. |
| Runtime `durable/worker.ts`, `availableDefinition`     | Handler selection likewise matches the current Job by contract digest.                                                                    |

The paths above are under `packages/compiler/src` and `packages/runtime/src`.
Both independent review and the main agent checked these source statements.

A supplementary Bun probe invoked the production `projectRuntimeContract` with
one synthetic normalized Job and two source-graph entries representing
`handler = () => 1` versus `handler = () => 2`. It reported
`jobContractEqual: true` and `executableGraphEqual: false`. This executes the
projector finding only; it does not compile either handler or exercise a worker.

A code-only handler change can preserve its input/output/run-as/retry contract
while changing executable behavior. Conversely, editing the schedule inside
the origin module changes that module's source digest. Splitting `schedule`
out of the normalized contract alone therefore cannot prove safe reuse of an
old accepted run: it would retain the old contract match without proving that
the executing closure is unchanged.

The generated application imports whole authored Definitions and binds their
handlers (`runtime/application.ts`, `runtime/application-bundle.ts`). A handler
can close over module state. Blindly excluding a `schedule` property from source
hashing is unsafe when that closure reads schedule-derived state.

## Implemented repair and remaining proof

The generated application now supplies its verified Runtime Build digest to
the shared durable kernel. Admission filters by that digest before its batch
limit. Claim rechecks the digest under the run lock, preserving semantic-version
and contract checks before creating an attempt. No schema change or alternate
handler loader was added. The expanded PostgreSQL tracer passes with 22
assertions. It includes direct and Mutation-owned delayed Jobs plus a
Mutation-dispatched Reaction. Both Job and Reaction contracts remain equal
across the two builds while their handlers differ. B skips the earlier A
backlog, runs its own Job, and leaves skipped A attempts at zero. A new Runtime
instance loaded from retained A artifacts completes the A-owned Job and
Reaction. This is an instance restart, not a hard-process crash tracer.

This repair uses ADR-0017's existing retained-build operation: an instance
claims only bytes it carries, and pending runs can block old-build retirement.
It does not assume a new historical-handler loader or claim schedule-only edits
preserve executable identity. Its cost is coarse compatibility: even an
unrelated build change can require keeping the prior compatible worker. Delayed
Jobs may extend that retention substantially. The tracer and public deployment
guidance must make this cost visible rather than call refused work recovered.

The separate Policy/Context compatibility decision remains necessary. An old
build creates a fresh Execution using its own compiled Context and Policy,
not the newest deployment's definitions. The public deployment guide states
this distinction and the cost of whole-build retention.

## Required regression slice

### Unpublished candidate cutover

All overlapping workers must enforce this pin. A pre-repair protocol-v8 worker
ignores it and can steal new-build work; the existing v7-to-v8 migration fence
does not distinguish those two v8 implementations. Beta.2 remains unpublished.
Before replacing an old candidate deployment, finish or explicitly cancel its
nonterminal runs, then stop all its Runtimes before accepting work on a repaired
build. Do not overlap old unguarded workers with new ones. Recompiling the old
application with this repair changes its build digest; it does not preserve
the identity of already accepted runs. No automatic row rewrite or digest
override is provided. Running deployments have not been stopped by this task.

If an unguarded candidate must be supported as an externally distributed
release, this operational assumption is insufficient: a detectable compatibility
fence needs a separate decision before release.

### Executed regression matrix

All commands below use repository Bun and process-only PostgreSQL settings.
Tests with shared fixture setup ran sequentially in a newly created disposable
database; its CREATE ownership was checked before exact cleanup. The configured
base database and running preview were preserved.

| Test under `tests/integration/postgres/`         | Result                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `durable-executable-pin.test.ts`                 | 1 passed / 22 assertions: changed Job/Reaction handlers, direct and Mutation acceptance, pre-batch backlog exclusion, retained-build instance restart |
| `pb05-postgres-database-durable-claim.test.ts`   | 1 passed / 28 assertions: scheduling, inspection, claim, heartbeat, rollback, terminal and cancellation owners                                        |
| `beta08-durable-kernel.test.ts`                  | 14 passed / 141 assertions: tenant admission, concurrent claims, crash/lease fencing, retry, cancellation, contract retirement and maintenance        |
| `otel04-protocol-v8-durable-correlation.test.ts` | 4 passed / 32 assertions: existing trace links survive acceptance, retry, reclaim and pruning; no new observability surface                           |
| `team-support-desk.test.ts`                      | 1 passed / 111 assertions: generated/direct/durable/webhook and Firefox journey                                                                       |
| `collaboration-walking-skeleton.test.ts`         | 1 passed / 398 assertions: generated/browser Live Query and durable recovery                                                                          |

Focused unit checks passed 37 tests / 267 assertions, including locked Job and
Reaction build-mismatch refusal and mandatory generated digest wiring. Runtime
and Compiler typechecks passed. Independent Standards and Spec review findings
were repaired: exception-safe owned-database cleanup, historical source-audit
wording, and the retained Policy/Context distinction. Three ordinary Claude
Opus 5 documentation reviews covered facts, prose, and operational examples;
they are not formal acceptance records.

`bun run quality:release` passes after refreshing the exact generated chunk
inventory, artifact digests, and core tarball checksum from compiler and pack
output. The initial full gate found only those three stale expectations; no
assertion or gate was weakened. The final gate also passes packed-package
isolation and CLI telemetry tests, the docs build, and `git diff --check`.
Two subsequent forced builds of `questpie` and `questpie-opentelemetry`, each
followed by `bun run release -- --dry-run`, passed with byte-identical tarballs
across both runs. Nothing was tagged, published, or deployed.

The remaining schedule/checkpoint proof must add old/new concurrent producer
and worker scenarios with its active artifact catalog, explicit missing/tampered
retained artifacts, and operator-visible retirement refusal. Existing worker
tests do not by themselves prove a complete schedule/checkpoint deployment.

The activation model proof is separate. Synthetic tick receipts can falsify
activation races but cannot close this compiler/worker binding defect.
