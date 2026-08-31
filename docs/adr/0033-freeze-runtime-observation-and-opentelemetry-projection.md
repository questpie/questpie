# ADR 0033: Freeze Runtime observation and the OpenTelemetry projection

- Status: Proposed
- Date: 2026-08-30

## Context

ADR-0014 accepts one closed Execution Envelope and one observation engine for
direct, Fetch, generated-client, recompute, and worker execution. It names
OpenTelemetry as a consumer but does not define an adapter, signal vocabulary,
propagation, sampling, persistence, or shutdown behavior.

The implementation is narrower than that direction. `ExecutionEventV1` emits
only Runtime and Operation events. Its trace is always null, its event and
execution identifiers are process-local counters, and arbitrary caller
`callId` text becomes its correlation identity and `operationCall` link. A Call
Identity may legally contain email-like or token-like text, so copying it into
telemetry is unsafe. Generated applications expose no observation input.

Public documentation also promises a 4,096-event exporter queue, 30-day
telemetry retention, and 365-day audit retention. QUESTPIE currently owns
neither an exporter nor a telemetry store, and current durable audit evidence
has no retention sweeper. No Accepted decision assigns those values to an
adapter or backend. This decision must remove the unsupported claims rather
than turn invented numbers into architecture; it does not decide future audit
retention.

## Decision

### One scoped observation kernel

Runtime owns one private observation module. Its small interface is a closed
scope start returning a scope with `event`, `end`, and an optional neutral trace
context. The module owns all ordering and makes `end` idempotent. Runtime
owners—not handler wrappers—start and finish scopes:

- generated Fetch/Route ingress and direct root Execution;
- Query, Mutation, and Action execution;
- Mutation transaction and compiler-owned PostgreSQL statements;
- Job acceptance and Job/Reaction physical attempts; and
- Action effects.

The kernel co-emits the closed Execution Envelope and invokes one optional
neutral adapter from the same scope lifecycle. It does not reconstruct spans
from an event stream. A scope owns `run(use)` so its context remains active
across `await`; it also owns explicit parent/link input and same-layer HTTP or
PostgreSQL instrumentation suppression. Fetch scopes end at response-body EOF,
error, or cancellation, not when a streaming `Response` is returned.

The exact private interface and failure containment are frozen by
`docs/v4/prototypes/opentelemetry-boundary/BOUNDARY.md`. Generated Apps accept
only its opaque nominal official handle. This decision does not open the
general host/provider SPI deferred by ADR-0014.

An adapter that re-enters the Runtime callback or throws after one successful
entry records a closed defect diagnostic and is rejected by release evidence;
the first application result remains authoritative. Telemetry defects never
replace it.

The existing `events` callback is a private Runtime/test seam, not part of the
generated App Contract. Its private type advances atomically from
`ExecutionEventV1` to `ExecutionEventV2`; this decision does not add a public
events API. Runtime does not dual-emit v1 and v2, and there is no compatibility
adapter. A callback fault disables that callback for the Runtime instance and
cannot change application work. The OpenTelemetry adapter does not consume this
callback or reconstruct scope state from it; both projections are emitted by
the same private kernel.

The two concrete adapters are the built-in no-op and the official
OpenTelemetry adapter. The no-op allocates no SDK object, starts no task,
persists no trace context, and adds no shutdown wait.

### Execution Envelope v2

Envelope v1 bytes and digests remain historical evidence. Runtime emits only
v2 after this vertical, including through its private `events` seam. V2 is a
closed append-only event family with:

- a cryptographically random RFC 4122 UUIDv4 `runtimeInstanceId`, created once
  for each successful Runtime process start and never persisted or reused;
- unsigned 64-bit decimal `eventSequence` and `executionSequence` counters that
  each start at 1 and reset only with a new Runtime instance;
- opaque `eventId = runtimeInstanceId + ":event:" + eventSequence` and
  `executionId = runtimeInstanceId + ":execution:" + executionSequence`;
- application identity and exact Runtime Build digest;
- RFC 3339 UTC millisecond `occurredAt` from the Runtime-owned wall clock;
- exact Principal kind (`anonymous`, `service`, or `user`) and Authority class
  (`ordinary`), never Principal or Tenant identity;
- an optional neutral trace context containing exactly a 16-byte trace ID,
  8-byte span ID, and one byte of trace flags; and
