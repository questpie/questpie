# OpenTelemetry implementation queue

- Status: OTEL-01 through OTEL-07 complete; OTEL-08 public guide integrated,
  aggregate release closure pending
- Spec: [`SPEC.md`](./SPEC.md)
- Authority: Accepted ADR-0033 and ADR-0034 with their verified replacement reviews
- Delivery rule: every ticket starts red and lands a narrow runnable tracer
- Tracker state: local queue; external task identifiers may be attached later

This queue is topological. A ticket is complete only when its claimed behavior
crosses the real compiler/artifact/generated-contract/Runtime/PostgreSQL or
package seam and its named tracer passes. Exporting a type or adding an
isolated adapter class is not progress by itself.

## Dependency graph

```text
OTEL-01 one observed direct Query
  -> OTEL-02 owned Fetch ingress and network parity
       -> OTEL-03 complete Runtime owner census and v1 deletion
            -> OTEL-04 protocol-v8 durable correlation
            -> OTEL-05 official exact-peer adapter package
                 -> OTEL-06 CLI and loopback OTLP operation (also OTEL-03)
                      -> OTEL-07 reference browser and hostile tracers
                           (also OTEL-04 and OTEL-05)
                           -> OTEL-08 public docs and release closure
```

OTEL-04 and OTEL-05 may proceed in parallel after OTEL-03. No ticket may retain
a fallback, v1/v2 dual path, active v7/v8 compatibility path, second
observation kernel, public event callback, or generic provider interface.

## OTEL-01 — Observe one direct Query through the deep Runtime module

Status: complete at `5a3c9c987`.

Blocked by: none.

Red test:

- one generated direct Query cannot produce its exact accepted
  Execution/Query graph, canonical ExecutionEventV2 bytes, and unchanged
  application result through a private in-memory adapter;
- callback and adapter faults currently escape or invoke the Query twice.

Build the first complete path: executable closed start/event/end grammar, the
exact signal-projection artifact and digest, Runtime Instance and Execution
identity, private observation module, built-in null adapter, opaque core type,
generated optional `observability` input, and one direct Query owner. Exercise
active context, exact redaction, event/line bounds, counter exhaustion,
idempotent end, pre-entry failure, re-entry, getters/late calls, callback
disablement, and no-adapter zero-work behavior.

Acceptance:

- the same Query result/error bytes occur with no adapter, a working adapter,
  a faulting adapter, and a sampled/null context;
- the signal artifact maps are exhaustive and bind the executable neutral
  grammar;
- generated declarations import only the core-owned opaque type;
- no handler receives telemetry and core has no OpenTelemetry dependency;
- focused compiler/artifact/generated-contract/Runtime tests, typechecks,
  format/lint, architecture, and `git diff --check` pass.

## OTEL-02 — Own Fetch ingress, propagation, and streamed lifetime

Status: complete through `594053d09`.

Blocked by: OTEL-01.

Red test:

- the generated Fetch Query cannot preserve the same application/wire result
  as direct execution while producing its intentionally different SERVER ->
  Execution -> Query graph and `fetch` entry;
- streaming SERVER scope currently ends before body EOF, source error,
  consumer cancellation, or host abort;
- invalid propagation, trust-boundary restart, and extraction failure can leak
  data or change work.

Pull the same Query through generated Fetch and generated client. Add the exact
`traceparent`/`tracestate` extraction. The adapter returns the complete closed
ingress trace plan: `remote-parent` with the validated extraction for continue,
`root-with-links` with exactly one validated context and no `tracestate` for
restart, or null for absent/invalid propagation. Runtime validates/freezes the
plan and retains no bare-context decoder or side channel. Add null ingress
Principal/Execution, bounded method/route/scheme/status fields, no raw unmatched
path, no baggage, same-layer HTTP suppression, response-body retention, and
idempotent terminal handling. A real `Response` contributes its exact integer
status; a pre-Response framework error, cancellation, or deadline contributes
explicit null, never a synthetic numeric status. `ok` plus null is invalid and
the adapter omits `http.response.status_code` for the null branch.

Acceptance:

- direct and Fetch share their common Execution/Query semantics and application
  result while each matches its own accepted scope graph and Envelope shape;
- EOF, source error, consumer cancel, host abort, later signals, invalid
  `traceparent`, orphan/non-printable/oversized `tracestate`, restart link, and
  extraction-fault-as-absent hostiles pass;
- malformed trace context members, structurally open plans, all three
  pre-Response outcomes, numeric status boundaries, `ok` plus null, and
  post-decode caller mutation hostiles pass;
- the signal projection bytes/digest, Runtime Build binding, generated goldens,
  and later adapter effective-config digest advance atomically with the grammar;
- generated client and React/application code contain no telemetry import or
  manual context handling.

## OTEL-03 — Replace every remaining Runtime owner with Envelope v2

Status: complete through `eeeefcfaa`.

Blocked by: OTEL-01 and OTEL-02.

Red test:

- the complete semantic-owner census cannot emit exactly the accepted scope
  graph, attributes, events, end outcomes, and one shared Execution identity;
