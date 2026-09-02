# OpenTelemetry boundary candidates

Status: design comparison; not product authority

## Constraints that decide the seam

The Runtime already owns root execution, Operation outcomes, PostgreSQL
transactions, durable attempts, Actions, cancellation, and shutdown. The public
App Contract does not expose observation, and the current event callback sees
only Runtime and Operation events. `ExecutionEventV1` also copies arbitrary
caller `callId` text into telemetry correlation.

The accepted contract requires one closed Execution Envelope and one observation
engine across direct, Fetch, generated-client, recompute, and worker paths.
Telemetry may observe that engine. It may not become identity, Policy, durable
truth, retry, scheduling, or an authored capability.

## A. Adapt the existing event callback

Expose `events(event => ...)` and translate each event to OpenTelemetry.

This is the smallest diff and the shallowest module. A void callback cannot own
scope lifetime, active context, W3C extraction, child spans, links supplied at
span creation, metrics, or bounded shutdown. Those responsibilities would move
into every Runtime owner or into heuristic event reconstruction. Rejected.

## B. Scoped Runtime observation kernel and explicit adapter

One private Runtime module owns closed `begin -> event -> end` scopes. It emits
Execution Envelope v2 and calls one optional neutral adapter from the same
lifecycle. Existing Runtime owners receive only the closed scope capability.

Generated `createApp` accepts one optional opaque `observability` handle. The
ordinary `@questpie/opentelemetry` package implements the private neutral
interface behind that handle and owns the OpenTelemetry SDK,
semantic-convention mapping, exporters, propagation, queue, flush, and
shutdown. Application Definitions, handlers, Context, and React see nothing
new. This is not a third-party provider SPI.

This creates one real adapter seam: the no-op implementation and the official
OpenTelemetry implementation. It keeps OpenTelemetry types and dependencies out
of core and makes failure isolation testable through the same interface used by
the host. Selected.

## C. Import OpenTelemetry directly in Runtime

Core creates tracers, meters, propagators, and exporters directly. This removes
one adapter type but makes an optional operational integration part of every
installation. SDK lifecycle and semantic-convention churn would become Runtime
reasons to change, while embedded hosts could not replace the adapter in tests.
It also conflicts with the true no-integration path. Rejected.

## Packaging consequence

Candidate B intentionally proposes one additive published package,
`@questpie/opentelemetry`. A `questpie/opentelemetry` subpath would either
install the SDK/exporter graph for every core consumer or turn setup into a
peer-dependency scavenger hunt. The separate package earns its existence by
isolating dependencies, lifecycle, and release compatibility.
