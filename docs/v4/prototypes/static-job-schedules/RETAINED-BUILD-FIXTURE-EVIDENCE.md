# Retained builds in the multi-instance tracers

This repair replaces synthetic version labels in the load, soak and maintenance
fixtures with two complete compiler-built applications. It changes no production
artifact verifier, Runtime compatibility rule, workload count or timing budget.
ADR-0043 remains Proposed. The later
[complete local matrix](./CONTENTION-CANDIDATE-EVIDENCE.md#integrated-reference-local-run)
passes; the failures recorded here remain historical evidence, not erased samples.

## Failure and authority

The first `beta10-ten-instance` invocation on `1da42dafd` failed before its timer
with `SCHEDULE_ARTIFACT_INVALID`. The helper removed `later.jobDigest` from the
current Runtime Build, relabelled it as v4/v5, and recomputed that one artifact's
digest. The current generated schedule artifact still pinned the actual Job
projection. The generated owner supplied the empty Job projection digest when
the removed field was absent, so independent cross-pin verification rejected the
mismatch. The original credential-redacted log remains at
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH/affected-ten-instance.log`.

Accepted ADR-0017 separates schema, wire, Policy/Context, executable and internal
protocol compatibility, and requires workers to carry the executable bytes they
claim. ADR-0033's PostgreSQL v8 cutover and Proposed ADR-0043's v9 cutover do not
permit mixed incompatible database protocols. Runtime Build artifact-version
labels and the PostgreSQL catalog protocol are separate; this repair invents
neither an artifact version nor compatibility between old and new database
catalogs.

## Small fixture repair

The existing fixture compiler now has a retained-source variant. It changes only
the Reaction's returned `deliveryReceipt` to add a `retained:` marker, leaving
the result codec and application writes unchanged. The real compiler produces
every artifact in a separate directory. The second compilation never reapplies
migrations or resets PostgreSQL. It is lazy, cached for the harness lifetime,
and completes before the load/soak timer starts.

The helper requires distinct Runtime Build digests and equal application,
artifact protocol, schema fingerprint, migration, client/wire, Policy and
Context bootstrap bindings. Runtime startup still performs its normal independent
verification. Both complete artifact directories remain available for new
instances until fixture cleanup. No generated JSON, inventory or digest is
rewritten; the old temporary Runtime Build file-swapping code is deleted.

`createRetainedApplication` replaces the synthetic v4 and v5 factories in all
three consumers. The maintenance case still checks Authority nondisclosure,
retry fencing, audit and authorized maintenance across compatible builds. The
ten-instance load retains ten applications, 20 direct roots, 20 network posts,
40 runs and drain assertions. The soak retains 80 runs, four waves, one abandoned
claim, three replacements and its recovery/drain assertions.

The live metric labels are now `retainedBuildInstances` and
`currentBuildInstances`, with the same 1/9 thresholds. The baseline's dated
historical workload labels and measurements remain intact; an explicit
`workloadEvolution` note distinguishes them from the revised fixture. Its old
PASS is not evidence for this change.

## Red, green and remaining gates

The new focused PostgreSQL test was written against the old factory first. It
failed at `SCHEDULE_ARTIFACT_INVALID`, reproducing the reported defect. After the
repair it proves two distinct accepted build identities, current-worker
exclusion of the retained run without consuming an attempt, and completion by
a new Runtime instance loaded from retained artifacts. The returned marker
distinguishes actual executable behavior, not just metadata labels.

Executed commands and retained results:

| Command                                                                                                 | Result                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test tests/integration/postgres/beta10-retained-build-ownership.test.ts` before repair             | FAIL: artifact mismatch; 1 assertion reached                                                                                                   |
| Same focused test after repair                                                                          | PASS: 1 test, 14 assertions                                                                                                                    |
| `bun test tests/integration/postgres/pb05-postgres-database-durable-maintenance.test.ts`                | PASS: 1 test, all 10 assertions retained                                                                                                       |
| `bun run test:load -- --scenario beta10-ten-instance`                                                   | Functional assertions pass; timing FAIL: 16784.693849000003 ms exceeds unchanged 15000 ms                                                      |
| `bun run test:soak -- --scenario beta10-soak-chaos`                                                     | Command PASS: 10049.890165 ms; 80 completed runs, exactly one recovered crash attempt, zero failed runs/drained admissions, three replacements |
| `bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json --noEmit` | PASS                                                                                                                                           |
| Warning-denying lint on the six changed/new TypeScript files                                            | PASS                                                                                                                                           |
| `bun run scripts/performance.ts check`                                                                  | PASS: 19 manifests valid; this does not execute workloads                                                                                      |
| Focused formatting and `git diff --check`                                                               | PASS                                                                                                                                           |

The strict proof project now includes the new test and all three consumers.
That coverage exposed old helper annotations: PostgreSQL connection option
names, missing contextual types on frozen kernel/ledger adapters, and the
network error envelope's `kind` field. Their corrections change no execution.

These runs used Bun 1.3.14 and the existing local PostgreSQL 17 container.
Credentials stayed in process memory. The focused test creates its own
UUID-named database and checks its actual identity before schema work; other
consumer runs used an independently guarded outer UUID database with both
database environment aliases aligned. Owned databases and both generated
fixture directories were cleaned up. No canonical worktree was compiled or
edited.

Credential-redacted diagnostics remain under
`/home/drepkovsky/code/questpie-load-pairs.Q4HQN7`: `retained-red.log`,
`retained-green.log`, `retained-final.log`, `retained-maintenance.log`,
`retained-ten-instance.log` and `retained-soak.log`. They are local provenance,
not portable build prerequisites.

The host was shared and compiler work continued during the consumer checks.
The soak command's local PASS is not tagged stable-runner evidence. The
ten-instance timing failure is retained, alongside the separate
[contention failures](./CONTENTION-CANDIDATE-EVIDENCE.md); neither budget was
raised and no retry was used to replace a failing measurement. The later
[integrated checks](./OWNER-DEADLINE-EVIDENCE.md#final-integrated-candidate-checks)
and complete local matrix pass on the final candidate. They do not convert these
shared-host measurements into tagged stable-runner release evidence. Formal
acceptance and strict release performance evidence remain outstanding.

## Setup-failure cleanup

Independent review found an inherited fixture ownership gap: after the preparer
returned, a rejected generated-module load or later setup step could strand the
prepared artifact directory and any already acquired application/database owner.
The public fixture disposer then re-awaited rejected construction instead of
releasing those resources.

One disposer local to `buildBeta08Durable` now covers successful and failed
construction. It attempts to close every acquired application, then the database
owner, then dispose both prepared builds; one cleanup failure cannot prevent the remaining
cleanup attempts. Cleanup failures remain in an `AggregateError`, following the
testkit convention. When setup also failed, `SuppressedError` retains the exact
original setup error and the cleanup aggregate, following the Runtime Service
disposal convention. Repeated public fixture disposal after rejected setup is
benign because construction already performed and reported cleanup.

`bun test tests/unit/beta08-fixture-cleanup.test.ts` first failed all five cases,
then passed all five with 10 outer assertions. The cases fail generated loading,
application creation, database acquisition, or Principal creation after database
acquisition; the final case additionally fails all three cleanup operations and
checks every retained error. Temporary artifact directories are real and their
removal is asserted before the test runner's own cleanup.

The tests substitute the preparer and acquired application/database handles in
isolated Bun children. This is explicit fault injection at the test-helper
boundary, not compiler, application startup or PostgreSQL engine evidence. It
adds no production injection API, generic cleanup utility or dependency on an
external database. The ordinary strict proof typecheck, scoped warning-denying
lint, formatting and diff check pass. No real-fixture compilation or PostgreSQL
rerun was performed for this follow-up while the integration gate was active.

Review also required explicit ownership of the fault-test subprocesses. A
test-local collector now bounds their streams and exit with a two-second
deadline, kills a still-running child with `SIGKILL`, and awaits exit before
temporary-file removal. If termination itself fails, it preserves the original
failure with `SuppressedError`. No production or shared process helper was added.
A sixth test starts a real child whose imported module records entry and then
stalls indefinitely. The unbounded collector failed its independent one-second
guard; the bounded collector passes a 50 ms deadline probe, verifies signal and
exit, and verifies the PID is gone before teardown. The guard is failure-only
and kills the child during cleanup on a regression. The final compile-free suite
passes six tests with 14 outer assertions; the five fixture-failure cases remain
unchanged.
