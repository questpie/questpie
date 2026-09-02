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
Context and Policy, Query, idempotent Mutation and transactional acceptance,
durable Change Ledger Live Query, Reaction execution, fenced maintenance,
multi-instance recovery, portability, and release/package verification.

ADR-0025 removes framework Channels. ADR-0026 accepts Action and one Job
Resource; Route and application-composed credential resolution remain owned by
ADR-0015. ADR-0027 replaces proof-phase sequencing with tracer-led delivery and
two risk tiers.

External release evidence remains honest:

- the final one-Pool Runtime passes the existing product tracer directly on the
  selected CNPG and Supabase targets; the manual disposable targets and their
  cleanup are recorded below, while credentials stay outside the repository;
- transaction-pool compatibility is not claimed;
- the tagged stable-runner gate, version tag, and npm publication require the
  release environment and human authority.

## Team Support Desk reference application

The second application-facing v4 consumer is implemented at
`fixtures/team-support-desk` through code head `5fdb5adac`. It is a
production-like, tenant-aware support desk built only on the public v4
interface. Organization, Membership, Team, Ticket, Comment, and Label
Collections are split by domain locality with their Policy and Operation
definitions. The vertical covers lifecycle/server-derived Fields, paged and
filtered list/detail/search Queries with Relations, create/comment/edit/assign/
close/reopen Mutations, row-lock-backed concurrent close, a signed inbound
webhook Route, an HTTP notification Action with Runtime-owned Effect Identity,
Mutation-owned immediate and directly accepted delayed Jobs, retry,
cancellation, and hard-restart recovery.

The browser is a minimal React 19 and ReactDOM application compiled by Bun into
one minified bundle. Better Auth 1.7 owns email/password login, durable sessions,
and its React auth client. Public QUESTPIE Routes delegate `/api/auth/*` to the
standard Better Auth handler; the application Service validates sessions and
the credential resolver emits a user Principal. Organization, Membership, and
role session fields are non-authoritative routing hints: Context re-reads the
current Membership and Policy remains QUESTPIE-owned.

All application Query, Mutation, and Action traffic uses `#questpie/client`;
the only manual browser `fetch` lives in the explicit fixture-control module
for Firefox completion reporting. The host serves static tracer assets and
delegates every framework request, including auth, to `application.fetch`.
Generated app/client modules are the direct, network, and browser type
authority; the PostgreSQL tracer does not duplicate their request or response
contracts.

The tracer exposed and closed four narrow framework correctness defects:

- generated Collection `update` authority existed in declarations but lacked a
  PostgreSQL compiler/runtime program; it now executes one keyed row lock,
  fresh current and candidate Policy, sparse Field authority, pure candidate
  construction, server values, compare-and-set outcome, and authorized output;
- inspection of a directly scheduled delayed Job incorrectly required a
  failure code at attempt zero; the invariant now distinguishes initial delay
  from retry delay.
- executable-only third-party imports were incorrectly validated as structural
  source. Dynamic imports are now admitted only inside recognized executable
  Definition slots while module-level imports remain rejected by
  `QP-COMPOSE-010`.
- runtime Collection updates admitted an empty patch despite the Accepted
  contract. They now reject it before PostgreSQL; `ticket.addComment` uses its
  already authorized Ticket snapshot for Mutation-owned Job input instead of a
  server-value-only touch update.

The Better Auth extension tracer passes locally on PostgreSQL 17 and Firefox
with 60 assertions. It includes idempotent auth migration/seed, generated-client
browser use with a real Better Auth cookie, auth session survival plus Job
lease-expiry recovery after a hard host restart, direct generated operations,
the real HTTP Action receiver, signed webhook replay, delayed Job inspection,
retry, cancellation persistence, and a customer edit that omits the staff-only
priority Field. The concrete application friction and
proposed deeper seams—including the separate bounded auth pool, absent typed
Service configuration, and runtime-package bundling workaround—is recorded in
`docs/v4/implementation/team-support-desk/DX-EVIDENCE.md`; no React adapter or
new public client interface was added.

