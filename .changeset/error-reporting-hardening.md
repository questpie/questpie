---
"questpie": minor
---

Error reporting follow-ups to 3.41.0:

- `ErrorReportSource` gains `"process"`, for an uncaught exception or unhandled rejection about to end the process (see `installProcessErrorHandlers` in `@questpie/sentry`). An adapter that switches over `source` exhaustively must handle it.
- A `route` with a URL scheme or host (`https://…`, `//…`) is dropped from a report. Pass a route template: a raw path such as `invite/abc123` cannot be told apart from one and is still sent.
- A report dropped because `maxPending` was reached no longer marks the error as reported in its request or job attempt, so a later report of the same error there is delivered.
- A `listen()` worker's graceful shutdown (`SIGINT`/`SIGTERM`) now delivers pending reports before the process exits, within the queue's `shutdownTimeoutMs`. Previously it exited without draining them.
- A Graphile Worker attempt that runs past `expireInSeconds` is now reported once, as a `QueueExecutionTimeoutError`, the moment the deadline passes, even if its handler ignores the abort signal. It used to be treated as cancellation and not reported. A worker shutdown is still not reported.
- A secret-payload job the broker delivers again while another attempt still holds its dispatch is no longer reported. That attempt reports its own outcome; the duplicate still fails as before, so retry and ack are unchanged. Adapters that defer such a delivery (Graphile Worker) never reported it.
