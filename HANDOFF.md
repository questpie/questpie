# QUESTPIE v4 handoff

## Authority and delivery rule

Public documentation projects Accepted ADRs. `SPEC.md` owns product behavior,
`CONTEXT.md` owns canonical language, and `docs/v4/DELIVERY-FLOW.md` owns the
current tracer-led workflow under ADR-0027. V3 is behavioral evidence only.

Historical proof heads, blocked reviews, measurements, and transcript digests
live in the frozen `docs/v4/research/framework-api-atlas/PROOF-MAP.md` and
individual acceptance artifacts. Do not copy those ledgers into this living
handoff. Runtime and artifact integrity digests remain required product data.

## Workspace safety

- Canonical implementation worktree:
  `/home/drepkovsky/code/questpie-v4`
- Canonical branch: `feat/v4`
- Expected working tree at this handoff: clean
- `feat/v4-beta-12` at `ed9b4578` is an ancestor of the consolidated branch.
  The branch remains as a rollback checkpoint; its former beta worktree was
  removed after consolidation.
- The pre-consolidation `feat/v4` head is preserved at
  `backup/feat-v4-pre-consolidation-20260823`. Unreviewed whitepaper, research,
  and visual notes are preserved separately at
  `research/v4-autopilot-notes-20260823`; they are not product authority.
- The complete pre-consolidation dirty state is additionally recoverable from
  stash `pre-consolidation feat/v4 dirty research 2026-08-23`.
- Never run concurrent fixture compilation or release generation in the v4
  worktree. Bun's evaluator and generated directories are not isolated against
  concurrent writers.

Start every task with `git status --short`, then use the repo-owned
`.agents/skills/questpie-v4/SKILL.md`. Preserve unrelated changes.

## Accepted product baseline

BETA-01 through BETA-12 are implemented and accepted as the beta.1 core. The
checked package runs the collaboration and archive tracers on PostgreSQL 17.
The core includes deterministic compilation, migrations and immutable Seeds,
Context and Policy, Query, idempotent Mutation and transactional dispatch,
durable Change Ledger Live Query, Reaction execution, fenced maintenance,
multi-instance recovery, portability, and release/package verification.

ADR-0025 removes framework Channels. ADR-0026 accepts Action and one Job
Resource; Route and application-composed credential resolution remain owned by
ADR-0015. ADR-0027 replaces proof-phase sequencing with tracer-led delivery and
two risk tiers.

External release evidence remains honest:

- managed Supabase conformance is WITHHELD because credentials are absent;
- transaction-pool compatibility is not claimed;
- the tagged stable-runner gate, version tag, and npm publication require the
  release environment and human authority.

## Runnable regression skeleton

The first browser skeleton is established at
`tests/integration/postgres/collaboration-walking-skeleton.test.ts`:

```text
compile -> migrate -> seed -> start -> browser Query
        -> Mutation -> Live Query -> committed Reaction
        -> hard restart -> reconnect -> recovered Reaction
```

It uses a real generated client, isolated headless Firefox, disposable
PostgreSQL, the compiler-generated application credential resolver and Route,
Policy-authorized generated protocol calls, and the generated durable worker.
`questpie seed apply` and
`questpie start --port` are executable.

Every backend or beta.2 capability must keep this journey green. A shortcut may
exist only inside the fixture and must name its deletion owner. It may never
bypass Policy, transaction ownership, artifact integrity, Change Ledger, or
durable recovery.

## Production PostgreSQL closure

PB-01 through PB-04 are selected and implemented internally:

- `pg` is the sole future production Runtime driver;
- one Runtime owns one bounded ordinary Pool plus one direct listener Client;
- the deep PostgreSQL module owns transactions, cancellation, timeouts,
  listener recovery, rotation, shutdown, and migration sessions;
- database-mode immediate LISTEN/NOTIFY wake exists while the Change Ledger and
  periodic reconciliation remain correctness authority.

PB-05 is active. Generated production still constructs one Bun `SQL` pool, so
the one-Pool ownership flip is not complete. Completed prerequisites include:

- static Query and Context plans/linkers;
- execution-scoped Context cancellation factory;
- static Mutation transaction and Collection statements plus database invoker;
- static Durable claim, heartbeat, terminal, scheduling, inspection, effects,
  event, and maintenance adapters;
