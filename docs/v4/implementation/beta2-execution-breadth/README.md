# BETA.2 execution-breadth implementation queue

- Status: ready for implementation
- Authority: ADR-0015, ADR-0026, ADR-0036, `SPEC.md`, the accepted proof at
  `docs/v4/prototypes/beta2-execution-breadth/`, and the accepted canonical HTTP
  proof at `docs/v4/prototypes/http-openapi-projection/`
- Accepted design head: `fe05d61c4fec878cc72d19c9254ab098f48531dc`
- Verified review: `REVIEW-03.json`, committed at `173db46e`
- Scope: Route/Auth composition, Action, ordinary/scheduled/checkpointed Job,
  cron, and the removal of Workflow from production source
- Non-goals: core Auth product, provider registry, generic Queue/worker browser
  controls, Studio UI, child work, compensation, or a second scheduler/runtime

This is a local implementation queue, not tracker state. Each ticket is a
vertical slice and must start red. A ticket is complete only when its authored
Definition reaches normalized compiler input, artifacts, exact generated type,
Runtime binding/execution, hostile tests, and the same direct/network or worker
path claimed by its acceptance criteria. An exported name without that path is
not progress.

## Dependency order

The correctness, PostgreSQL, and later authoring/editor DX ordering is recorded
in [`DX-PASSES.md`](./DX-PASSES.md). In particular, Operation admission and the
production PostgreSQL connection seam precede new Route, Action, and Job
Runtime bindings; client/editor sugar follows the runnable backend.

```text
EB-00 accepted authority (done)
  -> EB-01 remove superseded Workflow bytes
       -> EB-02 Route + credential resolver tracer
       -> EB-03 Action direct/network tracer
       -> EB-04 ordinary Job acceptance/worker tracer
            -> EB-05 cron schedule/tick tracer
            -> EB-06 Mutation checkpoint crash/resume
                 -> EB-07 Action checkpoint ambiguity/recovery (also EB-03)
                 -> EB-08 timers, signals, cancel, bounds, compatibility
  -> EB-09 generated client projection (EB-02, EB-03)
       -> HTTP-01 canonical Query GET tracer
            -> HTTP-02 canonical Mutation/Action tracer + old-route deletion
                 -> HTTP-03 complete OpenAPI/explain projection
                      -> HTTP-04 reference-consumer and hostile closure
  -> EB-10 collaboration end-to-end guide/fixture (EB-02 through EB-09)
```

EB-02, EB-03, and EB-04 may proceed in parallel only after EB-01 makes the
factory/resource census exact. PostgreSQL-driver consolidation, dual pooled and
direct URLs, and immediate Live Query wake remain the preceding production
backend decisions in `docs/v4/research/production-backend/DECISION-MAP.md`; no
ticket here invents a second connection owner.

## EB-00 — Accept the contract

Status: complete at `521c05d0`.

- ADR-0026 is Accepted after a verified fresh Opus-medium PASS.
- All 41 current authority surfaces project Workflow checkpoint semantics into
  Job; 14 self-declared historical research files remain evidence.
- Route/Auth remains ADR-0015 application composition. Reaction remains the
  ADR-0013 committed-fact Resource.

## EB-01 — Remove superseded Workflow bytes

Status: complete at `1f0a7903`.

Red test:

- compile an application/package contract and assert the executable factory
  family is exactly Query, Mutation, Action, Route, Reaction, and Job;
- assert importing `defineWorkflow` from `#questpie/app` or
  `#questpie/package` fails with the closed structural-import diagnostic;
- scan compiler/runtime artifacts and public package exports for Workflow kind,
  factory, client, Manifest, binding, and structural-evaluator markers.

Implementation:

- remove `defineWorkflow` from discovery's factory allowlist and virtual
  evaluator (`packages/compiler/src/discovery.ts:402`-`:406`);
- remove it from generated empty-factory and import lists
  (`packages/compiler/src/generate.ts:211`-`:216`, `:450`-`:454`);
- do not add a compatibility alias or a `workflow` kind;
- retain internal durable history/timer/signal primitives for Job tickets.

Acceptance:

- the negative import fails for the intended diagnostic, not module absence;
- Query/Mutation/Reaction generation is byte-stable except for the exact
  factory census;
- repository scans distinguish historical proof/docs from production source;
- changed tests and compiler typecheck pass.

## EB-02 — Route and credential-resolver tracer

Red test:

- one literal webhook Route preserves raw bytes, resolves credentials through
  one explicit execution Service, produces resolved/anonymous/provider-failure
  outcomes, and reaches the same handler through raw Fetch and direct Route;
- overlapping literal/parameter/wildcard routes fail compilation;
- Route Context cannot access data, Mutation, raw database, transaction, or
  System authority;
