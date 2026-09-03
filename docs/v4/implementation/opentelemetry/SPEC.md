# OpenTelemetry implementation spec

- Status: ready for test-first implementation
- Authority: Accepted ADR-0033, repository-root `SPEC.md` and `CONTEXT.md`,
  `BOUNDARY.md`, and `SIGNALS.md`
- Reviewed design head: `c3bd1a2d337e6142013fe79ab5b78fca0fe327e0`
- Verified acceptance record:
  `docs/v4/prototypes/opentelemetry-boundary/REVIEW-REPLACEMENT.json`
- Authority projection: `6e5e0096164955df6d0d1bbf6ccbc0c9c27c3f03`

This document converts the Accepted design into implementation ownership and
tracer order. It does not introduce another observability interface. When a
summary here is less exact than ADR-0033, `BOUNDARY.md`, or `SIGNALS.md`, those
reviewed sources win.

## Useful product job

One host configuration observes the existing browser, direct, Fetch, Query,
Mutation, Action, PostgreSQL, Job, and Reaction journeys without application
handler instrumentation. The same Runtime-owned semantic facts drive a lossy
Execution Envelope v2 projection and the official OpenTelemetry adapter.
Neither projection can authorize, alter, retry, settle, fence, cancel, or audit
application work.

## Deep module and seams

The private Runtime observation module is the sole semantic owner. Its
interface is one closed scope start returning `run`, `event`, `end`, and an
optional neutral trace context. It owns scope identity, active context,
ordering, redaction, bounds, end idempotence, failure containment, and the two
projections. Runtime domain owners cross this seam; handler wrappers do not.

The generated host interface exposes only the core-owned opaque
`QuestpieObservability` handle. The built-in null adapter and official
`questpie-opentelemetry` adapter are the two concrete adapters at the private
neutral seam. There is no callback SPI, provider registry, handler capability,
Definition, Service, Context member, compiler Package, ambient global, or
generic integration-package rule.

## Owners

| Concern                                                           | Owner                                           |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| generated closed unions and signal projection artifact            | compiler and artifact layer                     |
| effective host configuration artifact                             | official adapter and canonical artifact builder |
| canonical bytes, domain-separated digests, projection bindings    | artifact layer                                  |
| Runtime Instance/Execution/event identity and sequences           | private Runtime observation module              |
| scope lifetime, ordering, active context, limits, diagnostics     | private Runtime observation module              |
| start/end timing and semantic outcome                             | existing Runtime domain owner                   |
| opaque host type and optional generated input                     | `questpie` and generated App Contract           |
| W3C extraction, SDK objects, signals, buffering, export, shutdown | `questpie-opentelemetry`                        |
| durable first-acceptance trace facts                              | existing Job/Reaction acceptance transaction    |
| protocol-v8 catalog, migration, readiness, cutover                | compiler/PostgreSQL Runtime owners              |
| CLI package resolution and nested cleanup                         | `questpie start`                                |
| application result, Policy, receipt, ledger, durable state        | existing owners; never telemetry                |
| public install and operating guide                                | `apps/docs`, only after implementation tracers  |

## Exact production path

1. A successful Runtime start creates one random UUIDv4 Runtime Instance and
   starts both unsigned 64-bit counters at 1.
2. Generated Fetch/Route ingress extracts only `traceparent` and `tracestate`,
   validates the closed trust-boundary rule, and starts before Context
   Resolution with null Principal and null Execution identity.
3. A root Execution allocates one opaque Execution identity. Every nested
   semantic scope receives the exact issued live identity.
4. Existing domain owners start, run, emit closed events, and end their scopes
   in the ordering frozen by `BOUNDARY.md`. Streaming SERVER scopes end only at
   body EOF, source error, consumer cancellation, or host abort.
5. One scope lifecycle produces both the canonical ExecutionEventV2 record and
   the neutral adapter call. The adapter never reconstructs scope state from
   events.
6. The Runtime validates the opaque handle, neutral interface version, trace
   bytes, closed unions, parent/link plan, execution identity, and end kind.
7. The official adapter maps only the exact `SIGNALS.md` graph, allowlists,
   events, metrics, dimensions, and bounds.
8. Runtime close stops new work and ends owned scopes. The host closes the App
   before the adapter; CLI preserves this nested cleanup and the primary App
   failure.

## Generated signal and configuration artifacts

The generated canonical signal artifact is exactly
`questpie.opentelemetry-signal-projection`. The official adapter's canonical
startup builder emits exactly `questpie.opentelemetry-effective-config`. Their
distinct NUL-domain-separated SHA-256 digests bind the executable
scope/event/end grammar, exhaustive attribute-to-scope map, signal projection,
and effective adapter configuration.

