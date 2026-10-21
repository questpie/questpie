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
uses native retries only for infrastructure failures; the ledger owns handler
retries, backoff and expiry. Handler
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

A second adversarial pass reproduced three additional races. Native attempts
now have a 32767-attempt ceiling, preserving transient admission/settlement
errors independently of handler attempts while keeping public permanent-failure
operations terminal. Admission and settlement check the current broker state;
retry admission requires a successful public `remove_job` result in the same
transaction. Concurrent administrative removal therefore cannot be hidden by
the next logical generation. Native `job:error` events reach error listeners.
Admission/settlement lock the current `_private_jobs` row with SELECT FOR UPDATE
without modifying it; the public `jobs` view has an outer join and cannot supply
that lock. This is deliberately tied to the installed 0.18.0 package. Its startup
guard checks the package version, not the exact database migration revision. A
regression holds public removal uncommitted and proves fetched admission waits
for cancellation to commit rather than using its old snapshot.

Adapter terminal receipt retention now starts at admission, before framework
hand-off/completion retention. Enqueue atomically deletes expired terminal
receipts before attempting insertion, retiring a remaining native key even if
Graphile retains its failed transport. Framework receipts prevent replay during
their own longer retention window, including after adapter cleanup. Tests cover
both cleanup orderings for ordinary and encrypted jobs.

Per-name admission no longer waits inside every Graphile slot. An enumerable
TaskList view omits saturated names from the next shared fetch while keeping
their handler functions addressable for buffered work. A reserved idle task
keeps Graphile's supported list nonempty. Buffered excess framework work rotates
without spending an attempt; public `WorkerPool.nudge` wakes fetch on permit
release. A regression holds one name blocked and proves another progresses
before release, with a 60-second fallback poll. Graphile 0.18's `forbiddenFlags`
path bypasses its shared buffer even for an empty array, so it is deliberately
unused. This behavior was checked in installed `localQueue.js`/`worker.js`.

Graphile 0.18 also throws when its quiescent WAITING buffer returns jobs during
release. Shutdown first exposes only the idle task, drains buffered framework
jobs back to pending without executing them, then invokes graceful shutdown
after the public local-queue mode event reports an empty buffer. A real-PG test
proves buffered work survives stop/restart with `retryLimit: 0`.

A further independent pass reproduced cancellation during lease recovery,
a rejected task-discovery promise cached indefinitely, and a receipt-lifetime
collision for a job delayed beyond framework retention. Recovery now locks
the native row and rechecks terminal state after that lock, matching admission
and settlement. A public permanent-failure transaction held uncommitted is
covered by a real database regression; recovery must not create a successor.

Installed `dist/taskIdentifiers.js` caches its task lookup by the JSON list of
enumerable task names before the lookup succeeds. Installed `localQueue.js`
logs fetch failures without a corresponding worker event. The public Logger
now forwards these errors and changes the enumeration order of the same task
names, making the next shared fetch retry discovery. Two reserved idle names
allow that change even when all real names are saturated. It does not disable
the shared buffer, patch Graphile internals or restart the pool. A real table
lock and runner lock timeout prove error reporting and recovery without restart.

Graphile advertises `uniqueDispatchIds` to the framework: each prospective
publication gets a fresh identity before secret encryption and reservation.
The framework's unique job/key constraint returns the retained ID on replay;
relay retries continue using that persisted identity. After a receipt is pruned,
its next lifetime gets a distinct ID even while the previous delayed work is
still pending. The old job is neither deleted nor mistaken for the new payload.
Real postgres-js tests cover both ordinary and secret replacement publications,
and prove the new immediate job and old delayed job each execute their payload.

Another adversarial probe distinguished a handler error from a database error
persisting its outcome. The wrapper now catches only handler execution errors;
completion/deferral persistence retries its original outcome under the same
token until the lease ends, reporting infrastructure errors. Deadline checks
and public administrative cancellation remain authoritative on every retry.

Secret admission has a durable `handler_started` marker. Fetching and acquiring
a per-name permit do not spend a secret handler attempt: the framework calls
the optional `beginExecution` hook only after acquiring its execution claim.
That hook commits the start marker and attempt count before decryption/user
code. Recovery defers an expired unstarted admission without an attempt refund
or decrement; started attempts retain normal failure/expiry retry accounting.
This also covers a process dying before a busy claim can call `defer()`.
Real PostgreSQL regressions exercise successful-completion lock contention,
busy-secret deferral contention before and beyond expiry, and SIGKILL of a real
framework consumer blocked on its execution claim. They require the accepted
secret to survive and execute with `retryLimit: 0` after the prior claim clears.

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
| Idle SQL statements   |      1981 |              21 |
| Idle SQL statements/s |   198.048 |           2.100 |
| Pickup p50            | 1121.5 ms |          7.4 ms |
| Pickup p95 / max      | 2004.9 ms |         11.3 ms |

Idle statement count fell 98.9%. This run includes the transport-retry,
receipt-lifetime, task-discovery and capacity-admission fixes. The host was under concurrent
development load; ten samples do not establish a production latency SLO. An earlier run
before adding the expiry lease sweep measured 1.10 idle statements/s; that is
not the final adapter's cost. The comparison uses the installed pg-boss, not a
fresh measurement of Autopilot's published 3.35.7 deployment. A separate test
sets recovery polling to 60 seconds and proves immediate LISTEN-driven pickup.
An earlier ten-sample run had pg-boss p50 16.9 ms and p95 2004.0 ms, illustrating
how a small sequential sample can align with the poll phase; these measurements
do not imply a stable production median.
