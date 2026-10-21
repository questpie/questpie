---
"questpie": minor
---

Add the optional `questpie/adapters/graphile-worker` adapter for Graphile Worker 0.18.0, PostgreSQL 12+ and Node 22.18+. All job names share a LISTEN-driven runner and fetch buffer, with process and per-job concurrency limits. Publication supports delayed/priority jobs, retries, singleton suppression, durable replay receipts, UTC cron and graceful drain.

Opt into atomic non-secret enqueue through the application's Drizzle transaction with `useApplicationTransaction: true`; this includes the postgres-js driver. Secret payloads retain encrypted relay publication and execution-state reconciliation. Dispatch JSON bindings now work across postgres-js, node-postgres, Bun SQL and PGlite.

New framework receipt lifetimes use distinct dispatch identities with this adapter, preserving older delayed jobs after idempotency retention. Transient shared-fetch/task-discovery errors are reported and retried without restarting the runner. Lease recovery serializes with public administrative cancellation.

Completion and deferral persistence retry their original outcome after database errors. Secret execution admission is recorded after its framework claim is acquired, so contention or a crash while waiting for that claim cannot exhaust an unstarted handler's retries or erase its payload.

Install `graphile-worker@0.18.0` and configure a direct/session-pooled runner URL when the application uses transaction pooling. `expireInSeconds` supplies a cooperative `AbortSignal` and a durable execution lease; timed-out or dead workers retry through a new physical job ID, so stale completion cannot settle a newer attempt. Pass the signal to cancellable I/O. Existing pg-boss jobs must be drained or migrated before switching brokers.

Unexpected Graphile runner shutdown now terminates the hosting process non-zero instead of leaving an idle, apparently healthy consumer. Startup verifies LISTEN delivery with a bounded NOTIFY round trip. Budget one extra direct/session connection per replica for dispatch fencing, in addition to the publishing and runner pools.

Per-name permits are reserved during single-job fetches, preserving FIFO without re-enqueue churn. The adapter currently fetches one job even if `batchSize` is larger; this trades batch throughput for correct admission. Recovery uses partial indexes and bounded batches rather than joining the pending backlog every second.

Timeout and shutdown send AbortSignal, but permits and dispatch fences remain held until handler and cleanup promises settle. Non-cooperative handlers delay their own retry until they settle or their process exits. Permanent secret admission failures terminalize and erase ciphertext; pending relay acceptance and busy execution claims preserve their retry budget. Unsupported `queuePolicy` now warns once per name.

Shared secret dispatch completion checks the current token and accepted receipt even after lease lapse; a newer token and terminal failure still reject late completion. Renewal enforces an absolute deadline when supplied. Database latency while persisting a successful Graphile handler cannot cause a second handler attempt. Dispatch JSON writes use `jsonbSafe` text-to-jsonb driver bindings for postgres-js compatibility.

Routine startup checks a versioned adapter schema without DDL locks. Buffered TTL returns release permits, and retired physical jobs cannot execute as foreign payloads after Graphile clears their keys. Cross-schema Graphile migration notifications do not stop this runner. Idle fence connections reconnect; loss during active work and unexpected runner death emit an error and exit non-zero, including under Bun with pending top-level await. Hosts can supply `onFatalError` to own process termination.

Missing runtime secret or context database is a retryable host error; it preserves encrypted work and its handler retry budget. Missing receipts and malformed envelopes remain terminal job faults.
