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
PostgreSQL, a temporary fixture demo-cookie `/api/whoami` ingress tracer, a
fixture-owned trusted demo Principal binder for generated protocol calls, and
the generated durable worker. `questpie seed apply` and
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

1. Replace the compiler catalog reader's per-table loop with fixed set-based
   whole-schema statements and pure reducers. Land descriptors/decoder tests,
   then columns, constraints/indexes, reader equivalence, and PG hostiles.
2. Run complete database readiness—protocol catalog, schema fingerprint, and
   change-capture verification—in one repeatable-read/read-only snapshot.
3. Measure representative readiness, Context, Query, Mutation, realtime, and
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
2. Extract the existing Service owner so application Services can safely serve
   pre-Context ingress and streamed-response lifetimes.
3. Prove Runtime credential outcomes and Route execution with handcrafted
   closed bindings: resolved, anonymous, unavailable, direct bypass, Fetch
   parity, and response-body disposal.
4. Compile and mount one application credential resolver and Route, then delete
   the fixture shortcut and all tracer use of the internal Principal binder.
5. Refresh derived generated/release artifacts only after the tracer passes.

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

After the documentation-only branch consolidation, `quality:full` passes in the
canonical worktree: architecture, format ratchet, lint, typechecks, the complete
environment-selected test suite, Knip reporting, workspace build, skill
validation, and `git diff --check`. The release dry-run is retry-stable at the
accepted package checksum:
`81a3ed5dabbba6e92fd6d715dc8d09776347379b21e4c968cc0ee5d8e1aa4a5c`.

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

## Immediate continuation

1. Confirm `/home/drepkovsky/code/questpie-v4`, branch `feat/v4`, and a clean
   status.
2. Start Route/Auth commit 2 test-first: extract the existing Service owner so
   application Services can serve pre-Context ingress and retain streamed
   response lifetimes through EOF, error, and cancellation.
3. Keep Route Product review separate from any new public Kernel/wire decision.
4. Serialize generated builds and PostgreSQL schema-reset tests.
5. Commit only coherent green boundaries; do not push, tag, publish, or contact
   external systems without explicit authority.