- protocol v6 retry-event catalog;
- Runtime-owned readiness prerequisites for protocol, application binding, and
  migration receipts;
- real statement, lock, and idle-in-transaction timeout controls;
- race-safe settlement when PostgreSQL terminates an idle transaction before a
  second statement or before COMMIT.

Remaining PB-05 work, in order:

1. **Completed through `fcec08d3`:** fixed set-based whole-schema catalog
   statements, pure column/constraint/index reducers, exactly five fixed
   executions, reader-equivalence/query-count hardening, and PostgreSQL
   hostiles. Do not reintroduce per-table or per-index catalog SQL.
2. **Completed at `0b25faae`:** complete database readiness—protocol catalog,
   schema fingerprint, and change-capture verification—runs in one
   repeatable-read/read-only snapshot.
3. **Completed through `62605756`:** representative readiness, Context, Query,
   Mutation, realtime, and Durable statement populations are instrumented
   through the actual transaction seams. The isolated instrumentation-hold and
   lock-shape controls are complete at `dfb1a50c`; the actual Mutation handler,
   realtime invalidation apply, and maintenance/reconciliation/retention owner
   paths are measured through production owners at `62605756`. Results remain
   provisional internal evidence and define no public ceiling.
4. **Completed at `66b047c1`:** private `bundle-core` and domain barrels expose
   the database-mode Mutation, Durable kernel/effect-ledger, and trusted-
   Principal maintenance facades over one injected transaction runner. Legacy
   Bun-compatible facades remain unchanged.
5. **Readiness completed at `7961f385`; bundle tracer active:** the
   compiler-owned database-mode sibling composes one Runtime-branded
   repeatable-read/read-only transaction and the exact 16 prerequisite,
   provider, catalog and change-capture descriptors. Add the bundle-only
   completeness tracer before the ownership flip.
6. Perform one atomic generated `createRuntimePostgres` ownership flip. In the
   same boundary remove generated Bun SQL construction and all production Bun
   compatibility paths; never add a temporary second Pool.
7. Re-run browser, saturation, cancellation, listener, rotation, shutdown,
   Mutation, Durable, and startup PostgreSQL evidence.

Compiler migration and Seed application keep their separately pinned direct
session until their own `pg` migration. Do not wrap arbitrary SQL in branded
statements at runtime.

## Next beta.2 verticals

The browser tracer now pulls Route/Auth first because its fixture-owned
Principal binder is the visible application-composition shortcut.

Recommended Route/Auth sequence:

1. **Completed at `ed9b4578`:** add a temporary fixture demo-cookie
   `/api/whoami` tracer and name its deletion in the same plan.
2. **Completed at `69ad1b7f`:** extract the existing Service owner so
   application Services can safely serve pre-Context ingress and retain
   streamed-response lifetimes through EOF, error, and cancellation.
3. **Completed at `e5a0618a`:** prove Runtime credential outcomes and Route
   execution with handcrafted closed bindings: resolved, resolver and
   zero-resolver anonymous, typed unavailable without downgrade, direct trusted
   Principal bypass, Fetch/direct handler parity, explicit Context transition,
   admission before work, cancellation, and response-body disposal through
   EOF, error, and consumer cancellation.
4. **Completed at `c7282030`:** compile and mount one application credential
   resolver and Route, then delete the fixture shortcut and all tracer use of
   the internal Principal binder.
5. **Completed in the Route/Auth closure following `c7282030`:** refresh only
   the derived generated/release artifacts, repeat the Firefox/PostgreSQL tracer
   and full release-sensitive verification, then adversarially review and close
   Route/Auth.

Follow ADR-0015's accepted `policy` and
`credentials: "application" | "none"` spelling. Do not add a framework Auth
provider or leak credential/session UI into QUESTPIE.