- provider outage never becomes anonymous.

Implementation:

- normalize Route identity, method/path, input limits, Origin, executable slot,
  and handler binding;
- mount it in the single generated `app.fetch` root path and preserve exact raw
  Request/Response lifetime;
- install zero or one credential resolver backed by an explicit Service;
- keep Better Auth as a reference Package/fixture, never a runtime dependency.

Acceptance:

- P17 direct/raw parity and Service lifetime cases run against real compiler
  artifacts and Runtime bindings;
- root mount and explicit host rewrite are documented; no subtree claim;
- generated browser client exposes no Route member.

## EB-03 — Action direct/network tracer

Red test:

- one Action calls a fake external provider through an execution Service via
  direct and network paths with identical input/output/error bytes;
- direct omission of stable idempotency material fails;
- a domain field literally named `effectKey` cannot replace Runtime's scoped
  internal Effect Identity;
- provider rejection and lost/unknown response remain distinct; the Runtime
  performs no automatic retry;
- Action Context negative members cover transaction/data, raw database,
  durable controls, and System elevation.

Implementation:

- normalize Action Policy, exposure, errors, limits, Origin, handler slot, and
  output inference/pin;
- derive internal Effect Identity from Action identity, caller context, and
  explicit stable idempotency material; expose it read-only as `effect.id`;
- create a fresh Query snapshot and Mutation transaction for nested generated
  calls;
- add a generated client member only when `network: true`.

Acceptance:

- direct/network parity, response-loss ambiguity, cancellation, and nested
  Query/Mutation lifetime tests pass;
- no provider registry, provider-specific retry, or exactly-once claim enters
  core.

## EB-04 — Ordinary Job acceptance and worker tracer

Red test:

- accept one Job directly, transactionally from a Mutation, and after a delay;
- race duplicate scoped idempotency identities and return one stable run
  receipt;
- claim with a short fenced lease, heartbeat, retry, cancel, complete, and
  recover after process loss;
- re-evaluate run-as Context and current Policy on every physical attempt;
- a Job using no `step` command writes zero checkpoint rows/events.

Implementation:

- add exact Job Definition/artifact/generated types and Runtime binding;
- reuse the existing PostgreSQL run/attempt/lease transition kernel and
  maintenance fencing rather than wrapping it;
- persist Job semantic version (compiler-materialized version 1 is allowed),
  executable digest, result/error, retention, and append-only events.

Acceptance:

- no second Queue, worker, lease, or Job wrapper exists;
- cancel-requested expired work does not start a needless recovered attempt;
- no generic Job controls enter the browser client.

## EB-05 — Cron schedule and tick tracer

Red test:

- ten schedulers race the same scheduled instant and create one tick/run;
- time zone and cron bytes are compiled/validated, not interpreted ad hoc by
  each worker;
- removing a schedule blocks future ticks and preserves an accepted run;
- rolling compatible instances do not require a singleton leader.

Implementation:

- compile static Job schedule metadata into PostgreSQL durable schedule state;
- derive stable tick identity from Job schedule identity and scheduled instant;
- use notifications only as wake acceleration.

Acceptance:

- ten-instance PostgreSQL test and schedule removal hostile case pass;
- cron remains attached to Job and exposes no authored Scheduler Resource.

## EB-06 — Mutation checkpoint crash/resume

Red test:

- crash after a named Mutation commits but before checkpoint result persistence;
- retry the same run/checkpoint and prove one Mutation Call Identity and one
  application write;
- reject renamed, reordered, duplicate, truncated, and command-digest-changed
  checkpoint history;
- code outside `step` may re-enter but cannot obtain application-write or
  external-effect capability.

Implementation:

- add the closed Job `step.mutation`, `step.sleep`, and history projection over
  the same run/attempt/lease state;
- persist ordered checkpoint identity, canonical command digest, validated
  result, timer state, and append-only transitions;
- refuse incompatible executable/version claims.

Acceptance:

- PostgreSQL crash-window tests falsify duplicate writes and latest-code replay;
- ordinary Job storage remains unchanged when no step is used.

## EB-07 — Action checkpoint ambiguity and receipt recovery

Blocked by: EB-03 and EB-06.

Red test:

- lose the provider response after possible acceptance;
- prove `step.action` derives Effect Identity from run plus ordered checkpoint
  name and authors cannot override it;
- without reliable receipt lookup, keep the checkpoint/run ambiguous and do
  not blind-retry;
- with reliable lookup, reconcile the same identity and persist one receipt.

Acceptance:

- the fake provider observes one stable idempotency value across attempts;
- unknown and rejected outcomes remain different declared errors/events;
- Reaction and ordinary Job Action calls share the same Action runtime kernel.

## EB-08 — Timers, signals, cancellation, bounds, and evolution

