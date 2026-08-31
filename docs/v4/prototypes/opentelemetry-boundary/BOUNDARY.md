# Runtime observation interface v1

Status: normative candidate evidence for Proposed ADR-0033

## Private neutral interface and public opaque handle

ADR-0033 does not open a provider SPI. The `questpie` package owns and publicly
exports the opaque nominal `QuestpieObservability` type. Generated
`CreateAppInput` imports that type from `questpie`; a generated declaration
never imports the optional adapter package. `@questpie/opentelemetry` implements
the type, and the repository-private test adapter receives a private
construction seam. Third-party structural objects are rejected before
readiness.

This nominal boundary defines supported API provenance; it is not a sandbox or
authorization claim against a hostile in-process JavaScript host. Runtime
validates the neutral interface and all returned facts even after the brand
check. A reflective forgery is an unsupported host defect and still receives no
application authority.

The private interface below is the implementation contract between core and
the official package. It receives closed, already-redacted semantic facts. It
cannot call Runtime, authorize work, change an outcome, or attach arbitrary
data.

```ts
export interface RuntimeObservabilityV1 {
	readonly format: "questpie.runtime-observability";
	readonly version: 1;
	extract(
		input: Readonly<{
			traceparent: string | null;
			tracestate: string | null;
		}>,
	): ExtractedTraceContextV1 | null;
	begin(
		input: ObservationStartV1 &
			Readonly<{ execution: ExecutionIdentityV2 | null }>,
	): ObservationScopeV1;
}

export type ExecutionIdentityV2 = Readonly<{
	executionId: string;
	executionSequence: string; // unsigned 64-bit canonical decimal
}>;

export interface ObservationScopeV1 {
	readonly context: NeutralTraceContextV1 | null;
	run<Result>(use: () => Result | Promise<Result>): Promise<Result>;
	event(input: ObservationEventV1): void;
	end(input: ObservationEndV1): void;
}

export type ExtractedTraceContextV1 = Readonly<{
	context: NeutralTraceContextV1;
	tracestate: string | null;
}>;

export type NeutralTraceContextV1 = Readonly<{
	format: "questpie.trace-context";
	version: 1;
	traceId: Uint8Array; // exactly 16 bytes, not all zero
	spanId: Uint8Array; // exactly 8 bytes, not all zero
	flags: number; // integer 0..255
}>;
```

`ObservationStartV1`, `ObservationEventV1`, and `ObservationEndV1` are exact
closed discriminated unions generated from the signal projection. A start
names its explicit parent or creation-time links and whether HTTP or PostgreSQL
auto-instrumentation is suppressed for that scope. Their string members are
compiler-owned identities or enumerated codes. They contain no free attributes
or caller/application payload.

The start union has these exact variants; a field absent from a row is not
admitted on that variant:

