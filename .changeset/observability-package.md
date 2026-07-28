---
"questpie": minor
"@questpie/observability": minor
---

Adds tracing and metrics: an observability seam in the framework and a new
optional `@questpie/observability` package that backs it with OpenTelemetry.

```ts
import { otelObservability } from "@questpie/observability";

export default runtimeConfig({
	observability: {
		adapter: otelObservability({
			serviceName: "my-app",
			otlpEndpoint: "http://localhost:4318",
			samplingRatio: 0.1,
		}),
	},
});
```

`questpie` itself gains **no** OpenTelemetry dependency — it defines
`Tracer`/`Meter`/`ObservabilityAdapter` interfaces with no-op defaults, exported
from `questpie/observability`, and the heavy SDK lives only in the adapter
package. An app that never configures an adapter pays nothing: `span()` calls
straight through to its callback with a frozen no-op span and allocates nothing.

The adapter composes the OTel SDK by hand rather than using
`@opentelemetry/sdk-node` or `auto-instrumentations-node`. That was validated on
Bun 1.3.14: a manually composed provider initialises and exports under plain
`bun run`, with no `--require`, no preload, and no monkey-patching of built-ins.
Context propagates across `await` and timers via
`AsyncLocalStorageContextManager`, and `traceparent` round-trips through the W3C
propagator.

A sampling ratio is wrapped in a parent-based sampler, so a trace already
sampled upstream is not truncated here — a bare ratio sampler produces broken
partial traces.

This ships the seam and the adapter. Framework subsystems are not instrumented
yet; HTTP, CRUD, jobs, KV and Search spans follow.
