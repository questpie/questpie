# QUESTPIE v4 OpenTelemetry workbench

- Status: research-only proposal; not product authority
- Date: 2026-08-28
- Consumer: Team Support Desk HTTP → Mutation → Job → Action journey
- Rule: telemetry observes QUESTPIE truth; it never creates identity, Authority,
  Policy, transaction, retry, cancellation, or durable truth

## 1. Starting point

ADR-0014 accepts a closed Execution Envelope for safe append-only Runtime
events. `SPEC.md` names OpenTelemetry exporters as consumers. Credentials,
database URLs, payloads, Policy evidence, serialized Context, Service state,
secrets, and stack traces are excluded.

The implementation is narrower:

- [`application/events.ts`](../../../../packages/runtime/src/application/events.ts)
  emits only Runtime and Operation events;
- `ExecutionEventV1.envelope.traceId` is always `null`;
- raw caller `callId` currently becomes `correlationId` and an `operationCall`
  link, which is unsafe because ADR-0023 permits arbitrary validated text;
- event and Execution IDs are process-local sequences and collide across
  instances;
- generated applications do not bind an observation sink;
- PostgreSQL durable history separately owns authoritative Run transitions.

The repair is one Runtime observation kernel. A scoped `begin → event → end`
interface co-emits the closed Envelope and optional signal bridge, so child
spans, propagation, and durable links share one lifecycle. A void event sink is
insufficient. OTel remains a lossy projection and PostgreSQL remains durable
operational truth.

The slice versions the Envelope: an opaque UUID `eventId`, opaque UUID
`executionId`, one `runtimeInstanceId`, instance-scoped monotonic `sequence`,
safe correlation references, and optional trace context. It does not add
`ctx.telemetry`, arbitrary event payloads, or another event store.

## 2. Identity model

| Identity               | Stability and owner                  | OTel projection                                  |
| ---------------------- | ------------------------------------ | ------------------------------------------------ |
| Execution              | One Runtime root                     | Entry/root span boundary                         |
| Mutation `callId`      | Stable caller material for replay    | Omit, or deployment-HMAC on spans only           |
| PostgreSQL transaction | One transaction                      | Attribute after transaction ID exists            |
| Dispatch               | One accepted durable intent          | Acceptance/attempt span attribute                |
| Durable Run            | One logical execution across retries | Attribute; never a long-lived span               |
| Physical Attempt       | One leased handler invocation        | One span; changes on retry/reclaim               |
| Effect Identity        | One logical external effect          | Action/effect attribute, never Span ID           |
| Trace ID               | SDK/propagator causal graph          | Observational; may be absent/restarted/unsampled |
| Span ID                | One valid span context               | Observational; exists even when non-recording    |

No OTel value may change a result, Policy decision, idempotency identity,
acceptance, scheduler choice, retry, deadline, or cancellation. No QUESTPIE
identity derives a Trace/Span ID or vice versa.

Raw `callId` disappears from Envelope v2 and OTel. When a deployment configures
a telemetry HMAC key, a domain-separated digest may correlate it; otherwise it
is omitted. Exact IDs stay only in protected operational surfaces that own them.

## 3. Automatic signal vertical

Authors should receive useful telemetry without wrapping handlers.

### Spans

| Span                              | Parent or link                         | Safe content                                    |
| --------------------------------- | -------------------------------------- | ----------------------------------------------- |
| HTTP ingress/Route                | Valid W3C parent, else root            | method, route template, scheme, status          |
| Direct Execution                  | Current valid local context, else root | entry kind                                      |
| Query/Mutation/Action             | Execution                              | Resource identity, bounded outcome/error code   |
| Mutation transaction              | Mutation                               | outcome; transaction ID after assignment        |
| Framework PostgreSQL statement    | Operation/transaction                  | fixed statement identity and operation          |
| Job acceptance (`PRODUCER`)       | Owning Mutation/Execution              | Job identity and optional operational IDs       |
| Job/Reaction attempt (`CONSUMER`) | New root linked at creation            | Resource, attempt number, outcome; optional IDs |
| Action/effect                     | Operation/Attempt                      | Action identity, outcome; optional Effect ID    |

