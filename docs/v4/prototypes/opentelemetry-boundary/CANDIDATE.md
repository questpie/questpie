# Runtime observation and OpenTelemetry candidate

Status: Proposed design candidate; not Accepted authority

## Delta

The candidate supersedes ADR-0014 only for Execution Envelope/event schema
versioning and adds one OpenTelemetry projection. It preserves Runtime and
Operation ownership, append-only closed events, direct/network/worker parity,
PostgreSQL durable authority, Policy nondisclosure, and ADR-0023 outcomes.

The candidate has four changes:

1. replace process-local Envelope identities and raw `callId` correlation with
   Execution Envelope v2, including an atomic migration of the private
   Runtime/test `events` callback with no dual v1 emission and no new public
   callback;
2. add one private scoped observation kernel and one optional opaque
   generated-App `observability` input whose core-owned public type never makes
   generated declarations import the optional adapter package;
3. persist only first-acceptance trace ID, span ID, and flags for delayed durable
   links; and
4. add the explicit `@questpie/opentelemetry` adapter without adding an authored
   telemetry capability.

## Consumer tracer

Team Support Desk is the beginner tracer: browser -> generated client ->
Mutation -> Job -> Action -> hard restart. Its host adds the adapter once.
Queries, Mutations, Jobs, Actions, Policies, and React import no OpenTelemetry
module and author no span.

Collaboration is the hostile tracer. No adapter, a working in-memory adapter,
and throwing/outage adapters must produce byte-equivalent public outcomes and
the same PostgreSQL truth. It also proves nondisclosure, duplicate acceptance,
rollback, retry/reclaim sibling links, and multi-instance identity isolation.

The package tracer packs `questpie` and `@questpie/opentelemetry`, installs them
in isolation, sends OTLP to a loopback receiver, cuts the receiver, and proves
bounded shutdown and deterministic release artifacts.

## Corrected claim

QUESTPIE does not own telemetry retention. The current public claims of a
framework-fixed 4,096-event exporter queue, 30-day telemetry retention, and
365-day audit retention have no implemented or Accepted owner. The post-PASS
projection removes them without selecting an audit-retention policy.
Adapter/SDK configuration owns finite buffering; the Collector/backend owns
telemetry retention. Dropped telemetry never changes application or PostgreSQL
truth.

## Explicit absence

No `ctx.telemetry`, authored Span/Metric/Logger Resource, arbitrary attribute
map, browser SDK, automatic Service instrumentation, OTel logs, Studio,
dashboard, Collector distribution, or telemetry-backed Policy/audit/readiness/
retry/scheduling is accepted. No trace or span identity aliases a Call,
transaction, Dispatch, Run, Attempt, or Effect identity.

Implementation and SPEC/ticket projection remain blocked until this candidate
passes the repository acceptance protocol. Acceptance alone does not publish
the install guide: public API/package instructions remain candidate material
until their implementation tracer and release evidence pass.

The first manifest-bound review of head `bddada48b6c62795a77b005de397f351d1138cf9`
returned `BLOCKED`. A replacement candidate remains pending until the signal
artifact binds the exact per-scope `questpie.execution.entry` projection and the
Fetch lifetime proof executes source-error plus consumer-cancel hostiles. The
committed BLOCKED record is evidence only and does not change Proposed authority.
