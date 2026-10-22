# Realistic SaaS load experiment

2026-10-22. This is a synthetic B2B workload shaped by Autopilot's S8 requirements,
not an Autopilot end-to-end capacity claim. It supplements the controlled
50-cursor/ten-page comparison in the parent report.

## Workload and measurement boundary

Two independent Bun HTTP server processes receive actual TCP POSTs and SSE
streams from a third process. PostgreSQL 17 runs on disk-backed Docker overlay
storage with fsync and synchronous commit enabled, constrained to two CPUs and
1 GiB RAM (128 MiB shared buffers). The shared host has a Ryzen 5600G and 32 GiB
RAM; raw artifacts include host load and process CPU/RSS. Container limits do
not isolate it from host storage stalls or other host workloads.

The fixture seeds 20 tenants, 2,000 actors, 100,000 tasks with 1 KiB bodies,
100,000 pages, sessions, memberships, role bindings and page ancestry. Every
fresh authorization resolves the session and current RBAC scope in SQL and
checks page ancestry; access results are not cached. These are representative
queries, not copies of Autopilot's production ACL implementation.

Each user opens one shared SSE stream carrying page awareness and a durable
activity channel. Ten percent also subscribe to an existing collection live
query, deliberately concentrating projection work in two tenants. Twenty
percent publish cursors at 10 Hz. Profiles offer 20/50/100 CRUD writes per second
at 50/250/1,000 users, the same base HTTP list-read rates, and further authorized
refetches after durable invalidations. Each fifth save per tenant emits an
ordered `list.changed` event. Five percent of readers pause 500 ms between
chunks; their delivery latency is reported separately.

A fault profile revokes one actor, disconnects ten percent of streams and kills
and replaces a server process. The generator retries transport failures, records
reconnects, and checks tenant/page isolation and final sequence coverage. The
final generator uses the public client's 1 s exponential retry range (capped
at 30 s, jittered, reset by heartbeat); older diagnostic generators retried every
100 ms, so their fault/overload figures are not a controlled recovery comparison. The
framework public client's recovery is tested independently in the HTTP/client
regression suite. Server-side frames and byte counters are not browser-render
latency measurements.

The input window is 30 seconds per profile, followed by pending POST completion
and a one-second delivery tail. NOTIFY/s uses the recorded elapsed denominator.
Latency samples are received frames, so read them with offered/accepted POSTs,
skips, stream closes and final-sequence coverage. Skipped requests mean the
per-actor POST was still in flight or the generator's pending bound was reached;
`missedTicks` separately records scheduling delay in the final runner. Older
artifacts combine these in `skipped`. Overload is not a successful capacity run.