Action follows as two boundaries. The internal pre-wire direct kernel is
integrated through `f04a3810`: Runtime-owned opaque Effect Identity reaches the
handler, trusted execution facts and ordinary Authority are enforced, and only
external-effect execution Services are projected with owned cancellation and
cleanup. The focused public Action Kernel proof is integrated through
`c2e2fd08`; its replacement formal acceptance record verifies `PASS` against
the exact reviewed head. ADR-0028 now freezes required caller `effectKey`,
Runtime-scoped UUID Effect Identity, required semantic `inputBytes`,
`resultBytes`, and `durationMilliseconds` limits, additive Operation Wire v3,
explicit post-dispatch ambiguity, and direct/network parity. Production
Runtime ownership is integrated at `d23aca2d`: the private executor derives the
accepted Effect Identity, enforces semantic limits and Policy/deadline ordering,
and terminally owns one execution-lifetime external-Service dependency graph.
The graph is validated transitively before Service work; application-lifetime
Services remain ordinary/Route Runtime ownership rather than Action capability.
Compiler normalization, generated Policy/context projection and the direct
tracer are now the active Action boundary, followed by the exact Wire v3 client
and network adapter. Never hide Effect Identity in domain input, alias Mutation
`callId`, echo raw `effectKey` from framework failures, or add automatic Action
retry.

Ordinary Job is blocked by the PB-05 one-Pool flip and protocol v7 schema
generalization. Do not encode Job as a Reaction intent. Cron and checkpoints
follow only after direct, Mutation-owned, and delayed ordinary Job acceptance
passes through the shared kernel.

OpenAPI/MCP projections and authoring/documentation DX are pulled after these
working verticals. Studio remains outside the beta.1/beta.2 release sequence.

## Developer testkit

`packages/testkit` is private and now contains the first tracer-consumed
primitives: reverse-order aggregated cleanup, bounded `eventually`, and process
output readiness. The browser skeleton is their first application-facing
consumer.

Do not publish them yet. Public `questpie/test` promotion requires a second
application-facing consumer, shared repeated/concurrent disposal semantics,
bounded shutdown escalation, secret-redacted evidence, setup-failure cleanup,
and package-isolation proof. Artifact tampering, internal-table access, backend
PID/lock probes, and statement fault injection remain repository-only tools.

## Verification snapshot

At the current Action/PB-05 integration closure, `quality:full` passes in the
canonical worktree:
architecture, format ratchet, lint, typechecks, the complete
environment-selected test suite, Knip reporting, workspace build, skill
validation, and `git diff --check`. The release dry-run is retry-stable at the
accepted package checksum
`206d8641f2dce30a20b94c7588fdf1c56e91677b6aab0f997e6339becff20fe3`;
the declaration checksum is
`18ed5444bf1c9203b0a6263b2c54c84203b7a2227df993f3e2962ebf367e164b`.

Focused PostgreSQL evidence includes the real Firefox restart skeleton, Durable
maintenance/effect/kernel paths, timeout controls, and the 23-case PostgreSQL
module lifecycle suite. `quality:release`, architecture, typechecks, and
`git diff --check` pass at this handoff.

Route/Auth commit 1 was developed through two red-green cycles. The final
PostgreSQL 17 and headless Firefox tracer passes with 24 assertions, including
missing, wrong, duplicate, malformed, and unrelated-cookie cases; exact
`/api/whoami` response and cache/method headers; identity through Mutation and
hard restart; and the original durable recovery journey. Independent Standards
and Spec adversarial re-reviews both returned PASS.

Route/Auth commit 2 is complete at `69ad1b7f`. The extracted Service owner
serves application Services before Context Resolution, shares the same
application instance with ordinary executions, and retains execution Services
through Response EOF, stream error, and consumer cancellation. Focused runtime
integration, Runtime typecheck, architecture, full quality, release quality,
and `git diff --check` passed at that head.

Route/Auth commit 3 is complete at `e5a0618a`. Seven focused Runtime Route/Auth
tests pass with 46 assertions. Architecture, lint, all workspace typechecks,
and `git diff --check` pass. Parallel read-only `claude -p` Standards and Spec
adversarial re-reviews both returned PASS after hostile closure for forged
Principals, credential and handler cancellation, typed failure preservation,
resolver-bug sanitization, and admission-before-work behavior.

Route/Auth commit 4 is complete at `c7282030`. The compiler-generated
application now mounts one application credential resolver and Route through
the Runtime kernel; the fixture-owned `/api/whoami` shortcut and tracer use of
the internal Principal binder are removed. Hostile follow-ups close mount
limits, deadline and precedence behavior, aborted scopes, service projection
contracts, and the synchronous abort race.

