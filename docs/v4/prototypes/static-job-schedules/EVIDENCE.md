# Static schedule activation evidence

The candidate Runtime owner now covers the activation model's guarantees through
the [PostgreSQL tracer](../../../../tests/integration/postgres/static-schedule-runtime.test.ts).
The duplicate `activation.ts` and `activation.test.ts` model files were deleted;
Git preserves them and the historical results below. This deletion does not
accept ADR-0043 or project product authority.

## Current Runtime-owner coverage

The tracer runs the actual `pg` transaction owner, v9 protocol, verified schedule
catalog, calendar evaluator, ordinary Execution, and Job acceptance owner. Its
controlled state changes and transaction faults affect only its UUID-owned test
database. There is no synthetic tick table or caller-selected tick minute.

| Former model guarantee                            | Current executable evidence                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Absent activation and activation-minute exclusion | Reconciliation creates no head or run before activation; a newly activated schedule accepts no current-minute run.                             |
| Competing first activation                        | Ten distinct desired sets race from revision zero: one winner, nine stale failures, one stored activation, exact winning replay.               |
| Response loss and ABA                             | Exact historical receipt replay returns the newer current head after removal/re-addition; a previously unsuccessful stale request stays stale. |
| Revision overflow                                 | Maximum PostgreSQL bigint revision rejects the next activation.                                                                                |
| Concurrent ticks and frontier bounds              | Ten producers accept one real Job/tick; a future frontier cannot regress or produce old work.                                                  |
| Frontier transfer                                 | An adjacent unchanged program retains its frontier; changed and removed/re-added programs reset to the activation minute.                      |
| Removal race                                      | Both shared-lock orders are controlled: accepted work survives removal; removal-first suppresses pending work.                                 |
| Atomic rollback                                   | Faults after real Job acceptance, after the frontier UPDATE, and during activation roll back their writes.                                     |
| Cancellation while blocked                        | PostgreSQL reports an observed head-lock waiter; cancellation settles before blocker release and leaves ticks/frontier unchanged.              |

Blocked-statement cancellation uses the existing classified
`QuestpiePostgresError` with code `cancelled` and the caller's reason as its cause.
The old model returned the bare reason; that model-specific error shape was not
a producer contract. No public `inspect` capability was carried across: settled
test assertions read only this test's database.

Executed with Bun 1.3.14 and PostgreSQL 17, with connection settings supplied
only through the process environment:

```sh
bun test tests/integration/postgres/static-schedule-runtime.test.ts
```

Result: 1 passed, 0 failed, 69 assertions, no skips (2.70 seconds on the final
local run). The strict proof TypeScript project now includes this Runtime
tracer; types, warning-denying lint, focused formatting and `git diff --check`
pass. Adding that type coverage exposed and repaired two old test-fixture
mistakes: bootstrap now supplies `get`, and the acceptance codec descriptor is
decoded from the existing Context codec rather than asserted to have another type.
The tracer closes its Runtime, Pool, SQL and lock clients, restores the process
database setting, then drops only the database whose CREATE it owns. The shared
PostgreSQL container and other application databases remain untouched.

This is Runtime-owner evidence, not generated worker/CLI or browser evidence;
those remain separate tracers. It establishes no throughput or fairness claim.

## Maximum reconciliation work

A separate case now activates 64 distinct, sorted, correctly digested schedule
programs through the actual Runtime artifact verifier and PostgreSQL owner. With
all owned frontiers three minutes behind, one reconciliation reports exactly 64
examined and 64 accepted. PostgreSQL contains one tick for each Job, 64 distinct
run IDs, 64 ordinary Job acceptances and 64 frontiers. Every tick belongs to the
latest observed minute; missed minutes do not multiply acceptance.

The replay executes every real PostgreSQL statement through the normal owner
transaction. A test-local clock adapter retains the first reconciliation's
actual PostgreSQL observation and supplies it again for replay, so a wall-minute
boundary cannot change the intended same-minute case. Replay reports 64 examined
and zero accepted; tick identities, run/acceptance counts and the 64 Context
resolutions remain unchanged. No production clock or deadline is changed.

The negative case supplies a correctly digested 65-program catalog to the same
owner constructor. It rejects with `SCHEDULE_ARTIFACT_INVALID` before any
transaction or Context call. This is verified Runtime-owner coverage, not an
additional generated-authoring proof or performance measurement. The 64-program
case passed the existing implementation; no behavioral RED or production repair
is claimed.