The configuration artifact binds the projection digest plus Application
Identity, Runtime Build digest, Runtime Instance Identity, exact package
versions, options, and supported environment results. Endpoint and header
material is represented only by presence/configuration facts;
credential-bearing values never enter artifacts, digests, diagnostics,
Envelope, or signals.

One executable neutral grammar owner feeds the projection builder. The
official adapter validates and interprets its effective OpenTelemetry
configuration; core Runtime receives only closed neutral facts and the opaque
handle, not OpenTelemetry configuration or artifact bytes. Unknown or
incomplete maps, projection/config drift, and digest mismatch fail before
readiness.

## Envelope and disclosure

ExecutionEventV2 is a closed append-only projection. Its safe surface is the
Runtime-instance/event/Execution identities, Application Identity, Runtime
Build digest, exact occurrence time, Principal kind, ordinary Authority class,
optional neutral trace facts, and the closed artifact, Operation, PostgreSQL
`xid8`, Dispatch, Run, Attempt, and Effect links.

Raw Call Identity, generic correlation text, Principal or Tenant identity,
payloads, headers, credentials, database URLs, Context, Policy identity or
evidence, Service state, SQL or parameters, provider payloads, exception text,
stacks, and arbitrary attributes are absent. The official adapter receives
already-redacted facts and cannot add Envelope fields or outcomes.

Canonical Envelope bytes are lexicographically keyed JSON lines. UUIDv4 is
validated at startup and invalid or zero identity fails before readiness.
Event and Execution counters are canonical unsigned 64-bit decimal, start at
1, reset only with a new Runtime Instance, and order only that instance;
cross-instance order is undefined. Runtime lifecycle records have null
Execution identity and spend no Execution record budget. Counter exhaustion
disables only new observation materialization; existing scopes still end
best-effort and application work continues.

One canonical Envelope line is at most 64 KiB and one Execution emits at most
2,048 records. Overflow omits only the private callback projection and emits a
bounded diagnostic. Adapter spans, events, and SDK queues retain their separate
Accepted bounds.

## Failure, cancellation, retry, and transactions

- Before readiness, an invalid opaque handle or adapter format/version fails
  App creation. Explicit CLI package/export/version failures use the exact
  `QP-START-004` variants. Invalid supported configuration uses `QP-OTEL-001`
  embedded and its safe CLI translation.
- A private events-callback fault disables that callback for the Runtime
  instance. Adapter `event` or `end` failure disables signals only for that
  scope. Extraction failure behaves as absent context. None changes work.
- A pre-entry `run` fault executes application work exactly once under the null
  scope. Re-entry, double entry, post-entry throw, adapter-returned getters,
  saved callbacks, and late calls remain contained and become release-failing
  diagnostics, not application errors. `end` is idempotent.
- After successful startup, processor, exporter, Collector, queue, flush, or
  shutdown failure is lossy and self-diagnostic. It cannot replace the first
  application result or Runtime close outcome.
- Cancellation and deadline end the owning scopes with their already-owned
  outcome. Observation starts no detached work and does not delay rollback or
  cancellation.
- QUESTPIE never retries application work for telemetry delivery. `retry`,
  `fenced`, and ambiguity are observed only on their Accepted semantic owners.
- Transaction scope follows the existing Mutation transaction. PostgreSQL
  `xid8` appears only after it exists. A committed transaction remains `ok`
  when its outer Mutation later becomes post-commit `ambiguous`.
- Direct, Fetch, generated-client, Live Query recompute, and worker execution
  use the same semantic owners and produce equivalent application results with
  observability absent, enabled, failing, or sampled out.

Ingress reads only `traceparent` and `tracestate`; baggage is never accepted or
injected. Invalid `traceparent`, orphan `tracestate`, non-printable
`tracestate`, or one over 512 bytes is discarded. Continue uses the valid
remote parent and tracestate. Restart creates a root with one link and drops
tracestate. An unmatched request exposes no raw path.

With no CLI flag the package is not resolved or loaded. With the flag it is
resolved only from the application root before readiness. App-creation failure
still closes telemetry. SIGINT/SIGTERM stops ingress, closes the App, then
closes telemetry. Adapter close is idempotent, concurrent calls share one
promise, it resolves within 30 seconds, and an App/Runtime close failure remains
primary. The null adapter adds no shutdown work.

## Durable correlation and protocol v8

