---
"questpie": minor
---

Add a provider-neutral error reporting seam: `runtimeConfig({ errors: { adapter } })` exposes `app.errors` and `ctx.errors` with `errors.report(error, info)`.

Without an adapter, nothing changes. With one, the framework reports:

- **HTTP:** one report per unexpected 5xx response, whether the handler threw (`kind: "thrown"`), returned a 5xx (`kind: "returned"`, no error passed) or the response stream failed (`kind: "stream"`). 4xx outcomes and client disconnects are not reported. Only the matched route template is passed, never the raw URL.
- **Queues:** one report per failed attempt, with the static job name and the adapter's `final` classification. A secret-payload job only ever hands the reporter its redacted, cause-free error. Cancelled attempts (lease expiry, shutdown) are not reported.

`source` is `http`, `job`, `background`, `manual` or `process` (an uncaught exception or unhandled rejection about to end the process). A `route` with a URL scheme or host is dropped; pass a route template, since a raw path cannot be told apart from one.

`report()` is synchronous and never throws. It does not change a response, a thrown error, or a job's retry or ack. Delivery is bounded by `maxPending` (100) and `timeoutMs` (5 s), and `app.destroy()` drains pending reports within `shutdownTimeoutMs` before shutting the adapter down. `info` is validated down to `source`, `kind`, `method`, `route`, `status`, `job` and `final`; every other field is dropped. Reporting works with tracing disabled.

Regenerate your app (`questpie generate`) to get `ctx.errors` typed. Apps that registered their own top-level (`namespace: null`) service named `errors` must rename it.
