# Static schedule and checkpoint owner deadlines

ADR-0043 remains Proposed. The initial focused runs established executable
transaction-time evidence. The later integrated regression remains qualified
below; these tests provide neither formal acceptance nor a throughput claim.

The real PostgreSQL transaction runner receives the owner's existing control
signal. A test adapter first executes the selected production statement, then
waits for a PostgreSQL advisory lock inside that same transaction. Another
connection retains the conflicting lock until the test has observed owner
deadline failure and transaction cleanup. No caller abort signal is supplied.

| Owner boundary                            | Built-in deadline | Observed rollback and recovery                                                                                                                                          |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation, after its receipt INSERT      | 10 seconds        | Catalog, activation receipt, head and frontier match their pre-call state.                                                                                              |
| Reconciliation, after its frontier UPDATE | 10 seconds        | Frontier is unchanged; accepted Job, acceptance record and tick are absent. The next ordinary reconciliation accepts one Job.                                           |
| Checkpoint load, after its history SELECT | 5 seconds         | The fenced transaction ends and history remains empty. Load has no history write to roll back.                                                                          |
| Checkpoint reservation, after its INSERT  | 5 seconds         | No reservation survives; the ordinary store can reserve the command afterward.                                                                                          |
| Checkpoint completion, after its UPDATE   | 5 seconds         | History remains reserved with no receipt binding; one business write and the exact committed Mutation receipt bytes survive. Ordinary completion subsequently succeeds. |

Every case verifies the observed PostgreSQL lock waiter, the classified
`cancelled` error with the owner's `TimeoutError` cause, and absence of the
transaction's backend/XID before releasing the blocking connection. The tests
use 30-second PostgreSQL statement, lock and idle controls so an earlier driver
timeout cannot substitute for the 5-second or 10-second owner deadline. No
production limit changes.

The independent test guard expires 2.5 seconds after the required deadline. It
fails the test and releases the blocker only for cleanup; its expiry is never
accepted as evidence of owner cancellation.

## Negative controls

Before the green run, local uncommitted mutations changed the owner deadlines
to 60 seconds:

- Disabling activation's 10-second deadline failed at the 12.5-second guard.
- Restoring activation but disabling reconciliation's separate 10-second
  deadline failed at its 12.5-second guard after activation's check passed.
- Disabling the shared checkpoint control's 5-second deadline failed at the
  7.5-second guard during load.

All three failures reported `owner deadline did not expire before the test
guard`. Cleanup joined the released transaction. The production mutations were
then restored; no deadline change is part of this candidate.

Initial checkpoint setup attempts exposed environment alias precedence and
early `pg` import initialization during generated compilation. Those setup
failures are excluded from deadline evidence. The harness pins its Bun SQL
database and aligns/restores both database environment names; the lock helper
loads `pg` after generated compilation. Each test verifies its UUID-owned
database identity before schema preparation and drops only that database.

## Verification

With PostgreSQL 17 connection settings supplied only through the process
environment, and both database environment names initially selecting the
administrative connection:

```sh
bun test tests/integration/postgres/static-schedule-runtime.test.ts tests/integration/postgres/static-job-checkpoint-recovery.test.ts --test-name-pattern 'owner deadlines'
bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json --noEmit
bun run lint --deny-warnings tests/integration/postgres/helpers/owner-deadline.ts tests/integration/postgres/static-schedule-runtime.test.ts tests/integration/postgres/static-job-checkpoint-recovery.test.ts
bun run format:check tests/integration/postgres/helpers/owner-deadline.ts tests/integration/postgres/static-schedule-runtime.test.ts tests/integration/postgres/static-job-checkpoint-recovery.test.ts docs/v4/prototypes/static-job-schedules/OWNER-DEADLINE-EVIDENCE.md
git diff --check
```

The deadline tests pass with 2 tests, 42 assertions and no selected skips.
The focused proof TypeScript project, warning-denying lint, formatting and
whitespace checks pass. Credentials are not recorded in commands or artifacts.

## Integrated regression qualification

The complete PostgreSQL lane on candidate `6c673e931` failed when `static schedule
owner deadlines roll back activation and accepted ticks` reached its unchanged
60-second test timeout at 60,000.20 ms. The file recorded 90 assertions: 81 from
the preceding three tests and nine deadline-setup assertions, before the first
activation outcome assertion. That count does not identify the stalled phase
or establish whether owner cancellation, observation, or cleanup stalled.

Separate diagnostics added temporary test/helper phase tracing without changing
production code. The deadline case passed with one test and 23 assertions;
the whole file passed with four tests and 104 assertions. Both observed owner
cancellation, blocker closure, pending-transaction settlement and cleanup. A
negative control withheld the owner signal from the PostgreSQL runner and
correctly failed with `owner deadline did not expire before the test guard`
after 12,504 ms. Blocker closure then took 10 ms and pending drain took 2 ms.
These diagnostics did not reproduce the original stall and establish no cause
or repair for it. Temporary instrumentation was removed.

The separate three-file tail passed 15 tests and 242 assertions across lifecycle
transactions, Team Support Desk and its static sweep. It does not replace the
failed complete lane. Production 10-second owner bounds, 30-second PostgreSQL controls, the
12.5-second test guard and the 60-second outer test timeout remain unchanged.