Bun defaults to 256 simultaneous fetches. Long SSE streams consume that budget.
Initial diagnostic attempts that hit exactly 256 streams were a generator
limit and are excluded from capacity evidence. The runner now requires
`BUN_CONFIG_MAX_HTTP_REQUESTS=4096`. See the
[Bun fetch connection-limit contract](https://bun.sh/docs/runtime/networking/fetch#simultaneous-connection-limit).

## Historical investigation

The first formal runs used `da944` and an untuned projection query. All profiles
reported zero tenant/page leaks and zero presence rows. The 1,000-user run failed
the intended latency/continuity target; it is retained rather than hidden.

| Profile                 | Fast cursor p95 / p99 | Save p95 | Skipped input | Stream closes                       | Latest sequences |
| ----------------------- | --------------------- | -------- | ------------- | ----------------------------------- | ---------------- |
| 50 users / 20 pages     | 38 / 128 ms           | 2249 ms  | 0             | 0                                   | 24 / 24          |
| 250 users / 40 pages    | 1256 / 1507 ms        | 907 ms   | 11611         | 0                                   | 302 / 302        |
| 1,000 users / 100 pages | 6121 / 7098 ms        | 4523 ms  | 57702         | 363                                 | 1179 / 1900      |
| 250 users with failures | 1299 / 1473 ms        | 880 ms   | 10102         | 197 incl. injected failures/retries | 294 / 295        |

[Baseline artifact](saas-baseline.json) records all denominators, SQL counters,
wait samples and response statuses. Save-tail storage stalls affect the small
profile too; do not infer that 250 users inherently write faster than 50.

Projection COUNT/SELECT work dominated an early 250-user run. Explicit equivalent
output sharing (`accessCacheKey` by tenant/space in this fixture), selecting only
list columns, covering indexes and dependency statistics for correlated tenant
and space columns removed that bottleneck. A partial index experiment made
planning worse: the planner chose thousands of heap fetches and a sort for a
20-row list. Correcting both the covering list index and correlated-column
statistics was necessary. These are application schema/query changes in the
fixture, not automatic framework indexes or unconditional cross-user sharing.

With corrected projections on the old runtime, the 250-user no-cursor control
had save p95 43 ms, no skips and no closes. Adding awareness raised cursor p95 to
827 ms and save p95 to 610 ms with 10,131 skips; 1,000 users still overloaded.
[Projection-tuned artifact](saas-projection-tuned.json) shows the remaining
session/RBAC, ancestry and durable fence costs.

A later diagnostic with the lifecycle/packing fixes and named prepared ACL
statements admitted 250 users with no closes and full final-sequence coverage:
cursor p95/p99 281/450 ms, save p95 313 ms, and 1,440 skipped cursor POSTs out of
15,000 offered. This is not a controlled isolation of the prepared-plan change;
the final paired run uses the same runtime on both sides. Prepared statements
cache plans per connection and still read current access data on each call;
they do not cache a successful authorization. See the
[node-postgres prepared-query contract](https://node-postgres.com/features/queries#prepared-statements)
and [diagnostic artifact](saas-prepared-diagnostic.json).

## Common optimizations and the lease failure

The next paired runs use the same lifecycle fixes, linear packet packing and
common realtime optimizations on both sides. Only named prepared ACL statements
differ. They are sequential runs on shared hardware, so the comparison does not
isolate database planning from storage/load variation. Every request still reads
current authorization data.

| ACL query mode | Users | Cursor p95 / p99 | Save p95 | Skipped cursor POSTs | Stream closes | Latest sequences |
| -------------- | ----: | ---------------: | -------: | -------------------: | ------------: | ---------------: |
| Unprepared     |   250 |    846 / 1072 ms |   683 ms |         9933 / 15000 |             0 |        302 / 302 |
| Prepared       |   250 |    586 / 1056 ms |   881 ms |         4298 / 15000 |             0 |        302 / 302 |
| Unprepared     |  1000 |   5876 / 6775 ms |  5691 ms |        57176 / 60000 |             0 |      1897 / 1900 |
| Prepared       |  1000 |   4363 / 5435 ms |  3760 ms |        55055 / 60000 |           687 |       706 / 1900 |

The prepared run also covered 50 users (cursor p95/p99 142/240 ms, no closes,
24/24 final sequences), 250 with injected failures (358/620 ms, revocation
117 ms, 294/295 final sequences), and a 1000-user no-cursor control (save p95
588 ms, no skips or closes). All profiles recorded zero tenant/page leaks and
zero presence rows. Raw artifacts preserve response failures and intentional
abort/socket errors in the fault run:
[unprepared](saas-before-lease-batching-unprepared.json) and
[prepared](saas-before-lease-batching-prepared.json).

The 687 closes were a real correctness problem under load, not evidence that
NOTIFY needed replacement. A second 1000-user run added lifecycle counters and
recorded 191 stream closes with no application or ACL errors. The two pods
reported 79 and 114 failed topology-lease renewals, alongside 78 and 114 normal
session closes. Ephemeral broker publish p95 was 19.8/19.2 ms, with zero broker
failures and zero observed notification-queue usage. The original heartbeat
awaited one UPDATE per connection serially; its ten-second interval could also
start overlapping loops. The raw [lease diagnostic](saas-topology-before.json)
records the old coordinator's source hash.

The fix retains the existing SSE ownership row, but renews up to 1000 rows in
one UPDATE. It matches each session key with its own generation and owner,
requires the existing unexpired lease, and checks each managed client's last
seen time. It does not extend a client-liveness deadline or change ACL checks.
Heartbeat cycles are single-flight; a result for an old handler cannot close a
replacement opened while SQL was in flight. PGlite and real PostgreSQL tests
check wrong owners, swapped generations, expired owner/client leases, mixed
client deadlines and the SQL count (1001 rows in two UPDATEs).

The matched post-fix 1000-user run kept all streams open, had no lease-expiry
observations, and received 1900/1900 final sequences. Cursor p95/p99 was
2713/3090 ms, save p95 2011 ms, and 53,719/60,000 cursor POST opportunities
were skipped. Total realtime NOTIFY traffic was 285/s (9372 messages in
32.862 s); ephemeral publish p95 was about 21 ms with no errors. The
[post-fix artifact](saas-topology-after.json) uses the same observed fixture as
the lease diagnostic and records the changed coordinator hash. The continuity
fix is verified; this remains an overloaded workload, not a 1000-user capacity
claim. Fresh ACL/context work, exact durable admissions and refetch fan-out still
consume the constrained database's capacity.

## Capacity axis and broker decision

A final sequential run raised only the disposable PostgreSQL container's CPU
allowance from two to four CPUs, retaining 1 GiB RAM, disk-backed storage,
prepared ACL queries, the same fixture and the same framework source hashes.
This is a sizing experiment, not a recommendation to change production limits.

| Users | Cursor p95 / p99 | Save p95 | Skipped cursor POSTs | Closes | Latest sequences |
| ----- | ---------------: | -------: | -------------------: | -----: | ---------------: |
| 250   |     225 / 334 ms |   178 ms |          772 / 15000 |      0 |        302 / 302 |
| 1000  |   2354 / 2999 ms |  1982 ms |        52191 / 60000 |      0 |      1900 / 1900 |

[Four-CPU evidence](saas-4cpu.json) retains SQL/wait/CPU and broker samples.
The 250-user profile now accepts most offered cursor updates, but 1000 users
still exceed this workload's useful latency/input rate. Increasing CPU does
not remove the repeated session/RBAC/ancestor checks, exact durable admission
transactions, or the application refetch fan-out.

Keep NOTIFY for this release. There were no broker failures or observed queue
accumulation in the large post-fix runs; broker publish latency was tens of
milliseconds while end-to-end delivery took seconds. These measurements do not
show that swapping brokers would address the dominant costs. Keep all NOTIFY
calls on the dedicated autocommit publisher and coalesce replaceable values.
If later measurements show notification lock/queue saturation after application
ACL and projection costs are controlled, implement Redis pub/sub behind the
existing three-operation ephemeral broker interface. That requires a separate
owner decision; no new broker was implemented here. Autopilot should measure
its actual ACL/projection queries before selecting an operating envelope.

## Reproduction

Use a fresh disposable database with `pg_stat_statements` preloaded and its
extension installed. The fixture creates framework tables and synthetic data;
never point this command at application data. Run separately from builds,
tests and other load generators:

```sh
BUN_CONFIG_MAX_HTTP_REQUESTS=4096 \
QUESTPIE_MIGRATIONS_SILENT=1 \
QUESTPIE_EPHEMERAL_DATABASE_URL="$EPHEMERAL_TEST_DATABASE_URL" \
SAAS_ACCESS_SHARING=tenant SAAS_TUNE_READS=1 SAAS_PREPARE_AUTH=1 \
bun packages/questpie/bench/saas-load.ts
```

`SAAS_SCENARIOS` selects comma-separated `users:pages` profiles; append `:faults`
for failure injection or `:control` to omit cursor publishes. Pages are spread
evenly across 20 tenants. `SAAS_DURATION_MS` changes the input window. Omit
`SAAS_PREPARE_AUTH` for the matching unprepared ACL queries, and omit both
projection flags for the untuned application query model. The seed explicitly
restores the selected index configuration between runs.
