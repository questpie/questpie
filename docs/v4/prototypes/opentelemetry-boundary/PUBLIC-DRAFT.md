# Observe a QUESTPIE application with OpenTelemetry

Status: candidate public documentation; do not publish before ADR-0033 is
Accepted and the implementation tracer passes

OpenTelemetry belongs in the host, not in application handlers. Configure it
once and QUESTPIE observes the Runtime work it already owns: Fetch ingress,
Operations, transactions, compiler-owned PostgreSQL statements, durable work,
and Actions.

## Enable the official adapter

Install the optional adapter beside `questpie`:

```sh
bun add @questpie/opentelemetry
```

Then pass it to the generated App:

```ts
import { createOpenTelemetry } from "@questpie/opentelemetry";
import { createApp } from "#questpie/app";

const telemetry = await createOpenTelemetry();
try {
	const application = await createApp({
		postgres,
		realtime,
		maintenance,
		observability: telemetry,
	});
	try {
		// Mount application.fetch or use application.execution normally.
	} finally {
		await application.close();
	}
} finally {
	await telemetry.close();
}
```

`createOpenTelemetry` accepts only three QUESTPIE options:

```ts
const telemetry = await createOpenTelemetry({
	ingress: { trustBoundary: "continue" }, // or "restart"
	operationalIds: "omit", // or "spans"
	deploymentEnvironment: "production",
});
```

The defaults are `continue`, `omit`, and no deployment environment. Unknown
options fail adapter creation. Raw Call Identity is omitted in both operational
ID modes.

The host owns both objects. Nested cleanup closes telemetry even if App creation
fails. Close the App first so it stops traffic and drains Runtime work. Close
telemetry second so the adapter can flush what remains. Adapter close is
idempotent and resolves within 30 seconds; exporter failure cannot undo Runtime
cleanup or replace its primary error.

`questpie start --telemetry=opentelemetry` performs the same explicit setup for
the CLI host and resolves `@questpie/opentelemetry` from the application root.
Without the flag, QUESTPIE does not load the adapter or start exporter work. A
missing or incompatible package fails before readiness with `QP-START-004`.
Use the documented `OTEL_*` subset for the SDK and OTLP/HTTP exporter; QUESTPIE
configuration files do not hold exporter credentials.

## Keep handlers ordinary

Do not start framework spans inside a Query, Mutation, Action, Job, Policy, or
React component. There is no `ctx.telemetry`. A handler wrapper would observe a
different lifetime from the Runtime owner and could miss admission, rollback,
receipt replay, fencing, cancellation, or cleanup.

The Team Support Desk host configures the adapter once. Its browser uses the
generated client unchanged. Its Mutation can accept a delayed Job and its
worker can retry an Action after restart without copying a trace ID or naming a
span.

If an embedded host already consumes Runtime envelopes through the optional
`events` callback, update it to `ExecutionEventV2` in the same release. Runtime
does not dual-emit v1 and v2. That callback remains a lossy closed event
consumer; it is not an OpenTelemetry adapter and cannot own propagation, active
scope, metrics, or shutdown.

## Understand delayed work

A delayed Job does not keep the request span open. Acceptance records a short
producer span and, in the same successful transaction, stores only the trace
ID, span ID, and flags needed for a later link. Rollback stores nothing, and a
duplicate acceptance keeps the original link.

Each physical attempt starts a new consumer root linked to the acceptance.
Retries and lease recovery are sibling roots. Durable Run identity stays
stable, but Attempt and span identities change. This represents at-least-once
physical work without pretending a delayed Job is one long request.

## Know what leaves the process

The adapter uses an allowlist. Span names contain matched route templates and
static compiled Resource identities. Metrics use bounded Operation,
statement, and outcome dimensions.

QUESTPIE does not export inputs, outputs, raw paths, query strings, headers,
credentials, Principal or Tenant IDs, raw Call Identity, Context, Policy
evidence, Service state, SQL text or parameters, provider payloads, exception
messages, or stack traces. Operational UUIDs are omitted by default and never
appear in metrics.

Invalid `traceparent`, orphan or non-printable `tracestate`, and `tracestate`
over 512 bytes are ignored without failing the request. Baggage is not
accepted. A deployment may restart an otherwise valid incoming trace at its
external trust boundary; handlers cannot choose this.

## Treat telemetry as lossy

PostgreSQL rows, receipts, durable history, and application results remain the
truth. Spans and metrics can be sampled, dropped, delayed, or unavailable. They
cannot authorize a request, change Policy, trigger a retry, settle an ambiguous
effect, or make a commit disappear.

QUESTPIE does not promise a telemetry retention period. The OpenTelemetry SDK
owns finite buffering and export attempts. Your Collector or backend owns
retention. Configure and monitor those systems as deployment infrastructure,
not as application semantics.

## What is not included

This integration does not add browser-side OpenTelemetry, authored spans or
metrics, OTel logs, arbitrary Service instrumentation, a Collector, dashboards,
alerts, or Studio. Instrument an external provider client with its standard
library when you need its HTTP child spans; QUESTPIE observes the semantic
Action but does not intercept arbitrary application `fetch` calls.