A second full PostgreSQL run on the same candidate failed earlier in
`beta06-publish-mutation.test.ts`. The Membership-after-Channel-lock case failed
after 7,553.11 ms with `AbortError: caller cancelled`; a secondary unhandled
error reported that `collaboration.message_events` did not exist. The file
finished with four passes, one failure, one error and 34 assertions. This run
never reached the schedule deadline file. The log alone established no cause.
The coordinating agent reports that the schedule-state observer started after
the run had already failed, closed with `observed: false`, and made no database
mutation. Both full-run outer databases were removed and cleanup verified.

Subsequent test-first diagnosis reproduced the naked caller `AbortError` by
waiting for actual server-request settlement and one event-loop turn before
the old client rejection assertion. The repair observes client and server
outcomes immediately and joins them before atomic-count assertions and teardown.
The test still checks Membership revocation after the exact owned Channel lock,
`CHANNEL_UNAVAILABLE`/404, caller cancellation and zero atomic records. Its
retained settlement gap now passes; the complete file passes five tests and
35 assertions without changed limits or production code. Independent Standards
and Spec reviews found no issues. A temporary observer-failure control produced
only its intended failure; joined cancellation counts were zero and the next
schema-reset case passed without an unhandled error. All owned databases were
removed. Logs and the removed control are retained under
`/home/drepkovsky/code/questpie-v4-beta06-settlement-proof.w0eBGY`.
This repairs the second failure, not the unexplained schedule stall. Complete
lane evidence is recorded separately below.

The same candidate's `quality:release` completed: the ordinary suite reported
1,107 passes, 195 gated skips and zero failures; React reported three passes and
15 assertions; packed OTel05 reported one pass and 2,333 assertions; packed
OTel06 reported one pass and 24 assertions. Its 19 performance manifests were
validated, not executed. This quality result does not close the PostgreSQL or
affected load gates, and ADR-0043 remains Proposed.

Two subsequent forced builds of both public packages, each followed by
`bun run release -- --dry-run`, passed on that same candidate. Both runs matched
the committed package artifact manifest and produced identical archive hashes
for `questpie` and `questpie-opentelemetry`. Their isolated import, negative
import, peer, optional React, packed application and combined-import checks
passed. These package checks do not close either PostgreSQL failure.

All nine diagnostic databases were removed. The coordinating agent separately
removed the original inactive orphan `qp_schedule_d1cc8707f8cb42cda52568f5593232ad`
after matching its sole activation at `12:36:35.601Z` to the original timeout at
`12:37:35.941Z` and confirming it belonged to that run rather than another active
agent. This cleanup removed disposable test data; rerunning the test recreates
its fixture.

Local provenance is retained in
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH/quality-release-6c673e931.log`
and `full-postgres-6c673e931.log` plus
`full-postgres-6c673e931-observed.log` in that directory. The forced-build and
release dry-run logs in the same directory use suffixes `6c673e931-1` and
`6c673e931-2`. Diagnostic provenance is retained in
`/home/drepkovsky/code/questpie-load-pairs.Q4HQN7/owner-deadline-diagnosis.json`
and its three named diagnostic logs; and
`/home/drepkovsky/code/questpie-v4-team-tail-proof.D0O50E` for the three tail logs.
These paths document local evidence, not portable build prerequisites. The
original failure remains retained and its cause remains unexplained.

## Final integrated candidate checks

Candidate `fcf2adeeb` passes `bun run quality:release`: 1,107 ordinary passes,
195 gated skips and zero failures; React passes three tests with 15 assertions;
packed OTel05 and OTel06 pass with 2,333 and 24 assertions respectively. The 19
performance manifests were validated only. A separate complete
`bun run test:postgres` passes 185 tests with 1,983 assertions across all 44
registered roots. Its four environment skips are three PostgreSQL-18-only
catalog cases and one PgBouncer case. The schedule deadline file passes all
four tests with 104 assertions; no required schedule/checkpoint case is skipped.
This complete PASS does not explain or erase the earlier 60-second stall.

The exact focused TypeScript command in Verification also passes on this
candidate. Its log is empty; the coordinating agent recorded exit zero. The
[complete affected load/soak matrix](./CONTENTION-CANDIDATE-EVIDENCE.md#integrated-reference-local-run)
passes separately as `reference-local` evidence. Workload counts, timing budgets,
production owner deadlines and test guards remain unchanged.

Two forced builds of `questpie` and `questpie-opentelemetry`, each followed by
`bun run release -- --dry-run`, also pass on the same clean candidate. Both
dry-run logs are byte-identical, including archive hashes and isolated import,
negative import, peer, optional React, packed application and exact-two-package
combined-import checks. Their local logs use `forced-build-fcf2adeeb-1/2.log`
and `release-dry-run-fcf2adeeb-1/2.log` in the verification directory below.

Local logs are `quality-release-fcf2adeeb.log` and `proof-types-fcf2adeeb.log`
under `/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH`, and
`/home/drepkovsky/code/questpie-v4-full-postgres-fcf2.vJijOB/full-postgres.log`.
These are local provenance, not portable build prerequisites. ADR-0043 remains
Proposed. Formal review and verified public projection remain pending; tagged
stable-runner release evidence and manual preview are separate outstanding work.