- closed safe links for artifact, Operation, canonical nonzero PostgreSQL
  `xid8` transaction text, Dispatch, Durable Run, Physical Attempt, and Effect
  identities.

Only a root Execution allocates an `executionSequence` and `executionId`.
Every nested Operation, transaction, statement, acceptance, and effect scope
receives that exact identity. Runtime lifecycle records outside an Execution
carry `executionId: null` and `executionSequence: null`; a physical durable
Attempt owns a fresh worker root Execution.

Raw Call Identity, generic `correlationId`, request input/output, headers,
credentials, database URLs, Context, Policy identity/evidence, Service state,
SQL text/parameters, provider payload, exception message, and stack are absent.
Static Resource identities and framework-owned operational UUIDs are not caller
payloads, but the OpenTelemetry projection may still omit the UUIDs.

Each scope start, event, and end value belongs to a closed versioned union.
Unknown kinds, unbounded strings, or adapter-supplied Envelope facts are
invalid. The Runtime, not the adapter, assigns Envelope identity and semantic
outcome.

The canonical encoding is the repository canonical JSON line encoder with
lexicographically ordered object keys. A zero or invalid Runtime instance UUID
fails startup before readiness. Counter exhaustion disables new observation
materialization for that instance without failing application work; existing
scopes still end best-effort. Sequence, not wall time, owns within-instance
order. Cross-instance order is deliberately undefined.

One canonical Envelope line is bounded to 64 KiB and one Execution emits at
most 2,048 Envelope records. Closed compiler-bounded fields keep ordinary
records below the byte bound. A record beyond either bound is omitted from the
lossy Envelope callback without changing work; it increments the bounded
Envelope-limit diagnostic whether or not an adapter is active. Adapter scope
and signal bounds remain the separate exact bounds in `BOUNDARY.md` and
`SIGNALS.md`.
Runtime lifecycle records without an Execution do not consume an Execution
budget.

### Generated host interface

Generated `CreateAppInput` gains one optional `observability` member using the
opaque `QuestpieObservability` type. Only `@questpie/opentelemetry` and the
repository-private test adapter can construct it; a structural third-party
object is rejected before readiness. It is host configuration, not application
Context, a Definition, Service, compiler Package, plugin, or ambient global.

Opacity is API discipline, not a security or authorization boundary. A hostile
JavaScript host can reflect on process objects and is already inside the trusted
deployment boundary. Runtime still validates format, version, returned context,
and every call, so such a host cannot make telemetry authoritative or weaken
Policy; third-party construction remains unsupported rather than claimed
cryptographically impossible.

