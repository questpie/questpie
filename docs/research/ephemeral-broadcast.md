# Ephemeral Channels: contract and measurements

2026-10-22. First consumer: Autopilot WHOL-1194, S8. Intent comes from its
`docs/design/nav-library-explore-2026-10-20/COLLAB-RESEARCH.md` and DECISIONS
Q80–Q82, plus the owner's request to ship the generic contract in QUESTPIE v3.

## API decision

Use `channel(pattern).ephemeral({ coalesceMs: 100, maxPayloadBytes: 1024 })`.
Keep the existing channel registry, event schemas, authorization callbacks,
server facade, client subscription and shared SSE connection. `.presence(resolver)`
selects the in-memory membership lifecycle on an ephemeral channel.

`publish(event, data, { coalesceKey })` supports a server-only partition key for
services publishing for several actors. The ordinary browser POST remains
schema-validated and rate-limited; its coalescing partition is the authenticated
principal. Actor identity in an application payload must still be resolved by
trusted application code. Autopilot can keep browser publishing disabled and
publish through its existing authorized commands using `coalesceKey: actorId`.

The broker contract has three operations: `start(onMessage, onDisconnect)`,
`publish(serializedPackets)`, and `stop()`. The in-process implementation and the
Postgres adapter implement the same contract. The Postgres adapter reuses the
existing notification driver's lifecycle, timeouts and reconnect logic. A Redis
pub/sub implementation can replace it without changing channel/client APIs;
none is included. The broker wire contains independent typed entry envelopes so
packing is linear and preserves Dates without repeatedly serializing a growing
array. In the 100-topic × 100-key fixture, cold packing takes roughly 45 ms and
packing prevalidated entries roughly 3 ms, versus roughly 0.8–1 s for the original
algorithm. Bytes increase about 5%; packet count remains 300 in that fixture.
[Raw packing evidence](ephemeral-broadcast/packing.json) and
[reproduction](../../packages/questpie/bench/ephemeral-packing.ts) record the tradeoff.

Latest values are coalesced per resolved channel, publisher/key and event in
100 ms windows. Packets split below 7900 UTF-8 bytes. All ready packets in one
flush go through one SQL `SELECT pg_notify(...) FROM unnest(...)`, so ten active
pages usually mean about 100 NOTIFY messages/s but only ten publisher commits/s
per publishing process. The adapter owns one LISTEN connection and a separate
publisher connection for all ephemeral topics. Application write transactions
never supply either connection.

Events are best effort: superseded values and overload drops are intentional.
UUID receipts are diagnostics, not replay positions. Resume/replay are rejected.
Presence joins on subscribe, renews every 10 seconds, leaves on unsubscribe and
expires after 30 seconds without a heartbeat. New subscribers request live
members from their peers. Access is checked with a fresh request context before
each delivery batch and at least every second while idle, failing closed on
error/timeout. Policy denial ends the logical binding; infrastructure failure or
timeout closes the physical SSE epoch and reconnects without delivering the
unchecked batch. A failed publish drops that best-effort batch without revoking
healthy subscriptions. Revoke by changing the access state used by the subscribe rule;
there is no durable authority fence on this lane.

No new tables or migrations are needed. The lane writes no ledger, authority or
presence rows. Existing SSE connection topology/lease metadata stays in the
existing transport; this is not a claim that the entire shared transport issues
zero database writes. A publish inside a transaction is still ephemeral and is
not undone by rollback.

Public usage, exact limits and broker configuration are in
[ephemeral channels](../../apps/docs/content/docs/client/channels/ephemeral.mdx).
The [awareness example](../../packages/questpie/examples/ephemeral-awareness.ts)
is executed by the unit tests, including independent server-resolved actors.

The controlled measurements below predate the preliminary adversarial fixes and
pin their own source variants. The [audit response](ephemeral-broadcast/audit.md)
records those fixes; the [realistic SaaS report](ephemeral-broadcast/saas-load.md)
adds real HTTP/TCP, session/RBAC queries, live projections, durable invalidations
and failure injection. Read each
artifact's source metadata before comparing results.

## Method

