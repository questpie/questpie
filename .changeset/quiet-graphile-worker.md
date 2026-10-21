---
"questpie": minor
---

Add the optional `questpie/adapters/graphile-worker` adapter for Graphile Worker 0.18.0, PostgreSQL 12+ and Node 22.18+. All job names share a LISTEN-driven runner and fetch buffer, with process and per-job concurrency limits. Publication supports delayed/priority jobs, retries, singleton suppression, durable replay receipts, UTC cron and graceful drain.

Opt into atomic non-secret enqueue through the application's Drizzle transaction with `useApplicationTransaction: true`; this includes the postgres-js driver. Secret payloads retain encrypted relay publication and execution-state reconciliation. Dispatch JSON bindings now work across postgres-js, node-postgres, Bun SQL and PGlite.

New framework receipt lifetimes use distinct dispatch identities with this adapter, preserving older delayed jobs after idempotency retention. Transient shared-fetch/task-discovery errors are reported and retried without restarting the runner. Lease recovery serializes with public administrative cancellation.

Completion and deferral persistence retry their original outcome after database errors. Secret execution admission is recorded after its framework claim is acquired, so contention or a crash while waiting for that claim cannot exhaust an unstarted handler's retries or erase its payload.

Install `graphile-worker@0.18.0` and configure a direct/session-pooled runner URL when the application uses transaction pooling. `expireInSeconds` supplies a cooperative `AbortSignal` and a durable execution lease; timed-out or dead workers retry through a new physical job ID, so stale completion cannot settle a newer attempt. Pass the signal to cancellable I/O. Existing pg-boss jobs must be drained or migrated before switching brokers.