| `kind`                           | Required semantic fields                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`                        | service Principal, root                                                                                                                  |
| `fetch`                          | generated-operation/unmatched, normalized method, scheme, null Principal, ingress trace plan, HTTP suppress                              |
| `route`                          | normalized method, matched template, scheme, null Principal, ingress trace plan, HTTP suppress                                           |
| `execution`                      | entry, resolved Principal, trace plan                                                                                                    |
| `query`/`mutation`/`action`      | entry, Resource identity, resolved Principal, active parent                                                                              |
| `transaction`                    | resolved Principal, active parent, optional canonical nonzero PostgreSQL `xid8` decimal text                                             |
| `postgresql`                     | SQL verb, statement identity, resolved Principal, active parent, PostgreSQL suppress                                                     |
| `job.accept`/`reaction.accept`   | Resource identity, resolved Principal, active parent, optional Dispatch/Run UUIDs                                                        |
| `job.attempt`/`reaction.attempt` | Resource identity, resolved Principal, attempt number, root plus zero-or-one stored acceptance link, optional Dispatch/Run/Attempt UUIDs |
| `action.effect`                  | Resource identity, resolved Principal, active parent, optional Effect UUID                                                               |

The trace plan is exactly `active-parent`, `remote-parent` with the complete
validated extraction result, `root`, or `root-with-links` with exactly one
neutral context. An ingress `continue` uses `remote-parent`; `restart` uses
`root-with-links` and intentionally drops incoming `tracestate` after deriving
the link. A durable attempt uses `root-with-links` only when its first successful
acceptance stored a non-null context; a null old-row or no-adapter context uses
`root` and creates no link. It never fabricates a zero trace or span identity.
No single ambiguous `traceContext` slot exists.

The event union has payload only where the signal projection requires it:
transaction ambiguity/commit may carry canonical nonzero PostgreSQL `xid8` text; durable acceptance
may carry Dispatch/Run UUIDs; fencing may carry Attempt UUID; retry requires
attempt number and delay milliseconds; terminal requires outcome and may carry
a closed error code; Action ambiguity may carry Effect UUID. The other four
events are payloadless. The end union repeats its scope `kind`, always carries
the closed outcome and optional closed error code, and requires HTTP response
status for `fetch` and `route`. The kernel rejects a mismatched end kind.

Events are admitted only on these scopes:

| Scope                         | Events                                    |
| ----------------------------- | ----------------------------------------- |
| `execution`                   | context completed, cancellation, deadline |
| `mutation`                    | receipt replayed, post-commit ambiguity   |
| `transaction`                 | transaction committed                     |
| Job/Reaction acceptance       | durable accepted                          |
| Job/Reaction physical attempt | fenced, retry scheduled, terminal         |
| `action.effect`               | Action ambiguity                          |

Every other scope is eventless. End outcomes are also closed by scope:

| Scope                                  | Allowed outcomes                                   |
| -------------------------------------- | -------------------------------------------------- |
| Runtime, Fetch/Route, transaction, SQL | `ok`, `framework_error`, `cancelled`, `deadline`   |
| Execution, Query, acceptance           | the preceding values plus `declared_error`         |
| Mutation, Action, Action effect        | the preceding values plus `ambiguous`              |
| Job/Reaction attempt                   | ordinary/declared values plus `fenced` and `retry` |

Telemetry never creates cancellation, deadline, ambiguity, fencing, or retry;
it records an outcome already owned by the Runtime semantic boundary. A
committed transaction ends `ok` even when the outer Mutation later ends
`ambiguous`. Pre-commit cancellation/deadline retains the accepted rollback
semantics.

The executable copy of these exact unions is
`observation-kernel/kernel.ts`. Its compile/test gate constructs every one of
the 14 projected span-start shapes plus Runtime lifecycle, populated PostgreSQL
and retry variants, both ingress trace plans, and HTTP EOF completion. This is
the candidate's generated type feasibility proof, not a second Runtime
interface.

The kernel has a distinct root-Execution entry that allocates one nominal,
Runtime-owned execution identity. Nested scope starts require the exact issued
live object; structurally equal clones, ended identities, and non-Execution
root starts are rejected. Runtime lifecycle records may explicitly carry no
Execution; durable physical attempts enter through a fresh worker root.

Fetch and Route ingress always carry null Execution identity because they begin
before Context Resolution and may remain open through streamed-response EOF.
Their child Execution allocates the identity used by Operation and other nested
semantic scopes. Runtime lifecycle also carries null; every other start variant
requires its owning local Execution identity.

Runtime validates the opaque handle, `format`, `version`, every returned
trace-context byte, and every adapter call. Unknown versions fail generated-App
creation before readiness. Extraction failure behaves as absent context. Event
or end failure disables further signals for that scope. Those failures never
fail or retry application work.

`scope.run(use)` makes that scope's context active across `await` and supplies
the declared same-layer suppression. The official adapter must invoke `use`
exactly once. Core tracks entry: a pre-entry adapter fault runs `use` once under
the null scope, while callback failure is preserved unchanged. Calling twice or
throwing after a successful callback records a closed adapter-defect diagnostic
but returns the first callback result unchanged. The hostile host tracer treats
that diagnostic as a release failure; application work remains fail-open.
Arbitrary adapters are not accepted input.

`end` is idempotent inside the kernel. Runtime ends every scope in `finally` and
ignores later calls. A saved adapter callback cannot enter after the adapter
returns or fails before entry, and adapter-returned property getters are inside
the same fault containment. The official adapter is concurrency-safe. Runtime
serializes calls for one scope but may use different scopes concurrently.

Fetch extraction projects only the two named header values above. Invalid
`traceparent`, orphan `tracestate`, non-printable `tracestate`, or `tracestate`
over 512 bytes returns null. A successful extraction remains one frozen value
from `extract` through the `remote-parent` fetch/route start; no side channel or
object-identity correlation is used. A SERVER scope begins before
Context Resolution and ends only when the response body reaches EOF, errors, or
is cancelled; returning a streaming `Response` does not end it. Host abort ends
the scope once immediately and cancels the underlying reader best-effort; it
does not await a non-cooperative reader. PostgreSQL and
owned Fetch scopes run with same-layer auto-instrumentation suppressed. Action
and attempt scopes do not suppress standard outbound HTTP instrumentation, so a
provider HTTP span can become their child.

With no `observability` input, Runtime binds its internal null adapter. It
allocates no trace context, creates no task or timer, persists null durable
context, and adds no close work.

The existing private Runtime/test `events` callback receives the kernel's closed
`ExecutionEventV2` projection. It is not generated App input and this decision
adds no public events API. It cannot own scope context, extraction, propagation,
suppression, metrics, or shutdown. A callback fault disables the callback for
that Runtime instance and is otherwise fail-open. Runtime emits no v1
compatibility event, and the official adapter never consumes the callback.

Envelope `scope.started` carries the exact redacted start variant, including
safe method/route/entry/statement and opted-in transaction, Dispatch, Run,
Attempt, or Effect links but never trace-plan `tracestate`. `scope.event` carries
the exact event payload, and `scope.ended` carries the exact end variant with
HTTP status and closed error code where applicable.

The kernel emits at most 2,048 Envelope records for one Execution and at most
64 KiB for one canonical Envelope line. These bounds govern only the lossy
Envelope callback; adapter spans and span events use their own exact bounds.
Excess Envelope projection is reported by the kernel's bounded
`envelope_limit` diagnostic, not an OpenTelemetry metric, and cannot abort,
retry, or alter the Execution. A late nested scope cannot recreate Envelope
counter state after its root Execution ends.

## Public opaque core type

```ts
declare const questpieObservabilityBrand: unique symbol;