- existing `ExecutionEventV1` bytes and emitter remain reachable;
- Live Query recompute, Mutation, Action, transaction, PostgreSQL, acceptance,
  worker Attempt, and effect paths can drift.

Extend the same private module through every owner frozen by ADR-0033. Bind the
complete per-scope maps into canonical artifacts and generated Runtime inputs.
Replace the private v1 callback atomically, enforce the 64 KiB/2,048-record
Envelope limits, preserve exact transaction/post-commit outcomes, and suppress
only same-layer owned HTTP/PostgreSQL instrumentation.

Acceptance:

- the executable owner census is complete and any unbound kind/attribute/event
  fails generation or Runtime validation;
- direct, Fetch, generated client, recompute, and worker application outcomes
  remain identical with observation enabled, disabled, failing, or sampled;
- every v1 type, emitter, digest assertion, and sole-owner test is deleted;
- no callback reconstructs spans and no compatibility event is emitted.

## OTEL-04 — Carry first-acceptance context through protocol v8

Blocked by: OTEL-03.

Red test:

- duplicate Job/Reaction acceptance can overwrite trace context, rollback can
  persist it, old rows can fabricate links, and retries can parent-chain;
- a v7 Runtime can currently enter a v8 catalog or the inverse;
- migration/readiness does not verify all 21 live catalog tables and the exact
  three-column completeness rule.

Move the existing acceptance transaction, durable row decoder, worker Attempt
owner, compiler catalog, migration/Seed application, readiness, bundle
contract, CLI cutover, prune/backup/restore evidence, and all active protocol
consumers to v8. Attempts remain fresh roots with zero or one link; trace facts
never affect deduplication, claim, lease, fencing, settlement, retry, or
cancellation.

Acceptance:

- first success, duplicate, rollback, null old row, retry, reclaim, prune,
  backup/restore, and two-v8-instance cases pass on disposable PostgreSQL 17;
- `questpie migration apply --allow-non-rolling-protocol-v8` performs the live
  cutover; v8 refuses v7 and historical v7 refuses v8 before work;
- active v7 Runtime/readiness/bundle aliases,
  `--allow-non-rolling-protocol-v7`, compatibility decoders, and sole-owner
  tests are deleted after all current owners move;
- compiler-owned v7 source-catalog recognition and rejection evidence remain
  only for explicit migration/refusal, never as a Runtime fallback;
- durable state, receipts, and Change Ledger remain truth when telemetry is
  absent or failing.

## OTEL-05 — Ship the exact-peer OpenTelemetry adapter

Blocked by: OTEL-03.

Red test:

- a clean isolated consumer cannot install exact-peer `questpie` plus
  `@questpie/opentelemetry`, create the opaque handle, and obtain the exact
  `SIGNALS.md` spans and metrics from an in-memory/OTLP exporter;
- invalid supported configuration, structural forgeries, unknown members,
  sampler combinations, queue bounds, and dependency/version drift do not
  fail at their accepted seam.

Create the optional public package around the one private neutral interface.
Implement exact W3C propagation/trust restart, Semantic Conventions 1.44.0,
Resource allowlist, span graph, attributes, events, metrics, operational-ID
option, supported environment subset, bounded queue/drop behavior,
same-layer suppression, diagnostics, idempotent concurrent close, and the
30-second close bound. Its canonical startup builder emits and validates the
effective-configuration artifact and distinct digest, binding the projection
digest, Runtime Instance, Runtime Build, application/package identities,
options, and presence-only endpoint/header facts.

Acceptance:

- artifact and executable signal maps prevent package/core drift;
- raw Call Identity and every forbidden sentinel remain absent from spans,
  events, metrics, Resource, diagnostics, and raw export payloads;
- SDK/exporter/Collector faults and sampling never change application work;
- `questpie` remains installable/importable/buildable alone and its manifest,
  dist, lock closure, generated JS/declarations, and dependency graph contain
  no adapter or OpenTelemetry import;
- all OpenTelemetry dependencies live under the adapter package.

## OTEL-06 — Operate the adapter through CLI and loopback OTLP

Status: complete at `0a37ee993` after independent Standards and Spec PASS.

Blocked by: OTEL-03 and OTEL-05.

Red test:

- `questpie start --telemetry=opentelemetry` cannot resolve the adapter from a
  packed application root and preserve embedded/CLI behavior;
- missing package/export/version and invalid configuration can reach readiness
  or disclose endpoint/header/value text;
- SIGINT/SIGTERM, App creation failure, receiver loss, and hanging export can
  reorder cleanup or replace the primary App failure.

Implement the single accepted CLI flag, exact application-root resolution,
safe `QP-START-004` translations, no-load path without the flag, and nested
App-then-adapter cleanup. Drive a loopback OTLP receiver through success,
receiver disappearance during admitted work, bounded flush, repeated/concurrent
close, App creation failure, and host termination.

Acceptance:

- packed embedded and CLI hosts produce the same normalized closed graph,
  configuration semantics, Resource allowlist, and application/PostgreSQL
  outcomes, excluding fresh Runtime/trace/span identities and time;
- invalid explicit setup fails before readiness and traffic with only safe
  option/environment names;