The final `quality:release`, PostgreSQL 17/Firefox tracer, Standards review, and
Spec review pass. The manual test host is loopback-only on `127.0.0.1:43120` and
Tailscale Serve adds only
`https://devbox.tail9c2c07.ts.net:8444/ -> http://127.0.0.1:43120`; existing
ports 443 and 8443 remain unchanged and Funnel is not enabled. The disposable
PostgreSQL 17 container listens on loopback port 55432. Remove only the desk
mapping with `sudo tailscale serve --https=8444 off` when the manual session is
finished.

## Runnable regression skeleton

The first browser skeleton is established at
`tests/integration/postgres/collaboration-walking-skeleton.test.ts`:

```text
compile -> migrate -> seed -> generated direct Action -> start -> direct Job
        -> browser Query -> Mutation with two Jobs -> Job/Reaction worker
        -> Live Query -> hard restart -> reconnect -> recovered Reaction
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

PB-05 is complete through `a4b1afbe`. Generated production constructs one
`createRuntimePostgres` owner with one bounded `pg` Pool and one direct listener
Client. Query, Context, Mutation, Durable and realtime all use its injected
database transaction seam. Production Runtime has no Bun SQL import,
construction, injected SQL facade, or Bun compatibility barrel.

The closure retains these prerequisites:

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

PB-05 integration history:

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
4. **Completed at `66b047c1`:** private `bundle-core` and domain barrels exposed
   the database-mode Mutation, Durable kernel/effect-ledger, and trusted-
   Principal maintenance facades over one injected transaction runner.
5. **Completed through `db5125f3`:** the
   compiler-owned database-mode sibling composes one Runtime-branded
   repeatable-read/read-only transaction and the exact 16 prerequisite,
   provider, catalog and change-capture descriptors. The private bundle-only
   completeness tracer proves that one injected runner reaches readiness,
   Context, Query, Mutation, Durable and realtime composition without an
   implicit Pool or Client. Existing conservative finite statement, lock and
   idle-in-transaction controls are sufficient internal safety defaults for the
   ownership flip. They are not public ceilings or performance claims.
6. **Completed through `6bd91955`, `19f3dd10`, and `a4b1afbe`:** the atomic
   generated ownership flip, root-cancellation repair, and removal of replaced
   production Bun SQL paths. The compiler ownership tracer pins one generated
   `createRuntimePostgres` call and the product tracer reads operational facts
   before and after close.
7. **Completed at `a4b1afbe`:** browser, saturation, cancellation, listener,
   rotation, shutdown, Mutation, Durable, startup and packed-package PostgreSQL
   verification. Historical compatibility/evidence tests whose only owner was
   a removed Bun facade or backend observer were removed with that facade.

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
The generated direct Action boundary is integrated through `0cdfa8d5`:
compiler normalization, exact executable/artifact binding, nested frozen
null-prototype server Operation maps, generated Policy/context projection and
the public direct caller all delegate to the one private Runtime owner. The
collaboration tracer executes the authored external-Service Action before the
existing PostgreSQL/Firefox journey and proves stable Effect Identity without
coalescing or retry. The private, non-projecting Wire v3 contract is integrated
through `454966aa`: compiler projection and Runtime validation independently
close the full retained v2/v1 and Action grammar, preserve canonical object-key
semantics, and negotiate incompatible Action requests before Context, Service
or handler work. Exact generated Wire v3 client/server transport is integrated
at `a5c16251` and delegates network execution to the same direct Runtime owner.
Never hide Effect Identity in domain input, alias Mutation
`callId`, echo raw `effectKey` from framework failures, or add automatic Action
retry.

The ordinary Job vertical is integrated through `a55dabf4`. Protocol v7
generalizes the physical acceptance ledger without encoding Job as a Reaction,
stores a positive semantic version on every Durable Run, and preserves existing
Reaction rows as version 1. Upgrading an existing installation to v7 is an
explicit safe non-rolling cutover; `questpie migration apply` refuses it unless
the operator supplies `--allow-non-rolling-protocol-v7`.

The compiler emits exact Job Definitions and executable bindings, a server-only
`accept` capability, and no `dispatch` alias or browser Job capability. Both
`app.execution.jobs.<name>.accept(...)` and
`ctx.jobs.<name>.accept(...)` use the same deep transactional owner. One
Mutation may accept several independently keyed Jobs, including absolute
`notBefore` work. Replaying an identical idempotency identity returns the same
receipt; changing canonical input, `notBefore`, or run-as conflicts.

Generated Runtime startup admits Job-only and mixed Job/Reaction artifacts into
one durable worker. Jobs and legacy Reactions share claim, heartbeat, retry,
cancellation, stale-worker fencing, settlement and restart recovery. Each
attempt creates fresh Execution, Context and Policy state before invoking its
handler. Cron, Collection triggers, checkpoint redesign, workflow orchestration
and generic browser Job control remain outside this boundary.

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

The ordinary Job vertical and its adversarial review repairs are integrated
through `ce01f0e32`. `quality:release` passes with architecture and format
ratchets, lint, all workspace typechecks and tests, package/release dry-run,
strict Knip, workspace/docs build, skill validation, all 19 owned performance
manifests and `git diff --check`. The complete registered PostgreSQL 17 lane
passes. Its local PostgreSQL/Firefox collaboration tracer passes 169 assertions
and proves direct, immediate, delayed, multi-Mutation and cancelled Job
acceptance; idempotent replay and conflicts; Job and legacy Reaction execution;
heartbeat, settlement, hard-restart recovery, fresh attempt authority,
current run-as refusal and stale-worker fencing; and `explicit` versus
`mutationDispatch` causation.

The unchanged product tracer also passed on both selected managed targets with
manual disposable provisioning and cleanup only:

- dedicated CNPG PostgreSQL 18.2: existing migrations plus 140-assertion tracer
  PASS in 45.5 seconds, then the logical database and owner role were removed;
- Supabase PostgreSQL 17.6: existing migrations plus 140-assertion tracer PASS
  in 54.4 seconds with `sslmode=no-verify`, then database, admin membership and
  owner role were removed.

No credential, provider receipt, provisioning/evidence harness,
`pg_stat_activity` observer, `pg_signal_backend` mechanism, transaction-pool
claim, Cron, Collection trigger, checkpoint, workflow orchestration or browser
Job control was added. The release artifact checksum is
`088eaf6bdf513de4944009bfd42fb3f1b3fdb6a1974a8308753fa6b032bd9304`;
the declaration checksum remains
`18ed5444bf1c9203b0a6263b2c54c84203b7a2227df993f3e2962ebf367e164b`.

Independent final Standards and Spec reviews of `2b1db967..ce01f0e32` both
PASS with no remaining findings. Their blockers were repaired and re-reviewed:
protocol-v7 admission now treats only SQLSTATE `42P01` as a fresh install;
Reaction Context uses an explicit capability whitelist; and the 100-command
acceptance bound reserves before persistence, including under 101 concurrent
calls.

The one-Pool PB-05 Product boundary is integrated through `a4b1afbe`.
`quality:full` and `quality:release` pass, including 577 local tests, strict
Knip, package contract, build, skill validation, release dry-run and all 19
owned performance manifests. Three orphaned manifests whose commands targeted
removed compatibility files were deleted with their stale baselines. The clean
PostgreSQL 17 lane passes every registered
integration file. Its collaboration walking skeleton passes 137 assertions and
checks generated Runtime facts at ready and closed lifecycle states.

The same existing collaboration product tracer passed without a repository
provisioning harness on both selected managed targets:

- dedicated CNPG PostgreSQL 18.2: manually created ordinary owner and C.UTF-8
  logical database, existing migrations plus tracer PASS with 137 assertions in
  38.4 seconds, then database and role removed;
- Supabase PostgreSQL 17.6: manually created ordinary owner and C.UTF-8 logical
  database after granting the admin membership needed for `SET ROLE`, existing
  migrations plus tracer PASS with 137 assertions in 48.5 seconds using
  `sslmode=no-verify` for the provider's self-signed chain, then database,
  membership and role removed.

No credential, provider receipt, provisioning code, `pg_stat_activity`
observer, backend termination mechanism, public timeout, SLA, or
transaction-pool compatibility claim was added. The release artifact checksum
is `ec444869bbdf40600028dd2fc28f82616722116e56d67052886b60a6de3504cf`;
the declaration checksum remains
`18ed5444bf1c9203b0a6263b2c54c84203b7a2227df993f3e2962ebf367e164b`.

At the earlier Action/PB-05 integration closure, `quality:full` passed in the
canonical worktree:
architecture, format ratchet, lint, typechecks, the complete
environment-selected test suite, Knip reporting, workspace build, skill
validation, and `git diff --check`. Its then-current release dry-run was
retry-stable; the current accepted checksums are recorded above.

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
tracer is integrated at `db5125f3`: one injected runner reaches the complete
private database-mode composition, realtime apply shares the reconciliation
transaction, retention remains separately owned, and an isolated hostile proves
zero implicit `pg` Pool or Client construction. Eight focused tests pass with
79 assertions; Runtime typecheck, architecture and `git diff --check` pass. The
remaining pre-flip PB-05 boundary is finite internal statement, lock and
idle-in-transaction evidence followed by the atomic ownership change; no public
ceiling is implied.

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

The generated direct Action Product boundary is integrated through `0cdfa8d5`.
The compiler emits one exact Action contract and executable slot, retains
Operation Wire v2 and its client bytes, and projects nested server Query,
Mutation and Action maps as frozen null-prototype objects. Same-kind
leaf/namespace collisions report both Origins and the absent namespace or
Augmentation authority; unsafe and noncanonical names fail before generation.
The generated Action owns only execution-lifetime external Services whose full
dependency closure is execution-owned, and delegates Policy, Effect Identity,
semantic limits, cancellation and cleanup to the one Runtime Action executor.
The serialized compiler tracer passes with 13 assertions. The isolated
PostgreSQL 17 plus Firefox walking skeleton passes with 109 assertions across
generated direct Action, Query, Mutation, Live Query and restart recovery; its
container, port and generated fixture output are removed. Archive portability
records three current local samples and derives a 4-second compile budget plus
a 2 MiB generated-byte budget; the selected-PR manifest is executable-bound to
the same values. `quality:full`, `quality:release`, package relocation, release
dry-run, architecture, workspace and focused Action typechecks, and
`git diff --check` pass. Independent Standards and Spec re-reviews return PASS.

The private Operation Wire v3 staging boundary is integrated through
`454966aa`. Ten focused tests pass with 82 assertions; the combined v2/v3
compatibility matrix passes 18 tests with 157 assertions. The compiler and
Runtime independently reject re-signed retained protocol/codec drift and
malformed Action codec/error contracts, while canonical object property order
remains non-semantic and nested array order remains exact. The accepted v3
digest `c7596e3eef673d11381f9c9c9a25f81308084dd0054b91cfa8ddf9afe45457a4`
is reproduced without changing the existing v2 projector or client. The seam
was subsequently carried through generated client/server transport at
`a5c16251`; retained-client and ambiguity coverage are closed there.

The first Deep-DX Query/Relations Product slice is integrated through
`679f24eb1`, with release artifacts closed at `41ef89481`. Collection-owned
`list` authoring now derives one handlerless named Query with bounded nullable
list parameters, object selectors, exact input/output codecs and generated
direct/network client bindings. Recursive to-one selection traverses up to the
current measured four-hop bound through one compiler IR, one PostgreSQL
lowering and one Runtime decoder; every reached target applies its own
admission, row Policy and conditional Field disclosure. Relation-only
observation, per-hop nondisclosure, disclosure-bound cursors, exact depth
diagnostics with Origin, and optional nested Operation codecs are covered by
hostiles. Team Support Desk deletes four combinatorial ticket-list Operations
and uses one `tickets.queue` Query through the generated browser client.
Focused Query/Relation verification passes 42 tests with 196 assertions. The
PostgreSQL 17 plus Firefox tracer passes with 63 assertions. `quality:release`,
architecture, all workspace typechecks, strict lint/Knip, package validation,
19 performance manifests, documentation build, relocation goldens and release
dry-run pass. The checked `questpie` tarball SHA-256 is
`a7ca1526120055ff08303e21817a1d471ba3ce9321cf7017f0729cd3354e8fc8` and
the declaration SHA-256 is
`92e42caebb4527e7be99a1ccfae550b635b977abd5d4cafcaaa360b3aac3133e`.

The current public durable-work guide is Job-first. It explains worker-owned
automatic heartbeat, the narrow reason to call manual heartbeat, cooperative
and observation-delayed `ctx.signal`, CPU isolation, and absolute `notBefore`
without claiming a public `sleepUntil` or progress payload. The Mutation guide
now explains that PostgreSQL owns `operationTime` through
`transaction_timestamp()`, exact-call replay reuses its stored receipt, and
database-owned `onUpdate` remains a later schema capability. These docs-only
repairs are integrated through `766ca5e69`.

The Deep-DX Policy/expression boundary and ADR-0030 Collection provenance and
trusted-values boundary are now integrated. ADR-0030 is Accepted and its Product
implementation is complete through generated create/update kernels and the
current Operation Set compatibility adapter. Collection Fields derive exact
create/update caller codecs; `server` and `immutable` provenance remains
orthogonal to nullability and database defaults; object-map `pick`/`omit`
preserves Field codecs. Caller `patch` and trusted `values` are independently
decoded, normalized and authorized, must not overlap, and form one complete
candidate inside the owning Mutation transaction. Update locks and rechecks the
current row, preserves compare-and-set behavior, applies sparse caller Field
authority before complete-candidate validation, then runs full candidate Policy
before PostgreSQL write, receipt and Change Ledger capture. Mutable Fields may
be supplied by either lane on different calls without granting caller authority
to server-owned Fields.

The generated Team Support Desk create/update Operations and the beta05
PostgreSQL harness exercise the compiler-owned kernels through the same Runtime
adapter used by named Mutations. The legacy Operation Set remains one temporary
compatibility projection, not a second CRUD kernel. Generic Operation codec
grammar and Collection Field codec projection each have one compiler owner;
Runtime Mutation linking and execution are separated behind the Mutation domain
seam. The complete focused post-repair lane passes 53 tests with 191 assertions,
the full PostgreSQL 17 lane passes including both Firefox reference tracers, and
`quality:release` passes. Two consecutive release dry-runs reproduce package
SHA-256 `bee891d02adc2fffe3f8151840a7337def2ebf7a2a1a9c9583a589c4dbf01573`
and declaration SHA-256
`41f9fb9298284876a088894f911d69bc7ba52a3018b9f793c1b553a4020020cb`.

The OpenTelemetry workbench at
`docs/v4/research/observability-2026/WORKBENCH.md` is research only. It creates
no accepted public or Runtime API.

ADR-0031 is Accepted after the manifest-bound lifecycle candidate
`ca7d18e3fce4b55bd0e0ce36aa212a48dcec7af1` received the committed
human-authorized GPT-5.6-sol high replacement `PASS` at
`1437338c9a605c171819adee184b1ac00ffc1d3c`. Exactly `normalize`, `validate`,
`check`, and `afterWrite`, payloadless Collection Issues with explicit
Operation-owned mapping, `ctx.now`, and database-owned `onUpdate: "now"` are
closed for implementation. The acceptance is recorded honestly as an explicit
provider exception, not as an Opus v2 artifact. Declared-unique `key` lookup,
typed `ConstraintViolation`, and always-generated get/list/delete remain
deferred.

ADR-0031 implementation is complete through LIFE-06. LIFE-01 through LIFE-03
are integrated through `2088b05f5`: the compiler lowers deterministic
`normalize`, `validate`, and Policy-aware `check` programs; Collection Issues
cross only explicit Operation mappings; Runtime executes them inside one
Mutation transaction and terminal shared budget.

LIFE-04 replaces the public lifecycle clock spelling with `ctx.now` and adds
timestamp-only `onUpdate: "now"` authoring. Caller and trusted lanes exclude the
database-owned Field, PostgreSQL installs a collision-safe exact `BEFORE UPDATE`
trigger/function pair, migration planning owns add/drop ordering, and Runtime
readiness fails closed with `QP-SCHEMA-028` for missing, disabled, replaced,
additional, or privilege-drifted objects. Team Support Desk carries the
committed migration and proves a restricted managed writer, returned and
selected values, Change Ledger capture, committed receipt replay, direct and
generated-client calls, and Firefox behavior on PostgreSQL 17. The tracer
passes with 83 assertions; independent Standards, Spec, and documentation
reviews pass. `quality:release`, two consecutive release dry-runs, and
`git diff --check` pass. The checked package SHA-256 is
`d1b28eab7ea19aa2b1559a2fb8736612a6d34805258149dc25988a88aabc3b16`; the
declaration SHA-256 is
`00877af5d2b8c0da6b57f4b061b0d567188bfd96c505bcafa8dad6400962c5fb`.

LIFE-05 and LIFE-06 are integrated at `b883c1451`. The compiler emits exact
phase capabilities and generated types for bounded Policy-aware get/list,
sequential nested Collection writes, and Job acceptance. Runtime decodes and
interprets only the closed phase grammar, rejects issue throws outside
`validate` and `check`, and charges every capability plus lifecycle-owned Job
SQL and returned rows to one terminal root budget. PostgreSQL executes list
plans, nested writes, and durable acceptance on the owning Mutation
transaction; rollback, cancellation, re-entry exhaustion, fresh retry, and
committed replay retain the ADR-0031 semantics.

Team Support Desk now owns the beginner lifecycle syntax and Collaboration the
hostile nested-write case. Superseded Operation Set normalizer/value callbacks
are gone. Explicit Operation Sets remain only for deliberately public
Operations and current Policy-aware lifecycle get/list capabilities; they
still compose the one generated Collection kernel and are not a lifecycle
compatibility implementation. The PostgreSQL 17 atomic tracer passes with 15
assertions and proves one transaction identity across root/nested writes,
durable acceptance, receipt, and Change Ledger plus rollback, replay, and fresh
retry. Team Support Desk PostgreSQL/Firefox passes with 83 assertions;
Collaboration passes with 284 and exactly one lifecycle-created published
event. The checked package remains SHA-256
`d800dfa96bcdfcad99454539b5b3525777e8f4e23897027ca963c583eb23388c`;
the declaration SHA-256 remains
`00877af5d2b8c0da6b57f4b061b0d567188bfd96c505bcafa8dad6400962c5fb`.
Final independent Standards and Spec reviews pass. `quality:release` and two
consecutive byte-identical release dry-runs pass at those checked hashes.

ADR-0035 is Accepted as a Product projection under ADR-0027. The exact clean
candidate `e909a8e14dc4b5e9f294f27df6bb9f27ef859efe` passed independent
replacement review after the retained-eviction hostile was closed; all eight
deterministic gates pass with 13 focused tests and 50 assertions. Only
compiler-proven watchable generated Queries gain `.observe(input)`. One
immutable generated `withContext(input)` scope owns canonical Query Resource
identity and a bounded 128-entry idle-LRU registry. Observation starts no work;
subscribers share one accepted watch; terminal failure and eviction require a
fresh observation. The scope has no disposal protocol and must remain an
ordinary iterative `const api = client.withContext(ctx)` value.

The optional exact-peer `@questpie/react` package owns only
`useQueryResource` over `useSyncExternalStore`. It adds no cache, transport,
retry, Mutation invalidation, global provider, SSR, Suspense, hydration, or
fallback behavior. Team Support Desk owns deletion of handwritten request
generation guards, Live Query state, late-delivery checks, and post-Mutation
refresh fan-out. Collaboration owns authority, Context, reconnect, rollback,
capacity, eviction, cancellation, and subscriber-lifetime hostiles.

ADR-0036 is Accepted after the exact replacement candidate
`33ff02a07fd28a0dd6ef4b4fbbbaf9a41c484a09` received the committed pinned
protocol-v2 `PASS` at `4cfe81dda`. Every network Query, Mutation, and Action has
one compiler-derived visible endpoint: GET `/_questpie/query/<name>`, POST
`/_questpie/mutation/<name>`, or POST `/_questpie/action/<name>`. Generated
clients and optional OpenAPI 3.1 derive from the same Resource identities,
codecs, Context, outcomes, Policy, cancellation, and executor. Raw Routes keep
their authored external-protocol paths. The former polymorphic endpoint is
deleted by the implementation tracer with no fallback, redirect, compatibility
handler, or parallel wire. Projection-neutral descriptive metadata is accepted
separately by ADR-0040.

ADR-0040 is Accepted after the exact repaired candidate
`df237a5938e9cd3d5b9529e899c067bbbca8d780` received the committed pinned
protocol-v2 `PASS` at `4360a4582b3f17e0791eaeaf3f3e1a38ada232f7`.
Query, Mutation, Action, and generated Collection Operation Set members share
one optional `describe` envelope with bounded summary/description and
codec-typed non-executable examples. The compiler owns one relocation-stable
documentation artifact and independent digest; documentation grants no
exposure, Authority, Policy, handler, or Runtime capability. `DOC-01` owns
production compiler/artifact/package parity and digest-independence evidence.
`DOC-02` owns OpenAPI/MCP/JSDoc/explain projection, target escaping,
disclosure/exposure parity, and request-time Runtime absence. The planned
public `skills/questpie` skill stays a separate portable framework skill, not
an application-generated projection.

ADR-0037 is Accepted as a Product projection under ADR-0027 after independent
Standards and Spec PASS. `questpie` exports only `DiscriminatedValue`,
`DiscriminatedReference`, and `matchDiscriminated` for ordinary TypeScript
disjunctions and branded reference values. They replace the copied public
recipe without creating a Relation, codec, generated descriptor, Policy
traversal, or Runtime polymorphic kernel.

The ADR-0037 implementation slice is closed. Unit, type, and packed-package
integration evidence proves heterogeneous return-union inference, the exact
three-export public-root surface, and the absence of codec or polymorphic
Relation companions. The executable prototype was deleted after production
parity. Independent Standards and Spec reviews, `quality:release`, and two
byte-identical release dry-runs pass.

## Immediate continuation

1. Confirm `/home/drepkovsky/code/questpie-v4`, branch `feat/v4`, and a clean
   status. ADR-0030 provenance/trusted values and ADR-0031 lifecycle/issue
   mapping are closed; do not recreate their proof, re-grill settled lifecycle
   direction, or create a parallel write kernel.
2. ADR-0032 accepts one bounded inverse child list through overloaded
   `comments.list({ first, orderBy, select })`, while root
   `tickets.list({ parameters, page, ... })` remains disjoint. Implement the
   accepted slice blockers-first through INV-01 to INV-06 in
   `docs/v4/implementation/inverse-tomany-projection/README.md`, using the
   existing relational compiler/Runtime kernel; do not restore `window`, add a
   second plural list, or create a parallel query kernel.
3. Keep Team Support Desk as the golden beginner/DX consumer and Collaboration
   as the hostile authority/Live consumer. Migrate progressively and delete
   `comments.page` only after the new `tickets.detail` path has PostgreSQL and
   Firefox evidence; preserve the nullable detail wrapper and existing
   notification Query call.
4. ADR-0031 and LIFE-01 through LIFE-06 are closed. Do not redesign or
   reimplement lifecycle, restore callback-based Operation Set normalization,
   or create a second Collection/CRUD kernel. Start the next vertical from its
   own accepted authority; OpenTelemetry still requires a separate docs-first
   decision before any implementation.
5. Implement ADR-0035 only from its tracer ticket ledger: framework-neutral
   Query Resource core first, then fixture deletion/hostiles, then the optional
   React adapter and public-doc verification. Delete the executable prototype
   after production parity; do not retain a compatibility Resource, callback
   Context scope, global cache, fallback poller, or second realtime kernel.
6. Implement ADR-0036 as one replacement tracer: compiler artifact and
   diagnostics, Runtime adapter, generated client, direct/network parity,
   OpenAPI/explain, PostgreSQL/browser hostiles, then atomic deletion of the
   polymorphic RPC path. Keep metadata and MCP outside this implementation
   slice and retain no fallback.
7. ADR-0037 is closed. Preserve the exact three-helper boundary and do not add
   a codec variant, polymorphic Relation, generated descriptor, registry, or
   compatibility alias.
8. Implement ADR-0040 only through `DOC-01` and `DOC-02`; keep one Operation
   `describe` owner and one documentation artifact, prove target escaping and
   stale deletion, and do not add codec/Field prose, projection-specific
   registries, Runtime reads, fallback behavior, or application-generated
   skills.
9. Treat OpenTelemetry as a separate docs-first decision. The research
   workbench may inform a future tracer, but it is not authority for exports,
   span names, attributes, sampling, exporters or persistence behavior.
10. Do not reopen the reference application by adding Cron, Collection triggers,
    checkpoints, generic browser control or workflow orchestration without new
    product authority.
11. Do not push, tag or publish without explicit authority.
