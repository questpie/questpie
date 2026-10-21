# Graphile Worker adapter: contract and measurements

## Dependency evidence

`npm view graphile-worker version engines dist-tags --json` returned 0.18.0 and
Node >=22.18.0. The installed 0.18.0 distribution was inspected before coding:
`dist/worker.js`, `dist/main.js`, `dist/localQueue.js`, `dist/sql/getJobs.js`,
`dist/sql/failJobs.js`, `dist/sql/resetLockedAt.js`, `dist/workerUtils.js`, the
public interfaces and generated SQL.

Upstream references: [requirements](https://worker.graphile.org/docs/requirements),
[configuration](https://worker.graphile.org/docs/config),
[connections](https://worker.graphile.org/docs/connection-string),
[job keys](https://worker.graphile.org/docs/job-key),
[cron](https://worker.graphile.org/docs/cron).

The runtime uses one `runTaskList` pool and local fetch buffer. Per-name permits
bound handlers, while `concurrentJobs` bounds the runner. The optional separate
runner URL is direct/session pooled and carries LISTEN and execution queries;
the publisher URL may be transaction pooled. A single URL shares one pool.

## Execution leases and retries

Graphile 0.18.0's stale-lock reset is fixed at four hours. Its
`force_unlock_workers(worker_ids)` clears locks on every job and named queue
whose `locked_by` matches a pool ID. It cannot safely expire one short job while
preserving unrelated long jobs in that runner.

The adapter therefore owns a logical dispatch ledger. Publication, physical
`add_job` admission and ledger updates share a transaction. Each physical job
has one native attempt; the ledger owns retries, backoff and expiry. Handler
claiming writes a token and deadline. Timeout aborts the handler through
`AbortSignal`; a token-checked completion or failure settles only that attempt.
A retry creates a different physical ID. Late Graphile settlement can only
remove the old row. The lease sweep also handles a worker that died after
fetching, while its task was waiting for a per-name permit. Reclaiming a fetched
transport does not count as a handler failure: the same wait can occur in a
healthy process. A real-PostgreSQL regression holds one per-name permit beyond
another fetched job's expiry and proves that `retryLimit: 0` still executes it
once after the permit becomes available.

`remove_job` retires the old key without unlocking sibling jobs. After a dead
process, the retired transport row may remain locked until native cleanup, but
the logical retry is runnable independently. `complete_jobs` cleans retired
rows once unlocked. Runtime recovery uses public Graphile SQL functions rather
than modifying its private tables.

Framework secret execution claims use a lease no longer than the adapter's
lease. Timeout stops the handler wait and heartbeat, releases its claim, and
leaves erasure to durable execution reconciliation. A pending relay acceptance
or busy execution claim defers without spending a handler retry. Non-secret
transactional publication uses Drizzle `execute(SQL)` and bound text-to-JSON
casts; real postgres-js commit/rollback tests exercise it.

Adversarial probes exposed four gaps that the initial happy-path suite missed:
external broker terminalization was treated as retryable transport loss; blocked
scope disposal kept a secret claim alive after expiry; a delayed JavaScript timer
allowed a success past the database deadline; and failed initial recovery left
an orphan runner. The adapter now treats missing, detached-key and permanently
failed current broker jobs as terminal. Adapter-owned rotation atomically points
the ledger at the next physical ID, so it never resembles external removal.

Secret claim admission, renewal and completion lock the receipt before checking
database wall-clock time. Completion requires the current token. Renewal is
capped at the adapter's absolute deadline and cannot revive an expired claim.
An abort listener ends the heartbeat and releases ownership independently of a
blocked request-scope disposer. Adapter settlement checks database time after
acquiring its own row lock. Failed listener initialization drains its runner and
closes a separate pool before another listen is allowed; stop waits for ongoing
initialization. Real-PostgreSQL regressions cover all four probes plus deadline
checks after a row-lock wait.
The lock CTE relies on PostgreSQL's rejection of row-locking SELECTs from CTE
inlining, present in the [PostgreSQL 12 planner](https://github.com/postgres/postgres/blob/REL_12_STABLE/src/backend/optimizer/plan/subselect.c).

## Local comparison

The checked-in runner is `packages/questpie/bench/queue-graphile.ts`:

```sh
QUESTPIE_GRAPHILE_POSTGRES_URL=postgres://... bun packages/questpie/bench/queue-graphile.ts
```

Use a disposable PostgreSQL with `shared_preload_libraries=pg_stat_statements`.
The run used PostgreSQL 17.11, Bun 1.3.13, pg-boss 12.26.3 in its default polling
mode, and Graphile Worker 0.18.0. Both adapters had 79 job names, teamSize 5 and
maxPoolSize/max 50. Graphile had concurrentJobs 395, so the idle comparison does
not reduce its worker count. Idle windows were ten seconds. Counts include
schema-referencing broker/adapter statements, including lease recovery, rather
than only fetch statements. Pickup includes publication and commit; each
adapter had ten sequential samples.

| Measurement           |   pg-boss | Graphile Worker |
| --------------------- | --------: | --------------: |
| Idle SQL statements   |      2036 |              20 |
| Idle SQL statements/s |   203.542 |           2.000 |
| Pickup p50            | 1689.7 ms |         96.9 ms |
| Pickup p95 / max      | 6206.7 ms |        350.5 ms |

Idle statement count fell 99.0%. The host was under concurrent development
load; ten samples do not establish a production latency SLO. An earlier run
before adding the expiry lease sweep measured 1.10 idle statements/s; that is
not the final adapter's cost. The comparison uses the installed pg-boss, not a
fresh measurement of Autopilot's published 3.35.7 deployment. A separate test
sets recovery polling to 60 seconds and proves immediate LISTEN-driven pickup.
