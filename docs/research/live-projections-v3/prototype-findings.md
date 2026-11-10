# First execution experiment

Executed on 2026-10-22 with Bun 1.4.2 and the existing disposable PostgreSQL 17
fixture. This is research code, not a supported framework feature. It runs the
actual v3 route executor and collection CRUD at
`82fca046befe9cc487962ebdb49efa46e2d9ff09`, creates its own database, and drops
that database in `finally`. No application or production database was used.

Run from this research checkout, with dependencies installed:

```sh
QUESTPIE_MIGRATIONS_SILENT=1 \
QUESTPIE_LIVE_PROTOTYPE_DATABASE_URL=postgresql://postgres:ephemeral@127.0.0.1:32813/ephemeral \
bun packages/questpie/bench/live-projections-prototype.ts
```

Use a disposable local PostgreSQL URL whose role can create databases. The
address above is the parent's temporary fixture, not a service dependency.

The fixture defines task and run collections with tenant-scoped read access,
seeds tenants alpha and beta, and evaluates one route that reads both. A barrier
pauses it after the task read while another transaction updates both records.
The same route is then evaluated inside a read-only repeatable-read transaction.
Finally, a route writes both records and returns a value rejected by its output
schema, first normally and then inside the managed transaction wrapper.

| Case                                                      | Observed result                                  |
| --------------------------------------------------------- | ------------------------------------------------ |
| Ordinary route across concurrent commit                   | Task revision 0, run revision 1                  |
| Same route in a consistent read transaction               | Task revision 0, run revision 0                  |
| Ordinary route rejects output after writes                | Both records remain at revision 1                |
| Same execution validates output before transaction commit | Both records remain at revision 0 after rollback |
| Collection access inside the read transaction             | Only alpha appears; beta remains filtered        |

All four result assertions passed and the process exited successfully. Raw
results are in [prototype-results.json](./prototype-results.json). The fixture
uses [the existing executor](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/questpie/src/server/routes/execute.ts)
and [managed transactions](https://github.com/questpie/questpie/blob/82fca046befe9cc487962ebdb49efa46e2d9ff09/packages/questpie/src/server/collection/crud/shared/transaction.ts);
it adds no framework API.

This supports reusing route execution behind semantic query and command
definitions. Ordinary routes currently promise neither a multi-read snapshot
nor rollback after invalid output; these observations are gaps for the proposed
semantics, not regressions in that existing contract.

This experiment does not establish live refresh, missed-wake recovery,
revocation fencing, adapter parity, command receipt recovery, or throughput.
Repeatable-read alone cannot prevent disclosure after a concurrent authority
revocation. Those remain separate delivery gates. The next useful experiment is
one explicitly dependent route watch that converges after writes during its
initial read, clears data after denial, and recovers after a dropped wake.
