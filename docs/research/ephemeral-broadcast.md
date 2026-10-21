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
none is included.

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
error/timeout. Revoke by changing the access state used by the subscribe rule;
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

## Results

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

The headline artifact pins SHA-256 hashes of the runtime, broker interface and
PG driver alongside the source base. No baseline files were raised.

## Reproduce

Use an isolated, disposable database: the benchmark creates framework tables,
a `pg_trgm` extension and its own write-load table. Never point it at application
data. Provision Postgres, then run from the repo root:

```sh
QUESTPIE_MIGRATIONS_SILENT=1 \
QUESTPIE_EPHEMERAL_DATABASE_URL="$EPHEMERAL_TEST_DATABASE_URL" \
bun packages/questpie/bench/ephemeral-broadcast.ts
```

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

Upgrade the framework/client together and run codegen. Register a new ephemeral
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
