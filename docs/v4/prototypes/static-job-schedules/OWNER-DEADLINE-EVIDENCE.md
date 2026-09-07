# Static schedule and checkpoint owner deadlines

ADR-0043 remains Proposed. These tests close its executable transaction-time
qualification; they do not provide formal acceptance or a throughput claim.

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