The first successful Job or committed-fact Reaction run-creation transaction
stores only nullable trace ID, span ID, and flags. Duplicate acceptance retains
the first values; rollback stores none; old/no-adapter rows decode null. Each
Physical Attempt is a fresh root with zero or one creation-time link. Retry,
lease recovery, and reclaim create sibling roots and never use trace identity
for claim or fencing.

Protocol v8 is exactly protocol v7 plus the three nullable columns and their
completeness constraint across the complete catalog. Migration is an explicit
non-rolling cutover through
`questpie migration apply --allow-non-rolling-protocol-v8`. V8 refuses v7, v7
refuses v8, mixed operation is unsupported, and in-place downgrade is refused.
There is no v7 compatibility decoder, readiness alias, bundle field, CLI flag,
or active dual catalog after all current owners move. Compiler-owned v7 source
catalog recognition remains only where required to plan the explicit v7-to-v8
migration and prove historical v7 refusal; it is not a Runtime fallback. Prune,
backup, and restore preserve the three fields byte-for-byte, and multiple v8
instances use the same exact catalog.

## Generated and package contracts

- `questpie` publicly owns only the opaque `QuestpieObservability` type and
  remains the sole application authoring/Runtime package.
- Generated `CreateAppInput` gains optional `observability` and imports the
  type only from `questpie`. Generated application and browser client code has
  no OpenTelemetry import or context handling.
- `questpie-opentelemetry` is optional, exact-peer with `questpie`, and owns
  its OpenTelemetry dependencies, exact options, supported environment subset,
  Semantic Conventions 1.44.0 mapping, resources, processors, exporters,
  propagation, buffering, diagnostics, and bounded close.
- Core has no OpenTelemetry dependency. A missing or version-mismatched package
  fails explicitly; there is no fallback adapter or silent downgrade.

The release inventory is one closed set, not package discovery: exactly
`questpie@4.0.0-beta.2` and `questpie-opentelemetry@4.0.0-beta.2`.
`questpie-opentelemetry` exact-peers `questpie: 4.0.0-beta.2`; `questpie`
exports `./react` and declares `react: ^19.2.0` as an optional peer. The release
lane rejects a missing, extra, obsolete, version-drifted, peer-drifted, or
undeclared archive. It packs both archives twice and requires byte-identical
results, installs both in one clean relocated consumer that imports
`questpie`, `questpie/react`, and `questpie-opentelemetry`, and repeats core's
standalone isolation proof without React or OpenTelemetry.

The historical beta.1 release used three packages after ADR-0035 superseded
ADR-0033's original two-package state. ADR-0042 replaces only those package
identities, React and peer placement, and release-cardinality clauses. It
changes no OpenTelemetry runtime, protocol, signal, dependency-isolation, or
exact-peer semantics.

## Replacement and deletion

The vertical replaces `ExecutionEventV1` and the private emitter atomically.
It updates every current Runtime, compiler, test, readiness, bundle, migration,
Seed, and CLI owner from v1/v7 to v2/v8, then deletes old Runtime/readiness/
bundle aliases, `--allow-non-rolling-protocol-v7`, tests whose sole owner
disappeared, and compatibility execution paths. It retains only the historical
v7 migration source recognition and refusal evidence named above. It must not
dual-emit, dual-read, layer a second observation kernel, or retain aliases.

The implementation also deletes the unsupported public 4,096-event exporter
queue, 30-day telemetry-retention, and 365-day audit-retention claims. The
accepted batch span queue defaults to 2,048; telemetry retention belongs to the
backend and durable audit retention remains a separate undecided owner.

## Tracer contract

Team Support Desk is the zero-author-instrumentation beginner consumer.
Collaboration is the authority, disclosure, hostile-adapter, multi-instance,
and durable-correlation consumer. A loopback OTLP receiver proves package and
CLI operation, exact signals, receiver loss, and bounded shutdown. Disposable
PostgreSQL 17 proves v8 migration, readiness, duplicates, rollback, old rows,
retry/reclaim, restore, and multiple Runtime instances.

Public docs land only after those tracers pass. Final closure requires focused
type and unit tests, direct/network/browser parity, hostile and PostgreSQL 17
lanes, docs build, `quality:release`, deterministic isolated dry-runs for the
exact two-package inventory, declaration and archive digests, independent
Standards and Spec reviews, resource cleanup, and `git diff --check`.

## Non-goals

No OTel logs, authored telemetry, generic provider SPI, telemetry-backed Policy
or readiness, audit reconstruction, Collector distribution, backend, retention
promise, dashboard, alert DSL, Studio implementation, Cron, trigger, workflow,
browser Job control, or unrelated React package belongs to this vertical.
