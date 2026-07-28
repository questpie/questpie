---
"questpie": minor
---

`/health` now performs real subsystem checks, and `/health/live` is added for
liveness probes.

**Point your `livenessProbe` at `/health/live` and your `readinessProbe` at
`/health`.** A liveness probe on `/health` turns a brief database outage into a
rolling restart of every replica at the moment they can least afford it.

What `/health` actually verified before: the database, via `SELECT 1`. Storage was
reported `"ok"` whenever an adapter object existed — without touching storage at
all — so an app with unreachable object storage reported healthy. KV and the queue
were not checked at all, and the handler reached the app through an `as any` cast.

Now:

- **database** — `SELECT 1`, with measured latency
- **kv** — a real read, with measured latency (a missing key is a healthy answer)
- **search** — the adapter's own `isInitialized()`; `degraded`, not `unhealthy`,
  since an app whose search is warming can still serve everything else
- **storage** / **queue** — reported as `"configured (not probed)"`. A meaningful
  probe would cost an object-storage request or enqueue a job on _every_ health
  check at load-balancer frequency. The status now says exactly what was verified
  instead of implying more.

Each check is bounded at 2s so a hung dependency cannot hang the probe. Responses
carry `cache-control: no-store`. A subsystem that is not configured reports
`not_configured` and does not count as a failure.

Status codes are unchanged: 200 for `ok` and `degraded`, 503 for `unhealthy`.
Consumers that only read `status` and the HTTP code need no changes; anything
parsing `checks.storage.status` as proof of reachability was already being misled
and should read `detail`.