Real PostgreSQL 17 in a disposable Docker container; two separate Bun OS
processes: one publisher and one subscriber process. Fifty connections are
spread over ten pages, five per page. Each delivered event therefore fans out
to five SSE sinks. Presence is enabled. Each authorization callback executes a
real `SELECT true` through a pool, rather than a no-op callback.

Four additional concurrent writers insert 1 KiB rows with roughly 5 ms pacing.
There is a writes-only baseline. A phase offers updates for ten seconds and then
waits at least 500 ms for delivery; completed broker calls, failed fan-out and
remaining fan-out are recorded. NOTIFY/s below includes the measured tail and
presence, so it differs from the approximately 100 messages/s during active
publishing. Read the JSON for exact denominators and offered/retained counts.

Latency is publish timestamp to remote SSE frame encoding, once per retained
event ID. It includes coalescing, Postgres fan-out and authorization reads.
Superseded events have no latency sample. HTTP POST parsing/Zod, browser network
latency and rendering are outside this benchmark. It measures one publishing
pod; with multiple publishing pods, each contributes its own coalesced batches.

The controlled runs use a 512 MiB tmpfs data directory with `fsync=on` and
`synchronous_commit=on`. This keeps real Postgres transaction/NOTIFY behavior
while removing shared-host disk stalls. It is not a production-storage latency
claim. CPU, Postgres and Bun versions are recorded in each JSON artifact.

## Shared PostgreSQL driver and SSE control decision

The shared PG driver now drains concurrent/accumulated publish requests in one
`unnest` SQL call, without adding a timer. This applies to durable Channels,
query invalidations, topology and CRDT notices too. All distinct payloads remain
in FIFO order. Admission stays bounded at 256 requests; each caller settles only
after its batch completes. A failed batch rejects all its callers; shutdown
finishes the active batch and cancels queued work. PostgreSQL can fold identical
payloads within a transaction; these are lossy wake hints, not event receipts.
Durable ledger/event persistence and replay semantics are unchanged.

The audit follow-up also reduces work after a durable wake:

| Contract probe                                                        | Before (`da944`) |      After |
| --------------------------------------------------------------------- | ---------------: | ---------: |
| Authority read SQL for seven bindings on two channels (one anonymous) |               12 |          2 |
| Three viewers × 20 events: authority reads per delivered frame        |             2.00 |       0.33 |
| Same probe: exact admission transactions per frame                    |             1.00 |       1.00 |
| Same probe: frame encodes per delivery                                |             2.00 |       1.00 |
| Ledger drains per wake, either initialization order                   |                2 |          1 |
| Eight queued wake hints behind one in-flight notice                   |       8 payloads | 5 payloads |

These are SQL/call-count contracts, not latency or throughput estimates.
Reconciliation reads generations together per channel. Delivery first attempts
admission at the generation already authorized for that binding; a mismatch
re-reads and re-evaluates access. Every frame retains its exact database admission
transaction. Neither a channel snapshot nor an authorization result is cached
across an authority cut, and network I/O stays outside the fence lock.

Queued outbox and channel-event wakes now share a matching queued hint. A wake
already on the wire never absorbs a later committed change. Topology and CRDT
notices stay distinct. The first high-water hint may survive a fold; consumers
must drain committed state rather than treat that hint as a delivery boundary.
Permanent regressions in `ordered-channel-ledger.test.ts`,
`realtime-channel-reconciliation.test.ts` and `realtime-pg-change-broker.test.ts`
cover both the count reductions and races with revocation/retry.

