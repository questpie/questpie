---
"questpie": minor
"@questpie/observability": minor
---

Adds the metrics and logs signals, and continues inbound trace context.

**Metrics.** Requests record `http.server.request.duration` (seconds, OTel
semantic conventions). One histogram is the whole RED triple: rate is its count,
errors are that count sliced by `http.response.status_code`, duration is the
histogram itself. Nothing emitted metrics before this; the meter surface had
existed unused since the first slice.

**Logs.** Records carry `trace_id` and `span_id` from the active span, in the
snake_case OTel conventions a backend joins on. The existing camelCase `traceId`
stays beside them and is a different value — the framework's correlation id from
the inbound `traceparent`, which diverges once an adapter owns propagation. With
an `otlpEndpoint` set, records are also exported on the OTel logs signal,
alongside the existing Pino output rather than instead of it.

**Propagation.** An inbound `traceparent` is now continued with the remote span
as parent. Previously the header was parsed for correlation and then discarded,
so every service started its own trace and a distributed waterfall broke at each
hop.
