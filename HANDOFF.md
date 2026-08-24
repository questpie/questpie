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
3. **Active:** measure representative readiness, Context, Query, Mutation, realtime, and
   Durable statement populations. Measure Mutation-handler and realtime-apply
   idle gaps plus maintenance/reconciliation/retention lock contention before
   deriving provisional internal ceilings.
4. Close remaining database-mode facades and `bundle-core` imports.
5. Perform one atomic generated `createRuntimePostgres` ownership flip. In the
   same boundary remove generated Bun SQL construction and all production Bun
   compatibility paths; never add a temporary second Pool.
6. Re-run browser, saturation, cancellation, listener, rotation, shutdown,
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

Action follows as two boundaries: direct Action first, then a focused public
Kernel decision for Operation Wire v3 Effect Identity before network/client
Action. Never hide Effect Identity in domain input or alias Mutation `callId`.

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

At the Route/Auth closure, `quality:full` passes in the canonical worktree:
architecture, format ratchet, lint, typechecks, the complete
environment-selected test suite, Knip reporting, workspace build, skill
validation, and `git diff --check`. The release dry-run is retry-stable at the
accepted package checksum
`c17d695eaa414ccc69d8fb7bf1ed3c88e1d4ee627a55443bb2725c98bf28d702`;
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

## Immediate continuation

1. Confirm `/home/drepkovsky/code/questpie-v4`, branch `feat/v4`, and a clean
   status.
2. Keep direct Action isolated in its writer worktree. Do not integrate any
   caller-facing Effect Identity spelling, validation, or derivation before the
   read-only authority review confirms it stays on the authorized side of the
   Operation Wire v3 decision boundary.
3. Continue the PB-05 operational measurement boundary without projecting
   provisional evidence as public ceilings. Do not perform the atomic one-Pool
   ownership flip alongside generated/release work.
4. Keep a read-only Effect Identity proof/review lane. Stop before the public
   Kernel decision; never hide Effect Identity in domain input or alias Mutation
   `callId`.
5. The canonical integration owner serializes generated/release builds and
   PostgreSQL schema-reset tests, and integrates each independently green lane
   commit one at a time.
6. Commit only coherent green boundaries; do not push, tag, publish, or contact
   external systems without explicit authority.