This follows the same round-trip reduction principle described in
[Graphile Worker's batching guidance](https://worker.graphile.org/docs/performance#batching).
Its local queue also separates retrieving work from distributing it locally.
QUESTPIE already uses a durable ledger plus notice-only wakes for ordered data;
ephemeral values instead travel in coalesced broker packets. Graphile's job
throughput numbers are not a benchmark of QUESTPIE or ephemeral fan-out.
[PostgreSQL's NOTIFY contract](https://www.postgresql.org/docs/17/sql-notify.html)
explains commit-time delivery and duplicate folding. Notifications remain on
separate autocommit connections, outside application writing transactions.

A broker-only saturation check sends 10,000 distinct topology notices at fixed
concurrency 128, with two independent PG broker instances in one Bun process.
It waits for all notices to reach the listener and uses `pg_stat_statements`
for actual SQL counts. The previous driver took 1505 ms (6,644 notices/s,
10,000 SQL calls); the batched driver took 92 ms (108,183 notices/s, 79 SQL
calls). Delivery p95/p99 fell from 23.6/26.9 to 2.1/3.8 ms. This local tmpfs
microbenchmark verifies a concrete batching gain, not a production capacity or
end-to-end application throughput claim.

The 50-cursor/10-page/10 Hz workload was also repeated before and after the
shared-driver change, under the same four concurrent writers:

| Lane            | NOTIFY SQL calls | NOTIFY payloads | Delivery p95 / p99 | Outcome                                                                      |
| --------------- | ---------------: | --------------: | -----------------: | ---------------------------------------------------------------------------- |
| Channels before |            4,976 |           4,976 |   3,074 / 3,129 ms | 24 failed notices; all 50 sinks closed                                       |
| Channels after  |            1,334 |           5,000 |   1,864 / 1,888 ms | No failed notices or closes; 4,616/5,000 event IDs observed by sample cutoff |
| Ephemeral after |               97 |             970 |         46 / 56 ms | No failures or closes; zero ledger rows                                      |

Channels still incurs ledger, fencing and ordered-delivery work; its measured
latency/backlog is unsuitable for cursors even after the broker improvement.
Ephemeral averaged 92 NOTIFY/s including presence and the drain tail. Raw JSON
records broker API calls separately from server-side SQL calls: batching makes
these different quantities. The before/after comparison is one sequential pair
on a shared host, not a statistically controlled capacity study.

**Keep the shared SSE topology row.** A separate measurement opens 50 real
Fetch-handler SSE streams with memory presence, real authorization reads, 50
cursors at 10 Hz on ten pages, and four concurrent SQL writers for 21 seconds.
All 50 streams stayed open. It inserted 50 topology rows on admission and
performed 100 lease UPDATEs (two default ten-second renewals per stream):
6.18 ms total server SQL execution time, or about 0.062 ms per update. Opening
all 50 streams took 177 ms; topology INSERT SQL accounted for 6.01 ms. The
15-second reconciliation pass issued 50 SELECTs (1.75 ms SQL execution).
It wrote zero event or presence rows. Delivery p95/p99 was 103/113 ms and
concurrent writes averaged 829/s with p95 2.62 ms. SQL execution timings exclude
network/commit round trips; the full stream measurement includes their effect.

Thus 50 open streams pay roughly five lease writes/s, independent of cursor
frequency, while the broker sends roughly ten autocommit batches/s. The row
fences stale connection owners and lets topology POSTs arriving on another pod
update the owner. Removing it would require another cross-pod control and
fencing protocol, or sticky routing with weaker rollout/failover behavior. A
pure in-memory owner map would not preserve those guarantees. The observed
cost does not justify that tradeoff. This decision preserves the existing
control plane and removes high-frequency event/presence DML from the data path.
The Fetch benchmark executes the real handler and response readers in process;
it excludes TCP/browser rendering and Autopilot's actual ACL query cost. The
separate cross-process benchmark covers PG fan-out between OS processes.

Raw evidence and runnable benchmarks:

- [Common PG before](ephemeral-broadcast/common-pg-before.json) / [after](ephemeral-broadcast/common-pg-after.json)
- [Broker saturation](ephemeral-broadcast/pg-broker-throughput.json): `packages/questpie/bench/pg-notify-throughput.ts`
- [Full shared SSE/control path](ephemeral-broadcast/shared-sse-topology.json): `packages/questpie/bench/ephemeral-sse-topology.ts`

## Current controlled comparison on disk-backed PostgreSQL

After the lifecycle, packet-packing, common wake/fence and topology fixes, the
50-cursor/10-page/10 Hz benchmark was repeated on the SaaS experiment's
2-CPU/1-GiB disk-backed PostgreSQL container. This keeps the original simple
`SELECT true` authorization and modeled SSE sinks in two OS processes; use the
SaaS report for actual TCP HTTP/SSE and representative ACLs. It is a new
sequential pair, not a controlled speedup ratio against the earlier tmpfs runs.

| Lane             | Measured NOTIFY payloads / SQL calls | Delivery p95 / p99 | Event rows | Result                                |
| ---------------- | -----------------------------------: | -----------------: | ---------: | ------------------------------------- |
| Ephemeral        |                             970 / 99 |       102 / 112 ms |          0 | 4800 retained IDs, no failures/closes |
| Durable Channels |                          4991 / 2083 |       549 / 757 ms |       5000 | All 5000 IDs, no failures/closes      |

The input was 5000 updates over ten seconds. Ephemeral supersession is intended;
it delivered 24,000 frames to five local viewers per retained event. Its actual
SQL window saw about 92 NOTIFY payloads/s, versus about 474/s for Channels.
There were four concurrent 1-KiB writers: roughly 692 writes/s during ephemeral
and 800/s during Channels. The writes-only phase reached 743/s; those sequential
rates also show host/storage variation, not an ephemeral write-performance claim.
[Raw current comparison](ephemeral-broadcast/controlled-final-disk.json) retains
API observer counters separately: they include pre-window membership admission
and, for durable wakes, calls folded before SQL. Use `notifySqlRows` for actual
PostgreSQL notification counts in the measurement window.

The larger TCP experiment found a cost hidden by the 50-stream control test:
serial lease UPDATE round trips could expire healthy SSE ownership under load.
Renewals are now bounded set-based UPDATEs, preserving owner/generation/client
expiry predicates and row-level fencing. A matched 1000-stream run went from
191 closes to zero; all final sequences arrived. Its multi-second latency and
skipped POSTs still indicate overload. See the
[SaaS investigation](ephemeral-broadcast/saas-load.md) before sizing a deployment.

## Initial lane comparison

The following earlier runs predate common-driver batching. They remain as
baseline evidence; the current Channels behavior is reported above.

The matched 10 Hz workload corresponds to the recommended 100 ms browser POST
throttle: 50 cursors offer about 500 updates/s.

| Lane                            | Completed NOTIFY/s | Latency p95 / p99 | Event rows inserted | Outcome                                                                 |
| ------------------------------- | -----------------: | ----------------: | ------------------: | ----------------------------------------------------------------------- |
| Ephemeral, 50 cursors at 10 Hz  |               92.9 |      102 / 104 ms |                   0 | No disconnects or failed fan-out                                        |
| Channels, 50 cursors at 10 Hz   |              192.4 |    3351 / 3415 ms |                4850 | All 50 subscriptions closed as slow consumers; 164 fan-out calls failed |
| Ephemeral, 50 cursors at 20 Hz  |               97.7 |        52 / 54 ms |                   0 | No disconnects or failed fan-out                                        |
| Channels, 50 cursors at 20 Hz   |              820.6 |    2310 / 2333 ms |                9900 | All 50 subscriptions closed; 1274 fan-out calls failed                  |
| Ephemeral, 100 cursors at 20 Hz |               97.1 |        63 / 93 ms |                   0 | No disconnects or failed fan-out                                        |

The slower completed NOTIFY rate for Channels at 10 Hz reflects its backlog and
longer drain, not a lower configured event rate. Its latency figures cover only
events delivered before the subscriptions closed; they are not successful
steady-state latency. These are the default ordered-ledger/backpressure settings
with access checks enabled, not a claim about maximum tuned Channels throughput.

In the matched 50-cursor ephemeral phase, concurrent writes averaged 910/s with
p95 0.46 ms; its writes-only phase averaged 783/s with p95 2.51 ms. The shared
host and warm-cache order explain why this must not be advertised as a write
speedup. The separate 100-cursor run measured 845 writes/s versus 868/s without
cursors; write p95 was 1.47 versus 0.79 ms. Both ephemeral runs drained without
broker failures. Increasing cursor count did not increase page-level NOTIFY
traffic because packets still fit below the byte limit.

Disk-backed runs were noisy: the archived 50-cursor run measured p95/p99
180/399 ms and 283 writes/s, versus a 342 writes/s baseline. An earlier run also
observed an approximately 11-second write pause. At diagnosis time the host
reported substantial memory and I/O pressure (roughly 20% full memory stalls
and 15% full I/O stalls over ten seconds). The pause was not attributed to a
specific Postgres wait, and the controlled run is not evidence that production
storage will behave the same. Sampled Postgres waits in the controlled runs did
not identify a notification-lock bottleneck; 200 ms sampling cannot exclude
short waits.

**Keep NOTIFY for this workload.** The coalesced lane sustained the requested
50-cursor workload and a 100-cursor/20 Hz check. Redis is not justified by these
results. Re-run on Autopilot's actual storage, authorization query and rolling
pod topology before accepting an end-user latency SLO. If notification queue
pressure or broker wait time grows with active pages/pods, replace the broker
with Redis pub/sub after owner approval. Do not use Channels for cursor frames.

Raw evidence:

- [50 cursors, 10 Hz, tmpfs](ephemeral-broadcast/50-cursors-10hz-tmpfs.json)
- [50 cursors, 20 Hz, tmpfs](ephemeral-broadcast/50-cursors-20hz-tmpfs.json)
- [100 cursors, 20 Hz, tmpfs](ephemeral-broadcast/100-cursors-20hz-tmpfs.json)
- [Disk-backed diagnostic](ephemeral-broadcast/50-cursors-20hz-disk.json)

The initial headline artifact pins SHA-256 hashes of the runtime, broker
interface and pre-batching PG driver alongside the source base. The newer
artifacts identify the shared-driver variant separately. No baseline files were raised.

## Reproduce

Use an isolated, disposable database: the benchmark creates framework tables,
a `pg_trgm` extension and its own write-load table. Never point it at application
data. Provision Postgres, then run from the repo root:

```sh
QUESTPIE_MIGRATIONS_SILENT=1 \
QUESTPIE_EPHEMERAL_DATABASE_URL="$EPHEMERAL_TEST_DATABASE_URL" \
bun packages/questpie/bench/ephemeral-broadcast.ts
```

For actual NOTIFY SQL counts and the two additional benchmarks, preload
`pg_stat_statements` in the disposable server and run
`CREATE EXTENSION pg_stat_statements` before benchmarking. Without it the main
benchmark still runs, with SQL counters reported as null. Run the SSE and broker
benchmarks separately from tests or other load generators.

Optional benchmark inputs are `EPHEMERAL_BENCH_DURATION_MS`,
`EPHEMERAL_BENCH_INPUT_HZ` (default 10), `EPHEMERAL_BENCH_CURSORS` (default 50),
and comma-separated `EPHEMERAL_BENCH_MODES` (default
`writes-only,ephemeral,channels`). The 20 Hz archived run also includes
`channels-throttled`, which uses 10 Hz for that phase.

The real-Postgres contract runs with the same database URL:

```sh
QUESTPIE_EPHEMERAL_DATABASE_URL="$EPHEMERAL_TEST_DATABASE_URL" \
bun test packages/questpie/test/integration/ephemeral-postgres.test.ts
```

It starts two OS processes with `default_transaction_read_only=on` and verifies
cross-process events, page isolation, membership, heartbeat/leave, access loss
and one ephemeral LISTEN connection per process. The HTTP integration separately
checks the public client, shared stream, typed Dates, 413/429, replay rejection
and empty ledger/head/presence/authority tables.

## Autopilot S8 handoff

Upgrade the framework/client together and run codegen. For S8 cursor/typing hints, set `maxPayloadBytes: 512` (the limit includes the typed payload envelope). Register a new ephemeral
wire pattern for page awareness; preserve the page's existing read-access
resolver for both admission and fresh live checks. Keep actor identity and
server time in the application command, and pass `coalesceKey: actorId` when
publishing through a system service. Throttle browser POSTs to 100 ms; do not
retry superseded cursor positions. Clear local ephemeral UI when readiness ends,
and reconstruct it from presence plus fresh events after reconnecting.

Reuse a direct/session-pooled `REALTIME_DATABASE_URL` for the ephemeral NOTIFY
adapter and a unique namespace if databases are shared. The durable change
broker remains separately configured. Delete S8's temporary adapter once the
framework version is deployed. Agent presence derived from Runs stays an
application concern. Validate real page authorization and multi-pod latency in
Autopilot; this benchmark does not exercise its ACL queries or browser renderer.