Application/build/deployment facts belong on the OTel Resource, not every span.
Span names use artifact-bounded identities and matched route templates, never
row IDs, raw paths, inputs, SQL literals, or error messages.

### Span events

Events cover Context completion, receipt recovery, commit, post-commit
ambiguity, durable acceptance, cancellation, deadline, heartbeat failure,
fencing, retry scheduling, terminal transition, and Action ambiguity.

Default OTel does **not** emit Policy identity or `allowed`/`denied`: candidate
and row verdicts can distinguish absent from unauthorized. It exports only the
final nondisclosing Operation outcome. Detailed Policy phases belong, if ever,
to a separately protected local diagnostic surface.

### Metrics

- Operation count, duration, in-flight, and outcome by Operation kind, Resource
  identity, and bounded error code;
- fixed statement duration/outcome by compiler-owned statement identity;
- Job accepted count, queue delay, attempt duration/outcome, retry,
  cancellation, fencing, and lease expiry by durable Resource identity;
- Action duration/outcome and Runtime readiness/active roots/worker claims;
- observation queue drops, available again after exporter recovery.

Metrics never contain Principal/Tenant IDs, `callId`, transaction, Dispatch,
Run, Attempt, Effect, trace, span, cursor, URL, SQL text, or error text. Units
use OTel metadata, not metric names.

## 4. Transport ownership and W3C context

Fetch ingress extracts only W3C `traceparent` and `tracestate`. Invalid
`traceparent` is ignored and orphaned `tracestate` is discarded without request
failure. `baggage` is not accepted in slice 1.

The default continues valid context across a trusted deployment edge. One
deployment-level option restarts traces at a declared external trust boundary
and links to the valid incoming context. This is never per-handler logic or
authorization.

QUESTPIE owns spans and propagation only for transports it owns:

- QUESTPIE owns generated `app.fetch`, semantic Operations, and its PostgreSQL
  Pool/statement bridge;
- standard HTTP instrumentation owns arbitrary Service/Action provider calls;
- standard instrumentation owns non-framework database clients;
- the adapter suppresses or disables duplicate same-layer Bun/`pg`
  instrumentation for QUESTPIE-owned ingress and Pool paths.

An Action's semantic span is framework-owned; a provider HTTP child span and
W3C injection require standard client instrumentation or an explicitly
instrumented Service. QUESTPIE does not intercept arbitrary `fetch`.