Red test:

- early, duplicate, unauthorized, wrong-codec, and late signals;
- signal wait, timeout, process restart, cancellation during wait, and stale
  worker fencing;
- bounded checkpoint/history/continuation growth;
- compatible and incompatible semantic/executable versions during rolling
  deployment.

Acceptance:

- signal name is closed by the Job Definition and remains distinct from ordered
  checkpoint name;
- cancellation and timeout have one terminal winner and append-only history;
- child work and compensation remain typed absent.

## EB-09 — Generated client projection

Blocked by: EB-02 and EB-03.

- network Actions project once from the canonical App Contract into the
  generated client; Routes and generic Job controls do not;
- every projection preserves Policy, input/output, declared error, Origin, and
  exposure identity and calls the same Operation/Execution path;
- no parallel handler or model-specific authority appears.

ADR-0036 supersedes this ticket's former OpenAPI grouping with the HTTP tickets
below. MCP and public skill output require their own accepted projection
contracts and cannot ride the HTTP implementation implicitly.

## HTTP-01 — Run one canonical Query through GET

Blocked by: EB-02 and the accepted ADR-0036 authority projection.

Start red with one bounded Query whose generated client must call its exact
`GET /_questpie/query/<qualified-name>` endpoint. Drive the canonical endpoint
descriptor through compiler normalization, App Contract, executable binding,
generated declarations, Query URL and Context-header codecs, Fetch routing,
the existing Operation executor, and decoded client result. Bind
`QP-COMPOSE-028` and `QP-COMPOSE-029`; reject unsupported/unbounded GET input,
noncanonical query bytes, duplicate/unknown input, malformed Context, and raw
Route collisions. Prove direct/Fetch/client parity, cancellation cleanup,
nondisclosure, deterministic artifact bytes, and no POST fallback.

## HTTP-02 — Run Mutation and Action, then delete the old route

Blocked by: HTTP-01 and EB-03.

Start red with one Mutation replay and one Action ambiguity case using their
visible kind-specific POST endpoints. Drive exact `{ input, context }` decoding,
case-insensitive JSON charset handling, Idempotency-Key, Effect-Key, optional
Call Identity, timeout, credential-before-decode ordering, committed-result
recovery, and Action outcome classification through the same executor and
generated client. Finish the slice by deleting the polymorphic Operation route,
private client transport, retained-pair routing, and compatibility fixtures in
one atomic change. Hostile tests must prove the old path is absent rather than
redirected or translated.

## HTTP-03 — Emit the complete OpenAPI and explain projection

Blocked by: HTTP-01 and HTTP-02.

Start red from one application containing Query, Mutation, Action, direct-only
Operation, and raw Route. With `projections.openapi: true`, emit one complete,
deterministic OpenAPI 3.1 document from the same canonical endpoint and codec
artifacts used at Runtime. Cover parameters, request bodies, results, declared
errors, the fixed applicable framework failures, nullability, bounds, inferred
namespace tags, operation IDs, omissions with Origins, stale deletion, and
`questpie explain`. Reject unknown configuration and operation-ID/path
collisions. No OpenAPI-specific schema, prose, path, security, handler, or
fallback authoring enters production.

## HTTP-04 — Close reference consumers and network hostiles

Blocked by: HTTP-01 through HTTP-03.

Move Team Support Desk generated calls to the canonical endpoints and make
Collaboration the authority/nondisclosure hostile consumer. Prove PostgreSQL 17
commit, rollback, replay, Policy invisibility, credential outage, deadline, and
Action ambiguity through real Fetch and generated-client calls. Prove Firefox
Network tools expose Query, Mutation, and Action names and the old polymorphic
path never appears. Finish public guide snippets, package/declaration checks,
independent Standards and Spec reviews, `quality:release`, two byte-identical
release dry-runs, owned-resource cleanup, and `git diff --check`.

## EB-10 — One runnable collaboration backend journey

Blocked by: EB-02 through EB-09 and the production PostgreSQL/realtime tickets.

- install the published package, build, migrate, seed, start, call a Query and
  Mutation directly and over Fetch, watch immediate Live Query, receive a
  Reaction, call a raw webhook Route, execute an Action, run/schedule/checkpoint
  a Job, restart during work, and inspect diagnostics;
- fenced TypeScript blocks in public guides compile against the generated
  contract;
- the fixture is an application backend, not an artifact browser or Studio.

## Verification discipline

For every implementation ticket:

```bash
bunx oxfmt <only changed files>
bun run check:changed -- --test <focused-test> --typecheck <workspace>
git diff --check
```

Run the prescribed red test before implementation and record what failed.
Before every commit, fetch `origin/feat/v4`, inspect shared-worktree movement,
and stage only paths written by that ticket.