The embedded spelling is:

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
		// Serve application.fetch and run normal application work.
	} finally {
		await application.close();
	}
} finally {
	await telemetry.close();
}
```

The host owns the adapter and closes it after the application. Nested cleanup
also closes telemetry when App creation fails and preserves an application
close failure as the primary error. Adapter close is idempotent, concurrent
calls share one promise, post-start export/flush/shutdown failures are
self-diagnostic only, and close resolves within 30 seconds.

`questpie start --telemetry=opentelemetry` explicitly resolves the installed
official adapter from the application root before creating the generated app.
It is the only accepted telemetry flag value. Missing package, incompatible
interface, or invalid explicit SDK configuration fails with `QP-START-004`
before readiness and traffic. The CLI uses the same nested cleanup sequence.
Without the flag it does not load the package.

The exact adapter options, supported `OTEL_*` subset, bounds, missing-package
diagnostic, close behavior, and peer compatibility are frozen by `BOUNDARY.md`.
`questpie.json` stores no endpoint or credential.

`@questpie/opentelemetry` is an ordinary second published package. It owns the
OpenTelemetry API/SDK dependency graph, semantic-convention mapping, Resource,
sampler, processors, exporters, queue, propagation, flush, and shutdown. This
is an additive public release decision: the beta release guide, package
manifest, release dry-run, clean-install contract, and repository codebase
routing gain one optional adapter artifact. It does not supersede an Accepted
ADR package clause. Core `questpie` retains no OpenTelemetry dependency.

### W3C propagation and trust

The official adapter extracts only W3C `traceparent` and `tracestate` at
QUESTPIE-owned Fetch ingress. Invalid `traceparent` and orphan `tracestate` are
discarded without failing the request. The same applies to non-printable
`tracestate` or one over 512 bytes. A valid extraction is one explicit frozen
value carried into the ingress start; the interface does not rely on object
identity or a side channel. Baggage is not accepted or injected.

Valid incoming context continues by default. One deployment-level adapter
option may restart the trace at an external trust boundary and link the new
server span to the valid incoming context. Restart discards incoming
`tracestate`. This option is static host configuration, never handler input or
authorization.

Ingress starts before Context Resolution, so its Principal kind is explicitly
null. The child Execution starts only after resolution and carries the closed
Principal kind. HTTP method normalization, matched/unmatched shape, scheme,
status, SQL verb and statement identity, execution entry, durable link role and
attempt facts are closed start/end union members rather than free attributes.

QUESTPIE owns propagation only for transports it owns. It owns generated Fetch
ingress and the semantic Operation/PostgreSQL/durable spans below. Standard
instrumentation owns arbitrary outbound HTTP and non-framework database
clients. The adapter suppresses duplicate same-layer instrumentation on
QUESTPIE-owned Fetch and PostgreSQL paths. QUESTPIE does not intercept arbitrary
application `fetch` calls.

### Durable links

A delayed Job or committed-fact Reaction cannot keep its accepting Mutation
span open. Explicit Job acceptance and Reaction committed-fact acceptance each
use a short `PRODUCER` span inside the accepting Execution or Mutation
transaction. The first successful run-creation transaction stores only nullable
trace ID, span ID, and flags beside the Durable Run. It stores no `tracestate`,
baggage, exporter bytes, SDK object, or sampling configuration.

Exact duplicate Job acceptance and duplicate or replayed Reaction dispatch
retain the first stored context. Rollback stores none. Existing rows and
no-adapter acceptance carry null. Each Physical Attempt starts a new `CONSUMER`
root with the accepted context supplied as a link at span creation. Retry,
lease recovery, and reclaim are sibling roots: Run and Dispatch identity stay
stable while Attempt and span identity change. Effect spans are children of the
current attempt; stable Effect Identity never merges physical calls.

The three additive nullable columns belong to internal protocol v8. V7 to v8 is
an explicit non-rolling cutover because the exact catalog verifier makes mixed
v7/v8 Runtime operation impossible. Every v7 Runtime must stop before
`questpie migration apply --allow-non-rolling-protocol-v8`; v8 refuses the v7
catalog before migration, and v7 refuses v8. Existing rows decode null. An old
Runtime can therefore neither overwrite nor erase v8 context.

In-place downgrade to v7 is unsupported; restore a pre-cutover database or ship
a forward v8 repair. Pruning and backup/restore preserve the three context
fields exactly. Duplicate, rollback, old-row, retry/reclaim, restore, and
multiple-v8-instance evidence must pass before release. Trace context is
correlation metadata and never claim or fencing authority.

### Exact signal projection

`docs/v4/prototypes/opentelemetry-boundary/SIGNALS.md` is the normative signal
projection v1. It freezes instrumentation scope, Semantic Conventions 1.44.0
binding, Resource mapping, span parent/link graph, names, kinds, status and
attribute allowlists, span events and bounds, metric names, types, units,
histogram boundaries and dimensions, and operational-ID behavior.

Operational UUIDs are omitted by default from OpenTelemetry spans and span
events and forbidden on metrics. A single adapter option may include
framework-owned operational UUIDs on spans and span events. Raw `callId` is
always omitted; this decision does not add HMAC correlation.

### Failure, cancellation, retry, and retention

Observation is lossy and non-authoritative. After successful startup, adapter,
processor, exporter, Collector, queue, flush, or shutdown failure cannot change
an application result, Policy decision, PostgreSQL statement, commit,
settlement, cancellation, deadline, retry, fencing, or Runtime close outcome.
The batch span queue defaults to 2,048 and accepts a validated bound of 1
through 65,536. New finished spans are dropped when full; application work
never waits for queue space. Exact buffer, export, metric interval, and close
bounds live in `BOUNDARY.md`. Observation failures never become declared
Operation errors or retry signals.

Cancellation and deadline finish the owning semantic scopes with bounded
outcomes; they do not keep background telemetry work attached to the cancelled
Execution. QUESTPIE does not retry application work for telemetry delivery.
The per-scope outcome/event matrix in `BOUNDARY.md` is exact: `retry` and
`fenced` belong only to physical Attempts, ambiguity only to Mutation, Action,
or Action effect, and a committed transaction stays `ok` even if its outer
Mutation later becomes post-commit `ambiguous`. Observation records those
semantic outcomes and never initiates them.

QUESTPIE owns no telemetry retention period. Adapter/SDK configuration owns
finite in-process buffering and export attempts. The Collector/backend owns
retention. The current public 4,096-event queue, 30-day telemetry retention, and
365-day audit retention claims are removed after acceptance. A backend may
retain signals for any deployment-selected duration, but it is deployment
configuration, not framework behavior. Durable audit retention remains a
separate owner decision and this ADR promises no value for it.

### Tracer and release evidence

Team Support Desk proves the zero-author-instrumentation browser -> Mutation ->
Job -> Action -> restart journey with an in-memory exporter. React and generated
client code contain no OpenTelemetry import or manual context handling.

Collaboration proves invalid propagation, raw-call sentinel absence, Policy
nondisclosure, hostile adapters, duplicate acceptance, rollback, old rows,
retry/reclaim sibling links, fencing, two Runtime instances, and identical
PostgreSQL/public outcomes with and without telemetry.

A loopback OTLP tracer packs and installs both public packages, validates OTel
Resource facts, fails invalid explicit startup config before readiness, cuts
the receiver during work, and proves close ordering plus bounded flush. Release
requires deterministic package archives, isolated install/import/build,
declaration digests, strict dependency checks, PostgreSQL 17, Firefox,
`quality:release`, docs build, and independent Standards and Spec review.

## Consequences

- Application authors get useful traces and metrics by configuring the host
  once. They cannot make Policy or business behavior depend on telemetry.
- Runtime owners expose semantic lifecycle facts once; Envelope and OTel cannot
  drift into parallel truth models.
- A second public package and a new internal protocol increase release and
  compatibility work. That cost buys dependency isolation and durable async
  correlation.
- Exact arbitrary Call Identity correlation is intentionally lost from
  telemetry. Operators correlate through trace context and safe framework
  identities instead.
- Backend retention and dashboards remain deployment concerns.

## Supersession ledger

This decision supersedes ADR-0014 only for the Execution Envelope/event schema
and fixed v1 digest, replacing the private Runtime emitter/type with v2 and
adding no generated/public events callback. In particular, v2 narrows ADR-0014
and the pre-projection SPEC
language that implied Principal/Tenant, Policy, idempotency, error, log, and
audit identities were always safe correlation fields; only the exact v2
allowlist survives. The opaque official adapter input does not reopen
ADR-0014's general host/provider SPI deferral. It adds the exact OpenTelemetry
projection and one additive optional public package with corresponding release
and public-documentation routing updates. It also supersedes the repository
codebase-routing statement that `questpie` is the only published package:
`questpie` remains the sole application authoring/Runtime package, while
`@questpie/opentelemetry` is one separately versioned, exact-peer optional
official integration package. This is not a generic integration-package rule.

It preserves ADR-0014 Runtime, Operation, generated App, direct/Fetch/worker,
readiness, drain, nondisclosure, and compatibility ownership; ADR-0023
post-commit outcomes; ADR-0013 and ADR-0026 durable identity, acceptance,
attempt, retry, and fencing semantics; ADR-0017 multi-instance authority; and
ADR-0031 lifecycle ownership. PostgreSQL and canonical artifacts remain durable
truth. Studio remains deferred by ADR-0024.

## Rejected alternatives

- Exposing the existing void event sink as the public observation interface.
- Importing the OpenTelemetry SDK or arbitrary instrumentation into Runtime
  core.
- `ctx.telemetry`, authored spans/metrics/loggers, handler wrappers, or a
  general observation plugin registry.
- One long-lived span across a delayed Run, parent-chaining retries, or deriving
  durable identity from trace/span identity.
- Raw `callId`, Principal/Tenant identity, payload, SQL, Policy evidence, error
  text, stack, baggage, or arbitrary headers in signals.
- Shipping the adapter under a core subpath with mandatory SDK dependencies.
- A QUESTPIE telemetry store, Collector distribution, vendor backend, Studio,
  dashboard, alert DSL, or OTel logs in this vertical.