W3C forbids PII in trace fields and permits restart at security boundaries
([Trace Context](https://www.w3.org/TR/trace-context/)). OTel extraction must
not throw on invalid input
([Propagators API](https://opentelemetry.io/docs/specs/otel/context/api-propagators/)).

## 5. Durable persistence and sibling retries

A delayed Job cannot keep a request span open.

1. Acceptance creates a short `PRODUCER` span inside its owner.
2. The same first-acceptance transaction stores only nullable trace ID (16
   bytes), span ID (8 bytes), and flags (1 byte). It stores no `tracestate`,
   baggage, exporter bytes, or SDK object.
3. Exact duplicate acceptance keeps the first creation context; it never
   overwrites it. Rollback stores none.
4. Every Physical Attempt starts a new `CONSUMER` root span with its acceptance
   link supplied at span creation so sampling can inspect it.
5. Retry and lease-recovery attempts are siblings: stable Run/Dispatch,
   distinct Attempt and Span IDs. An effect span is a child of its current
   attempt; stable Effect Identity does not merge physical calls.

With no active SDK/valid context, acceptance stores null and attempts remain
valid unlinked roots. Links match OTel asynchronous causation guidance
([OTel overview](https://opentelemetry.io/docs/specs/otel/overview/),
[messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/),
[Tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)).

Persistence needs additive nullable columns and a new internal protocol.
Rolling proof must cover old/new claims, retry, pruning, and restore; old rows
mean “no link.” The context is correlation metadata, never claim authority.

## 6. Privacy, cardinality, and redaction

The OTel projection is an allowlist, not “serialize the Envelope.”

Default HTTP span attributes are exactly `http.request.method`, matched
`http.route`, `url.scheme`, and `http.response.status_code`. Raw target, query,
headers, user agent, peer address, and body are excluded.

Default custom attributes include bounded Resource/Operation/outcome codes.
Framework-generated operational UUIDs are correlatable data: permitted on
spans/events only and configurable off, never metrics. Exact Principal/Tenant
IDs are omitted. Caller `callId` is omitted or HMACed. Inputs/outputs, Context,
Policy evidence, Service state, SQL parameters, non-parameterized SQL, provider
payloads, exception messages, and stacks are absent. Every string, attribute
set, event count, and queue has a bound.

Compiler-owned statements can emit safe summaries without parsing dynamic SQL.
OTel recommends low-cardinality summaries and rejects unsanitized dynamic SQL
by default ([database spans](https://opentelemetry.io/docs/specs/semconv/db/database-spans/)).
High-cardinality metric attributes are opt-in
([attribute levels](https://opentelemetry.io/docs/specs/semconv/general/attribute-requirement-level/)).
Collector redaction is defense in depth
([sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)).

## 7. Activation, configuration, and lifecycle

Three concrete owners:

1. The Runtime observation kernel owns semantic timing and the closed Envelope.
2. A neutral optional bridge owns scoped signal calls and trace-context bytes.
3. The ordinary npm integration `questpie-opentelemetry` owns the OTel API/SDK,
   Resource, sampler, processors, exporters, bounded flush, and shutdown.

It is not a compiler Package, Definition, Service, plugin, or ambient capability.
Installation does nothing. Activation is explicit on both paths:

- CLI: `questpie start --telemetry=opentelemetry` loads the installed integration
  before the generated app, validates static config, and passes its bridge;
- embedded: the host creates the integration and passes its neutral bridge in
  generated `createApp({ observability })`, then closes app and integration.

`questpie.json` contains no endpoint, credential, sampler secret, or environment.
Standard `OTEL_*` variables own SDK/exporter configuration. A small typed Runtime
input owns only QUESTPIE trust-boundary, operational-ID, and call-ID-HMAC choices.
The npm prefix conveys no trust; documentation names official integrations.

OTel Resource mapping:

- `service.name`: application identity unless deployment overrides it;
- `service.version`: actual release/package version only;
- `service.instance.id`: deployment instance identity, never authority;
- `deployment.environment.name`: deployment input;
- `questpie.runtime_build.digest`: exact Runtime Build digest.

See [Resource conventions](https://opentelemetry.io/docs/specs/semconv/resource/)
and [deployment attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/).

## 8. No-SDK and failure behavior

Absent integration uses a true no-op scope, persists null trace context, starts
no exporter tasks, and adds no shutdown wait. This follows OTel's library/no-op
contracts ([libraries](https://opentelemetry.io/docs/concepts/instrumentation/libraries/),
[Metrics No-Op](https://opentelemetry.io/docs/specs/otel/metrics/noop/)).

Explicitly enabled invalid static configuration or SDK initialization fails
before readiness and traffic. After successful startup, bridge, processor,
exporter, Collector, flush, or shutdown failures never change application
semantics. Queues are finite. Close order is: stop traffic, drain/close the app,
then bounded telemetry flush/shutdown; timeout never delays Runtime cleanup.
OTel requires runtime/exporter errors not to escape into application code
([error handling](https://opentelemetry.io/docs/specs/otel/error-handling/)).

## 9. Hostile proof matrix

| Hostile                               | Required result                                              |
| ------------------------------------- | ------------------------------------------------------------ |
| No SDK                                | Same results/SQL/shutdown; null persisted context            |
| Invalid explicit startup config       | Fail before readiness and traffic                            |
| Throwing bridge or Collector outage   | Request, commit, settlement, close unchanged                 |
| Flush timeout                         | Runtime cleanup completes before bounded telemetry wait ends |
| Invalid traceparent/orphan tracestate | Discarded without request failure                            |
| Valid remote unsampled context        | Propagated/linked without semantic change                    |
| Link timing                           | Acceptance link exists at attempt span creation/sampling     |
| Duplicate acceptance                  | First context retained; retry cannot overwrite               |
| Rollback/old row                      | No context stored / attempt remains valid unlinked           |
| `callId` containing email/token       | Raw value absent from Envelope and all signals               |
| Policy absent vs denied               | Indistinguishable exported outcome                           |
| Direct vs network                     | Same semantic spans after ingress adapter                    |
| Commit response loss                  | Correlated without claiming rollback                         |
| Restart/retry/reclaim                 | Sibling roots; stable Run, distinct Attempt/Span IDs         |
| Stale worker/effect ambiguity         | Fenced/ambiguous only; no false success/exactly-once         |
| Cardinality overflow                  | Compile-bounded metric dimensions and finite overflow        |
| Auto-instrumented Bun/pg/fetch        | No duplicate same-layer spans                                |
| Ten instances                         | Unique event scope; instance identity remains diagnostic     |

Tests inspect an in-memory exporter, Execution Envelope, and PostgreSQL truth.
They never assert a vendor UI.

## 10. Migration and deletion test

The work must replace unsafe v1 raw-call correlation, operation-only timing,
fixture span wrappers, and manual HTTP → receipt → Run/Attempt → Effect
correlation. It retains the Envelope as the safe Runtime event contract and
PostgreSQL history as durable truth.

If Team Support Desk authors must name spans, copy trace IDs, manually propagate
Job context, or wrap generated Operations, the abstraction fails.

## 11. Staged tracer-led slices

1. Observation scopes, Envelope v2, no-op/in-memory bridges, ingress/direct and
   Operation spans, safe metrics, v1 leak regression.
2. Transaction/fixed-statement spans, nondisclosing outcomes, cardinality and
   duplicate-instrumentation hostiles.
3. Nullable acceptance context and sibling Job/Reaction attempts across delay,
   retry, fencing, crash, old/new runtime, and multi-instance recovery.
4. Action/effect spans plus standard provider HTTP integration and ambiguity.
5. Explicit CLI/embedded `questpie-opentelemetry`, OTLP configuration, bounded
   lifecycle, release verification, and public operations guide.

Slice 3 is a Kernel/internal-protocol change. Envelope v2 is a contract change.
Other slices are Product projections unless proof reveals a new guarantee.

## 12. Non-goals

- authored Telemetry/Metric/Span/logger Resources or `ctx.telemetry`;
- arbitrary local capture, handler source instrumentation, or raw payloads;
- telemetry-backed Policy, audit, readiness, retry, rate limit, or scheduling;
- vendor backend, Collector distribution, dashboard, or alert DSL;
- one span for a delayed Run, retry parent chains, or identity aliasing;
- exported spans as complete, ordered, exactly-once, or durable truth;
- automatic instrumentation of arbitrary user Services;
- OTel LogRecord emission before a structured-logging consumer exists.

## 13. Approval questions

1. Approve one scoped observation kernel that co-emits Envelope + bridge, while
   PostgreSQL durable history remains authoritative?
2. Approve Envelope v2 to remove raw `callId`, scope IDs globally, and carry
   optional trace context?
3. Approve new-root linked attempts with retries as siblings?
4. Persist only first-acceptance trace ID/span ID/flags transactionally?
5. Continue valid W3C context by default, with one deployment restart option
   and no baggage?
6. Omit Principal/Tenant IDs; omit or HMAC `callId`; keep operational UUIDs
   configurable on spans/events and forbidden on metrics?
7. Approve the explicit CLI and embedded activation/lifecycle above?
8. Use `OTEL_*` for SDK/exporters and typed Runtime input only for QUESTPIE
   privacy/trust-boundary choices?
9. Start with traces, span events, and metrics; defer OTel logs?

## 14. Primary references

- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OTel overview](https://opentelemetry.io/docs/specs/otel/overview/)
- [Tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [Database spans](https://opentelemetry.io/docs/specs/semconv/db/database-spans/)
- [Messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [Sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [Error handling](https://opentelemetry.io/docs/specs/otel/error-handling/)