On Bun 1.3.14 and PostgreSQL 17, the focused `64 verified programs` selection
passes one test with 150 assertions. The complete command above passes five
tests with 254 assertions, zero failures and no skips in 28.12 seconds. The
focused proof TypeScript command
`bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json --noEmit`,
warning-denying lint, formatting and `git diff --check` pass. Existing tests and
production work/time bounds remain unchanged.

Local logs remain in
`/home/drepkovsky/code/questpie-v4-reconciliation-cap-proof.BhwKfG`:
`focused-corrected-connection.log`, `full-runtime.log` and `types-final.log`.
The initial `focused.log` records an authentication setup failure before database
creation: the absent container `POSTGRES_USER` setting selected the OS username;
the corrected invocation explicitly selects the default `postgres` role.
Credentials stayed in process memory. Successful runs completed the existing
UUID-owned database cleanup. These logs are local provenance, not portable
prerequisites. ADR-0043 remains Proposed; the prior integrated gate evidence is
not relabelled as rerun for this test-only addition.

## Historical model

This PostgreSQL model tests the activation concurrency rules proposed in
ADR-0043. It is not a production scheduler or an acceptance record. The
authoritative candidate is `docs/adr/0043-freeze-static-job-schedules-and-mutation-checkpoints.md`
on `feat/v4`; this isolated proof worktree started from `338ac552b`.

### Executed checks

On PostgreSQL 17 and Bun 1.3.14, with PostgreSQL connection settings supplied
only through the process environment:

```sh
bun test docs/v4/prototypes/static-job-schedules/activation.test.ts
```

Result: 11 passed, 0 failed, 45 assertions. The final repeated run completed
in 290 ms; this is a local test duration, not a performance budget.

The tests cover competing first activations, receipt replay before CAS,
A-to-B-to-A activation, bigint revision overflow, concurrent tick producers,
adjacent-program frontier transfer, removal/re-addition, both removal/producer
lock orders, transactional rollback, and an abort observed after a lock wait.
Activation-containing minutes and new ticks behind an existing frontier were
first demonstrated failing, then repaired and rerun successfully.

The standalone TypeScript project extends the repository base configuration.
It passed the installed TypeScript compiler with the canonical worktree's
`node_modules/@types` as its type root. The installed repository oxlint passed
both source files when invoked with this worktree as its working directory.
`git diff --check` passed. No dependencies were installed for these checks.

An independent read-only Spec review found no contradiction within the
synthetic concurrency/ABA/frontier model. It did not perform formal acceptance.

### What the model could not establish

`produce` receives a caller-selected minute. There is no cron evaluator,
latest-match search, or no-match frontier advancement. `accepted_ticks` is a
synthetic receipt table, not the existing durable Job acceptance kernel.
Principal, Context, input validation, verified artifact catalogs, executable
pinning, Mutation checkpoints, and real Job retry/recovery remain separate
proof obligations. Digest strings in this model do not establish artifact
integrity.

The model uses Bun SQL, not the production `pg` transaction owner. Abort checks
are cooperative; they do not cancel a blocked PostgreSQL statement. The
lock-order test controls waiter arrival but establishes no PostgreSQL fairness
guarantee. `inspect` is settled-state test observation, not a public coherent
snapshot unless its caller supplies a snapshot transaction.

### Resource cleanup and construction incidents

Each historical run created a UUID-named schema with create-only SQL. Cleanup was
allowed only after that run's CREATE succeeds, and closes its SQL clients.
Tests backdate only their own synthetic program rows. The existing PostgreSQL
container and application schemas are not cleanup targets.

The initial construction used a fixed schema name,
`qp_static_schedule_activation_proof`, with a startup DROP. Its absence before
the first invocation was not established; therefore absence of preexisting
data loss cannot be claimed. This was disclosed to the user and the unsafe
startup cleanup was removed.

A later cancellation test deadlocked in its assertion harness before releasing
its blocker. The exact test process was terminated, and its owned schema
`qp_schedule_proof_c1bfb5e246884e39b61d77d517689b6b` was identified from its
pending cleanup statement and removed explicitly. The harness now captures
the outcome with an ordinary promise before releasing the blocker. Subsequent
complete runs cleaned up normally. These generated test tables can be recreated
by rerunning the test; they held no application data.
