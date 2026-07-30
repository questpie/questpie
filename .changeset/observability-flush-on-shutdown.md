---
"questpie": patch
---

Observability now flushes on shutdown. Previously the last batch of spans,
metrics and logs was dropped on every clean exit.

`ObservabilityService.shutdown()` existed and forwarded to the adapter, but the
service definition declared no `dispose`, and `Questpie.destroy()` skips any
service that doesn't have one. So nothing ever called it. With an OTLP endpoint
configured, whatever the exporter still had queued when the process exited was
lost — which is exactly what the adapter contract warns about: "`shutdown()`
must flush — a process that exits without it loses whatever is still batched."

The flush lands in the right place in the teardown order for free. Disposal
walks the infrastructure services in reverse, and observability is in tier 0, so
it is torn down second-to-last: the database, queue, realtime and search
services have all emitted their closing spans before the exporter flushes.

Affects any app running `otelObservability` with `otlpEndpoint`. Apps with no
adapter configured were never affected — there was nothing to flush.