Route/Auth step 5 is complete in this closure. The exact compiler-derived
goldens and release checksum are refreshed; the isolated PostgreSQL 17 and
headless Firefox tracer passes with 26 assertions. Eleven focused Runtime
Route/Auth tests pass with 69 assertions, including body-control cleanup,
zero-duration admission, malformed resolver outcomes, never-settling abort
drain, and late-response cancellation. `quality:full`, `quality:release`,
architecture, all workspace typechecks, and `git diff --check` pass. Independent
Standards review returns PASS. A separate authority adjudication confirms that
ADR-0015, ADR-0014, SPEC, and Gates 8A/8B define cancellation as the terminal
bounded execution-lifetime boundary; a non-cooperative handler cannot retain
Runtime scope ownership or block close after cancellation.

PB-05 catalog boundaries are integrated through `fcec08d3`: five fixed
whole-schema statement descriptors with closed decoders, then pure set-based
column and constraint/index reducers, followed by one exact five-statement
orchestrator. Eleven focused unit tests pass with 58 assertions. The isolated
PostgreSQL 17 reader-equivalence lane passes
16 cases with 40 assertions and three PostgreSQL-18-only skips, then removes its
dedicated `questpie-pb05-catalog-reader` container. Independent Standards and
Spec reviews return PASS for every boundary. The one-snapshot readiness boundary
is integrated at `0b25faae`; three focused tests pass with six assertions, and
the generated PostgreSQL readiness tracer passes with 30 assertions before its
dedicated container is removed. Compiler typechecks, architecture, and
`git diff --check` pass. Operational measurement is the active PB-05 slice.

The PB-05 operational inventory is integrated through `ac09f87a`. Its closed
provisional-only collector preserves database result/error identity and records
the actual statement populations and transaction ownership for readiness,
Context, Query, fresh/replayed Mutation, Durable claim/heartbeat/effect/
terminal/maintenance paths, and realtime reconciliation/apply/retention. The
realtime tracer proves apply shares the reconciliation transaction without
double attribution. Sixty-seven focused tests pass with 301 assertions. No
duration ceiling or public performance claim is projected; isolated PostgreSQL
idle-hold and lock-contention controls remain the active measurement boundary.

The bounded operational-control boundary is integrated at `dfb1a50c`. Twenty
focused tests pass with 61 assertions. Its exact database plus opt-in guard,
bounded blocker/settlement ownership, primary-error preservation, and cleanup
hostiles pass. In one serialized isolated PostgreSQL 17 session, both focused
control runs, the 1,000-sample Query and Mutation envelopes, and the
1,000-sample-per-operation Durable envelope pass; the repeated control snapshot
is structurally identical. The owned schema, container, port, and temporary raw
outputs are removed. Results remain `PROVISIONAL_INTERNAL_EVIDENCE` with
`publicCeilings: false`: marker/sleep holds prove instrumentation only,
simplified lock probes prove lock shape only, and blocker release is an
acquisition proxy. Actual Mutation-handler/realtime-apply and owner-path
contention evidence was still outstanding at that historical boundary and is
closed separately below.

The actual PB-05 owner-path measurement boundary is integrated through
`62605756`. The runner compiles and artifact-binds the collaboration
`message.publish` handler, measures the accepted Mutation handler and production
realtime invalidation callback on their exact owning transactions, and probes
the production Durable maintenance, reconciliation, and retention lock owners.
Two uncontaminated serialized PostgreSQL 17 runs are structurally identical:
16 Mutation and 16 realtime samples, eight samples for each contention owner,
24 observed lock waits, and zero semantic failures. The runner keeps the
Mutation/Durable QRN `application:collaboration` distinct from the realtime
ledger and retention name `collaboration`; this closes an exact namespace
hostile found by the measurement itself. The container, port, prepared fixture,
and raw output are removed after both runs. Timing distributions remain
`PROVISIONAL_INTERNAL_EVIDENCE` with `publicCeilings: false` and are not timeout
or SLA authority.

The database-mode facade boundary is integrated at `66b047c1`. Private
`bundle-core` and the Mutation/Durable domain barrels expose one injected-runner
composition for Mutation, Durable scheduling/claim/heartbeat/terminal/
inspection, the Effect Ledger, and trusted-Principal maintenance. Fifty-seven
focused tests pass with 264 assertions; Runtime typecheck and architecture pass.
No facade constructs a Pool, and the legacy Bun-compatible implementations are
byte-unchanged. The bundle completeness tracer remains the final prerequisite
to the atomic generated ownership flip.