export interface QuestpieObservability {
	readonly [questpieObservabilityBrand]: true;
}
```

## Official adapter interface

The official adapter imports that core-owned public type and exports:

```ts
import type { QuestpieObservability } from "questpie";

export type OpenTelemetryOptions = Readonly<{
	ingress?: Readonly<{
		trustBoundary?: "continue" | "restart"; // default: continue
	}>;
	operationalIds?: "omit" | "spans"; // default: omit
	deploymentEnvironment?: string; // 1..64 printable ASCII characters
}>;

export interface QuestpieOpenTelemetry extends QuestpieObservability {
	close(): Promise<void>;
}

export declare function createOpenTelemetry(
	options?: OpenTelemetryOptions,
): Promise<QuestpieOpenTelemetry>;
```

Options are decoded as an exact object. Unknown members, invalid enums, or an
invalid deployment environment reject adapter creation. `close()` is
idempotent; concurrent calls share one promise. After successful creation,
export/flush/shutdown faults are reported only through OpenTelemetry SDK
self-diagnostics and `close()` resolves. It completes within 30 seconds even if
an exporter does not. This preserves the host's primary application error.

The embedded cleanup spelling is nested because adapter creation precedes App
creation:

```ts
const telemetry = await createOpenTelemetry();
try {
	const application = await createApp({ ...runtime, observability: telemetry });
	try {
		// host
	} finally {
		await application.close();
	}
} finally {
	await telemetry.close();
}
```

## Supported environment contract

The official adapter constructs its SDK explicitly and reads only this subset:

| Variable                         | Accepted values and bound                                                                | Default                 |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `OTEL_SERVICE_NAME`              | 1..128 UTF-8 bytes                                                                       | application identity    |
| `OTEL_TRACES_EXPORTER`           | `otlp` or `none`                                                                         | `otlp`                  |
| `OTEL_METRICS_EXPORTER`          | `otlp` or `none`                                                                         | `otlp`                  |
| `OTEL_EXPORTER_OTLP_PROTOCOL`    | `http/protobuf`                                                                          | `http/protobuf`         |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | valid absolute `http:` or `https:` URL, at most 2,048 bytes                              | SDK OTLP default        |
| `OTEL_EXPORTER_OTLP_HEADERS`     | SDK header grammar, at most 8 KiB; never enters signals                                  | absent                  |
| `OTEL_EXPORTER_OTLP_TIMEOUT`     | integer 1..30,000 ms                                                                     | 10,000 ms               |
| `OTEL_TRACES_SAMPLER`            | `parentbased_always_on`, `parentbased_always_off`, or `parentbased_traceidratio`         | `parentbased_always_on` |
| `OTEL_TRACES_SAMPLER_ARG`        | decimal ratio 0..1; required for ratio sampler and rejected for either non-ratio sampler | absent                  |
| `OTEL_BSP_SCHEDULE_DELAY`        | integer 1..30,000 ms                                                                     | 5,000 ms                |
| `OTEL_BSP_EXPORT_TIMEOUT`        | integer 1..30,000 ms                                                                     | 30,000 ms               |
| `OTEL_BSP_MAX_QUEUE_SIZE`        | integer 1..65,536 spans                                                                  | 2,048                   |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | integer 1..queue size                                                                    | min(512, queue size)    |
| `OTEL_METRIC_EXPORT_INTERVAL`    | integer 1,000..300,000 ms                                                                | 60,000 ms               |
| `OTEL_METRIC_EXPORT_TIMEOUT`     | integer 1..30,000 ms                                                                     | 30,000 ms               |

`OTEL_TRACES_SAMPLER_ARG` is required exactly when the ratio sampler is
selected. Supplying it with `parentbased_always_on` or
`parentbased_always_off` is invalid configuration; the adapter does not ignore
it.

An invalid supported variable rejects embedded adapter creation with
`QP-OTEL-001 invalidConfiguration` before App readiness. Its payload contains
only the closed option path or environment-variable name and never the endpoint,
header, credential, or rejected value. Other `OTEL_*` variables are ignored by
this adapter version. Logs, generic Resource attributes, baggage, Prometheus,
console, Zipkin, gRPC, and declarative configuration are not enabled in v1.

The effective batch-size default follows a smaller configured queue. Setting
only `OTEL_BSP_MAX_QUEUE_SIZE=128`, for example, selects a batch size of 128;
an explicitly configured batch larger than the queue is invalid.

When the batch span queue is full, the SDK drops the new finished span and its
self-observability reports the drop. Runtime work never blocks on queue space.
The SDK owns that queue/drop diagnostic; QUESTPIE does not mirror it into
`questpie.observation.dropped` or create a second reliable drop ledger.

## CLI resolution and compatibility

`questpie start --telemetry=opentelemetry` accepts that value only. The CLI
resolves `@questpie/opentelemetry` from the application root, never from the
CLI's installation directory. Missing package, an export without
`createOpenTelemetry`, or an adapter whose neutral interface version is not 1
fails before generated-App creation with `QP-START-004 telemetryUnavailable`.
If adapter creation returns `QP-OTEL-001`, the CLI fails with
`QP-START-004 telemetryInvalidConfiguration` and preserves only the safe
variable/path in its cause. Operators repair that named setting and restart;
neither diagnostic prints its value.

Release `4.0.0-beta.1` declares an exact `questpie: 4.0.0-beta.1` peer. Every
later adapter release pins the exact same `questpie` version. Runtime still
validates interface version at startup. The CLI uses the nested cleanup sequence
above; SIGINT/SIGTERM stop ingress, close the App, then close telemetry. A
Runtime close fault remains the process's primary failure; telemetry close
resolves after its bound.
