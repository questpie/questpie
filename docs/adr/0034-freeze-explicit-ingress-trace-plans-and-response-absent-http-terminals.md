# ADR 0034: Freeze explicit ingress trace plans and response-absent HTTP terminals

- Status: Proposed
- Date: 2026-08-31

## Context

ADR-0033 is Accepted and its lifecycle, signal vocabulary, ownership, and
OpenTelemetry direction remain closed. OTEL-02 exposed two omissions while
projecting that decision through the real Runtime interface.

First, the accepted adapter option permits either continuing a valid incoming
trace or restarting at a deployment trust boundary. The accepted private
`extract` return carries only an extracted context. It gives Runtime no closed
fact that distinguishes those two configured behaviors. Runtime therefore
cannot select `remote-parent` versus `root-with-links` without an undeclared
side channel or an assumption.

Second, the accepted Fetch/Route end union always requires an HTTP response
status. An admitted request can be cancelled, reach its deadline, or fail in
framework work before a `Response` exists. No truthful response status exists
in that state. Inventing `500`, `499`, or another sentinel would project a
response that never existed and can mislead operators.

These are contract-completeness defects. This decision does not reopen the
accepted scope graph, signal names, adapter ownership, lifecycle, propagation
headers, disclosure rules, or application-result authority.

## Decision

### Extraction returns one explicit ingress trace plan

The private neutral adapter's extraction method returns exactly
`IngressTracePlanV1 | null`. Its two non-null variants are the already accepted
ingress plans:

```ts
type IngressTracePlanV1 =
	| Readonly<{
			kind: "remote-parent";
			extracted: ExtractedTraceContextV1;
	  }>
	| Readonly<{
			kind: "root-with-links";
			links: readonly [NeutralTraceContextV1];
	  }>;
```

The official adapter owns its static `continue | restart` configuration and
returns the corresponding plan directly. Continue returns `remote-parent` and
retains validated `tracestate`. Restart returns `root-with-links` with exactly
the validated incoming context and has no `tracestate` member. Runtime validates
and recursively freezes the complete returned plan before starting Fetch or
Route. It does not read adapter configuration, infer intent, consult object
identity, or use a side channel.

Invalid propagation, extraction failure, or an invalid returned plan is
treated as absent incoming context and records the already accepted bounded
adapter diagnostic where applicable. The ingress starts as `root`. This cannot
change request work, Policy, or the application result.

The general `ObservationTracePlanV1` union remains internal to Runtime scope
starts. The extraction interface exposes only the two valid ingress variants;
it cannot return `active-parent` or `root`.

### HTTP terminal state records whether a Response existed

Fetch and Route ends retain the existing field name but change its exact type
to `number | null`:

```ts
type HttpObservationEndV1 =
	| Readonly<{
			kind: "fetch" | "route";
			outcome: "ok" | "framework_error" | "cancelled" | "deadline";
			httpResponseStatusCode: number; // integer 100..599
			errorCode?: string;
	  }>
	| Readonly<{
			kind: "fetch" | "route";
			outcome: "framework_error" | "cancelled" | "deadline";
			httpResponseStatusCode: null; // no Response was created
			errorCode?: string;
	  }>;
```

`null` is an explicit semantic fact, not an unknown numeric status. It is
admitted only when the owned Fetch/Route work terminates before producing a
`Response`, and never with `ok`. The OpenTelemetry projection omits
`http.response.status_code` for that terminal. It derives span status from the
closed outcome and safe error code only; it never fabricates an HTTP status or
copies an exception message.

When a `Response` exists, Runtime always records its actual integer status and
retains the SERVER scope through body EOF, source error, consumer cancellation,
or host abort. Host abort ends once and cancels the reader best-effort without
waiting for a non-cooperative source. A later body signal cannot change the
first terminal.

### Failure, cancellation, retry, and disclosure

The Fetch/Route owner starts before Context Resolution. If work rejects before
a `Response`, it ends exactly once with status `null` and the already owned
`framework_error`, `cancelled`, or `deadline` outcome, then preserves the
application behavior. Observation creates no cancellation, deadline, retry, or
error code. Telemetry failure remains lossy and cannot replace a request
result, PostgreSQL result, commit, retry, or Runtime close result.

The returned trace plan and HTTP terminal contain only the fields above. They
admit no headers beyond `traceparent`/`tracestate`, baggage, raw path, Call
Identity, input, output, Principal identity, exception text, stack, SQL, or
PostgreSQL detail. Fetch/Route still carry null Principal and null Execution at
ingress.

## Consequences

- Runtime can execute both accepted trust-boundary modes from one complete,
  validated adapter return value.
- Operators can distinguish an actual HTTP response from framework termination
  before response creation without a sentinel status.
- The private interface changes before the optional adapter package ships. No
  compatibility interface or dual decoder is retained.
- The canonical signal projection and Runtime Build binding must advance
  atomically when implementation resumes.

## Supersession ledger

This decision supersedes ADR-0033 only where its private interface says
`extract` returns `ExtractedTraceContextV1 | null`, replacing that return with
`IngressTracePlanV1 | null`. It also supersedes ADR-0033's requirement that
every Fetch/Route end carries a numeric response status, admitting explicit
`null` only for a non-`ok` terminal before a `Response` exists.

All other ADR-0033 decisions remain unchanged, including its exact scope graph,
continue/restart meanings, response-body lifetime, fail-open application
behavior, closed diagnostics, nondisclosure, no baggage, one private Runtime
kernel, exact-peer adapter, durable links, protocol v8, and release evidence.
The Accepted ADR-0033 proof remains historical evidence; this focused proof
adds the missing executable cases rather than rewriting its reviewed bytes.

Before PASS, this ADR is not product authority and `docs/adr/README.md`,
`SPEC.md`, `CONTEXT.md`, public documentation, and `HANDOFF.md` remain unchanged.
After PASS, those authority projections land separately before OTEL-02
implementation continues.

## Rejected alternatives

- Add `trustBoundary` to the extracted context. This makes a propagation value
  carry deployment policy and still requires every Runtime caller to translate
  it into the real trace plan.
- Let Runtime read adapter options or correlate extraction through object
  identity. That creates a second channel and makes the return value
  incomplete.
- Always continue, always restart, or silently choose one. Each contradicts an
  already accepted host option.
- Invent `499`, `500`, `0`, or another response status. No such response exists
  in the pre-response terminal.
- Make the status optional. Optionality cannot distinguish a deliberate
  response-absent terminal from a producer that forgot the required field.