- no adapter fallback or silent disable occurs for explicit configuration;
- every success/failure path removes receiver, host, ports, temporary install,
  tarballs, and generated tracer output.

## OTEL-07 — Prove reference browser and hostile journeys

Status: complete through `eccb437ff`.

Blocked by: OTEL-04, OTEL-05, and OTEL-06.

Red tracer:

- Team Support Desk cannot show browser -> Mutation producer -> post-restart
  fresh Job Attempt root with exactly one first-acceptance link -> Action/effect
  child graph using only the generated browser client;
- Collaboration cannot prove nondisclosure, hostile adapter containment,
  invalid propagation, duplicate/rollback/old-row/retry/reclaim/fencing, two
  Runtime instances, and identical PostgreSQL/public outcomes.

Run both consumers with telemetry absent, enabled, sampled, and faulting. Team
Support Desk remains the zero-author-instrumentation beginner consumer.
Collaboration owns hostile re-entry, double-entry, post-entry throw, getter,
saved/late callback, callback-disablement, disclosure sentinel, multi-instance,
and durable-correlation cases.

Acceptance:

- Team Support Desk PostgreSQL 17/Firefox proves the exact graph with zero
  React/handler telemetry import or manual context handling;
- forbidden sentinels are absent from Envelope, spans, events, metrics,
  Resource, diagnostics, and raw OTLP payloads;
- hostile adapter defects execute work once, produce the closed release-failing
  diagnostic, and leave PostgreSQL/public outcomes equal to telemetry-off;
- all fixture hosts, Firefox processes, PostgreSQL containers/connections,
  receivers, listeners/ports, temporary installs, and generated tracer output
  are removed in `finally` on success and deliberate failure.

The Team Support Desk reference browser tracer landed at `88e1c05a6`. The
Collaboration hostile parity slice landed at `bfbdda2be`; the realtime carrier,
per-binding acknowledgement, closed-controller, and combined-fixture ordering
repairs are integrated through `eccb437ff`. The complete combined PostgreSQL
17/Firefox tracer then passed twice consecutively with 329 assertions in
18.15 seconds and 17.87 seconds. These runs close OTEL-07 only: they do not
substitute for OTEL-08's aggregate package, documentation, release, review, or
cleanup evidence.

## OTEL-08 — Publish docs and close the three-package release

Blocked by: OTEL-07.

Only after OTEL-07 is green, publish the implementation-gated guide: embedded
and CLI setup, supported configuration, exact signal meaning, delayed-work
links, disclosure, lossy/non-authoritative behavior, protocol-v8 cutover, and
why handlers stay ordinary. Update runtime/release/durable pages and routing.
Delete the unsupported 4,096-event queue, 30-day telemetry-retention, and
365-day audit-retention claims. Do not add unrelated React bindings.

The public guide, routing, and runtime-page corrections are integrated at
`9a495f0c3`. That satisfies the documentation-authoring part of this ticket,
not OTEL-08 as a whole. The aggregate release gates and fresh independent
reviews below remain pending.

Acceptance:

- the release manifest enumerates exactly `questpie@4.0.0-beta.1`,
  `@questpie/react@4.0.0-beta.1`, and
  `@questpie/opentelemetry@4.0.0-beta.1`; both optional-package peers on
  `questpie` are that exact version, the React peer matches ADR-0035, a missing
  or mismatched package fails, and no fourth public package appears;
- all three tarballs pack twice byte-identically and install together into one
  clean relocated consumer for import/build verification; core also passes its
  standalone isolation contract without either optional package;
- the complete registered PostgreSQL 17 lane includes fresh v8, live v7-to-v8
  cutover, 21-table catalog/completeness, both refusal directions, durable
  hostiles, two instances, and backup/restore;
- packed embedded and CLI OTLP tracers prove normalized signal/Resource parity,
  receiver-loss nonblocking behavior, App-before-adapter cleanup, primary App
  failure preservation, and bounded close;
- public docs build and state only implemented behavior;
- `quality:release`, package/declaration/archive checks, architecture, and two
  byte-identical release dry-runs pass;
- fresh independent Standards, Spec, and documentation reviews PASS against the
  exact final candidate head; findings rerun affected gates and no later drift
  exists;
- every resource is cleaned, the worktree is clean, and `git diff --check`
  passes. No push, tag, publish, or deploy occurs.

ADR-0035 supersedes only ADR-0033's original two-package count. The checked
two-entry release manifest and two-profile release script that predate this
ticket are not OTEL-08 closure evidence. OTEL-08 must update the explicit
release profiles, generated artifact manifest, archive/declaration checks, and
clean-consumer proof atomically after OTEL-07. This correction does not mark
OTEL-08 complete and does not weaken the required OpenTelemetry package.

## Test-first rules

Each ticket begins with its named failing test and uses the seconds-long
changed lane plus the smallest relevant typecheck. Generated goldens change
only through their compiler owner. PostgreSQL tickets use one disposable
PostgreSQL 17 target at a time; browser/fixture compilation never runs
concurrently in this worktree. Every coherent slice receives independent
Standards and Spec review before the next dependent slice starts.