The compiler-owned database readiness sibling is integrated at `7961f385`.
Runtime remains the single owner of branded PostgreSQL statements and the exact
protocol, application-binding and migration-receipt prerequisite descriptors;
compiler composition injects those owners and adds its fixed provider, catalog,
unsupported-object and change-capture descriptors inside one
repeatable-read/read-only snapshot. Twenty-two post-integration tests pass with
98 assertions; the brand/parity fixture, compiler and Runtime typechecks,
declaration-build closure, architecture and `git diff --check` pass. The old Bun
caller remains byte-unchanged until the atomic flip. A bundle-only completeness
tracer is the remaining pre-flip PB-05 boundary.

The direct Action pre-wire kernel is integrated at `8659ae87`, with external
Service capability projection completed at `f04a3810`. Eleven focused Action
tests pass with 42 assertions; the affected Runtime suite passes 40 tests with
189 assertions, Runtime and capability-negative typechecks pass, architecture
passes, and independent Standards and Spec reviews return PASS. At that
historical head the seam was internal only and selected no public Runtime
barrel, compiler/client contract, Operation Wire field, caller Effect Identity
grammar, or derivation; the later accepted proof closes those decisions.
The accepted Action Kernel proof is integrated at `c2e2fd08`. Its first formal
review returned a preserved `BLOCKED`; the repaired replacement packet returned
`PASS`, and `review:accept:verify` succeeds for
`action-wire-v3-effect-identity/REVIEW-REPLACEMENT.json`. The proof binds the
production durable Effect Identity owner and three legacy UUID vectors,
strictly closes caller material and Resource Identity grammar, pins semantic
limits and Wire v3 compatibility, and keeps framework ambiguity callId-only.
ADR-0028 projects that authority. Generated Policy/normalization, public direct
and client callers, and the real network adapter remain Product implementation
work; the accepted proof itself changes no production or generated bytes. The
private Runtime semantic owner is integrated at `d23aca2d`. Fifty-five focused
post-integration tests pass with 273 assertions across Action, Route, canonical
Mutation, Durable Effect identity and PB database facades; Runtime and Action
typechecks, architecture and `git diff --check` pass. Independent Standards and
Spec reviews pass after hostiles closed pre-Policy clock disclosure, host-timer
overflow, non-cooperative cleanup and direct or transitive application-Service
escape.

The final compiler-derived refresh changes only two hashed internal bundle
chunk identities, `internal/application.js`, its aggregate checksum, and
`runtime-build.json`; schema, migrations, Operation Wire, runtime executable
inventory, Policy, Service, and public declarations remain unchanged. The
generated relocation tracer passes with 25 assertions. A full Bun load exposed
and closed one test-only Action type-fixture execution leak while preserving its
negative type proof. The isolated PostgreSQL 17 plus Firefox walking skeleton
passes with 26 assertions and its disposable container, port, and schemas are
removed. `quality:full`, `quality:release`, architecture, all workspace and
focused Action typechecks, release dry-run, and `git diff --check` pass at this
closure.

## Immediate continuation

1. Confirm `/home/drepkovsky/code/questpie-v4`, branch `feat/v4`, and a clean
   status.
2. Start one failing generated direct/network Action tracer. Land compiler
   normalization, exact executable/artifact binding, generated Policy/context
   projection and the public direct caller through the integrated private
   Runtime owner until the direct leg is green. Then carry the same tracer
   through exact Wire v3 client/server transport and close browser, artifact and
   release evidence. Preserve the accepted no-retry and ambiguity semantics
   throughout.
3. Continue PB-05 with the bundle-only completeness tracer, then perform the
   atomic one-Pool ownership flip in its own serialized boundary. Preserve the
   measured owner paths as provisional evidence; do not derive public ceilings
   or overlap the flip with generated/release work.
4. Keep independent Standards and Spec reviews on each Action and PB-05
   integration boundary. The accepted Effect/Wire proof is immutable evidence;
   ordinary production projection now follows tracer-led TDD rather than a new
   formal acceptance round.
5. The canonical integration owner serializes generated/release builds and
   PostgreSQL schema-reset tests, and integrates each independently green lane
   commit one at a time.
6. Commit only coherent green boundaries; do not push, tag, publish, or contact
   external systems without explicit authority.
