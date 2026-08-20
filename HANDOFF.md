# QUESTPIE v4 handoff

## Current accepted outcome

QUESTPIE v4 is a docs-first rewrite. Public documentation projects Accepted
ADRs; v3 is behavioral evidence only. The working rule is “v3 jobs, v4
ownership and invariants, the fewest new public concepts.” The reviewed BETA-01
structural compiler now emits exact relocated application, Package, and client
contracts. Accepted BETA-02 implements the bounded schema, migration, and
immutable Seed lifecycle at reviewed head `dca711f0`, evidence head `5a4681ca`,
and merge `b630fb01`. Accepted BETA-03 adds the first bounded
Service/Context/execution Runtime tracer at reviewed head `f830e48c`, evidence
head `1e2a367a`, and merge `a7d24541`.
Accepted BETA-04 adds the first Policy-scoped Message Query tracer at reviewed
head `7918bac0`, evidence head `a1a4265b`, and merge `275cad0c`.
Accepted BETA-05 adds the immutable Runtime Build and executable generated
direct, Fetch, and client paths at reviewed head `884b5d8a`, evidence head
`61f4ae85`, and merge `740f2e00`.
Accepted BETA-06 adds the first idempotent Message Mutation, compiler-owned
write programs, transactional receipt, and pending Reaction intent at reviewed
head `ef37bd6b`, evidence head `f9879efd`, and merge `0d1f35dd`.
Accepted BETA-07 adds the first watchable Message Query through compiler-owned
change capture, a durable Change Ledger, no-affinity SSE delivery, and crash
recovery at reviewed head `d25d9388`, evidence head `dfa46116`, and merge
`8edfa11a`.
Accepted BETA-08 executes the Reaction that BETA-06 accepts through the shared
durable kernel: run, physical attempt, opaque lease fence, append-only history,
stable effect ledger, durable cancellation, and an audited maintenance surface,
at reviewed head `d0aedd54`, evidence head `78e81b67`, and merge `8389cf5f`.

Fixed accepted proof authority:

| Contract                             | Accepted head                              |
| ------------------------------------ | ------------------------------------------ |
| Foundation data/query                | `d03358b749c4c8efb769d1c0fed50e8fbf983fb0` |
| P1 executable Definition compiler    | `713485a64bcc4795d960d576fea51da56bc4dcdd` |
| P2 Context and Policy                | `5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` |
| P2R1/BETA04 authority reviewed       | `f8e12ead9f667ecc2c6e5478a3071b7f23e67099` |
| P2R1/BETA04 authority evidence       | `2ae1981740102ede7a5fc1e567b9645bd9d6fbe6` |
| P3 Query/Mutation/lifecycle          | `a09bf55f0e22f65e059cda9f3eda914520dd4f9d` |
| P4 Live Query/ledger                 | `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` |
| P5 dispatch/Reaction                 | `3f8618613bde1bdd7e13863970eb1c140e201c6f` |
| P6 Runtime/client/Studio             | `94c237c9aa910a60a332b1ef97473f34fe89d65b` |
| P6R1 post-commit reviewed            | `deea51ba2799867825b120ec46ec5d8944991d1b` |
| P6R1 review evidence                 | `cb568dc402462163d632a2d689da709a087f64ae` |
| P6R1 accepted projection             | `d5bf7d0adadcda0f5b932e6b1a7c20df0e4102a6` |
| Post-P6 gates                        | `a164e33e752ab54d48fcf903371938ecff3dc082` |
| Reviewed post-P6 repair              | `79d7816dbf0b9b6e052706daf71fe173e1cbfc42` |
| #17 Service/Route/Auth               | `79d3667019e0a4cda6f7652d24f2d9c6b68d4fca` |
| #18 lifecycle/durable kernel         | `71463e99a70481b0950ae18d1ff409c034c1b158` |
| #19 HA/optional acceleration         | `96829bd7b08ea54e60fdc7d5b077366235d2dfea` |
| #20 File/Search/projections          | `6e056bc44c15740b2797a9489fe3823c3100bdad` |
| #21 kernels/naming/exports           | `d50d4334b116a5bdc46e95cdabf566d8db938d37` |
| #22 repository foundation            | `17008b0547f24b53d456530b798e8d96ae2e2b1e` |
| #14 conformance map                  | `3a89c565cb1eba59815d106df1c06406ac20ac98` |
| #15 beta.1 slice                     | `0d8e2543ff7e9d50bdab7d2b66b62ec4c35d8a6f` |
| #301 API ergonomics reviewed proof   | `ff2dfa762c953f2511c5f65e6f930bac3da77868` |
| #301 API ergonomics evidence         | `fbbf05d457f97927dc2b847b0ad049f26d887151` |
| #289 BETA-02 reviewed implementation | `dca711f06ca4b3cc58adbc7b2e56799cabd4839a` |
| #289 BETA-02 evidence                | `5a4681cae262309af3f8fd8edbc77feccec9cb24` |
| #290 BETA-03 reviewed implementation | `f830e48c554b027afcb13efea6d3f900fd8c7ece` |
| #290 BETA-03 evidence                | `1e2a367a72a7e012685912eccfa21d2085ac9b17` |
| #291 BETA-04 reviewed implementation | `7918bac0c7d579142fc4882c23f6a61e82dc1a51` |
| #291 BETA-04 evidence                | `a1a4265b886eb86c133433f6fa84b699457b1258` |
| #292 BETA-05 reviewed implementation | `884b5d8a5f051b23d34705be9916140629187509` |
| #292 BETA-05 evidence                | `61f4ae85b8ebebc1c5fb888707cd4f7e589ed985` |
| #293 BETA-06 reviewed implementation | `ef37bd6b5fedef555f39e2e02a6e08fa1f2bce3c` |
| #293 BETA-06 evidence                | `f9879efdfb2921ed747d353b6cb903398e9d67c3` |
| #294 BETA-07 reviewed implementation | `d25d9388bdbe9a0512de155a79f01d2191d6eaa7` |
| #294 BETA-07 evidence                | `dfa461162fdb211382708b9ad2a30cf10b564015` |
| #295 BETA-08 reviewed implementation | `d0aedd54dc6420b48e632590a6c2319f8516bc9f` |
| #295 BETA-08 evidence                | `78e81b67dfc41f612b0b36cf4cf5e0bafb0995ce` |
| #317 P22R1 reviewed implementation   | `4463708e56a72e26f65b8d1d3a2c5d0bf5cd6d4b` |
| #317 P22R1 evidence                  | `27d6f4f9`                                 |

ADR-0008 through ADR-0024 and their accepted workbench/public projections are
product authority. The exact review heads, BLOCKED/repair history, digests,
commands, measurements, and remaining implementation edges live in
`docs/v4/research/framework-api-atlas/PROOF-MAP.md` and each proof acceptance
manifest. Do not reopen an accepted gate unless new authority directly changes
it.

The accepted surface has one scalar, relational, durable, and Fetch kernel with
restricted projections; seven generated executable factory kinds; Package and
client isolation; PostgreSQL as the only hard durable dependency; Policy as the
only authored authorization model; B-tree-only public Index; and no RLS claim.
Optional cache, wake broker, Channel carrier, and byte storage are named
capabilities, never durable authority or a provider matrix.

## Workspace and preservation

- Main authority worktree: `/home/drepkovsky/code/questpie-v4`, branch
  `feat/v4`, latest accepted merge head
  `8389cf5f80b1e2a4684dfb00faa10bcd83c93605` (BETA-08, PR #320). An earlier
  revision of this line still named BETA-06's merge `0d1f35dd`, two accepted
  slices behind.
- The accepted BETA-02 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-02`, branch `feat/v4-beta-02`.
  Reviewed implementation head `dca711f06ca4b3cc58adbc7b2e56799cabd4839a`
  and evidence head `5a4681cae262309af3f8fd8edbc77feccec9cb24` are
  immutable review evidence; PR #304 merged them to `feat/v4`.
- The accepted BETA-03 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-03`, branch `feat/v4-beta-03`, at
  implementation head `f830e48c554b027afcb13efea6d3f900fd8c7ece` and
  evidence head `1e2a367a72a7e012685912eccfa21d2085ac9b17`. PR #305
  merged it to `feat/v4`; issue #290 is closed.
- The accepted BETA-04 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-04`, branch `feat/v4-beta-04`, at
  reviewed head `7918bac0c7d579142fc4882c23f6a61e82dc1a51` and evidence
  head `a1a4265b886eb86c133433f6fa84b699457b1258`. PR #308 merged it to
  `feat/v4` at `275cad0c1d25251dc5d1ca1835a1316769218d7c`; issue #291 is closed.
- The accepted BETA-05 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-05`, branch `feat/v4-beta-05`, at
  reviewed head `884b5d8a5f051b23d34705be9916140629187509` and evidence
  head `61f4ae85b8ebebc1c5fb888707cd4f7e589ed985`. PR #311 merged it to
  `feat/v4` at `740f2e0049a64f5a541f33ab8da44cf8e114041b`; issue #292 is closed.
- The accepted BETA-06 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-06`, branch `feat/v4-beta-06`, at
  reviewed head `ef37bd6b5fedef555f39e2e02a6e08fa1f2bce3c` and evidence
  head `f9879efdfb2921ed747d353b6cb903398e9d67c3`. PR #312 merged its final
  CI repair head `281e3d25ff1b1f80f399c61e38eb496d0686cc7d` to `feat/v4`
  at `0d1f35dd8685fdeb55c76547a6775df994f41315`; issue #293 is closed.
- The accepted BETA-07 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-07`, branch `feat/v4-beta-07`, at
  reviewed head `d25d9388bdbe9a0512de155a79f01d2191d6eaa7` and evidence
  head `dfa461162fdb211382708b9ad2a30cf10b564015`. PR #313 merged it to
  `feat/v4` at `8edfa11a8d62afbd867c4a1e1b6551241d89667e`; issue #294 is closed.
- The accepted BETA-08 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-08`, branch `feat/v4-beta-08`, at
  reviewed head `d0aedd54dc6420b48e632590a6c2319f8516bc9f` and evidence
  head `78e81b67dfc41f612b0b36cf4cf5e0bafb0995ce`. PR #320 merged it to
  `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`; issue #295 is closed.
- **In progress, not accepted:** the BETA-09 implementation worktree is
  `/home/drepkovsky/code/questpie-v4-beta-09`, branch `feat/v4-beta-09`. It
  carries unmerged production source and its own working-tree changes. It **has
  merged `feat/v4`** at `5066187a`, so the merge base is `4078c057` and the
  divergence is seven documentation commits rather than the fork-point gap an
  earlier revision of this entry described — read
  `docs/v4/implementation/beta09/README.md` before touching it. Do not discard
  or reset this worktree.
- The pre-consolidation projection is recoverable at archive commit
  `90288796` on branch `archive/v4-pre-consolidation-20260814`.
- The unrelated marketing worktree `/home/drepkovsky/code/questpie`, branch
  `agent/marketing-pages`, remains outside v4 implementation scope.

Use the repo-owned `.agents/skills/questpie-v4/SKILL.md` after this file. It
routes design, proof, implementation, public documentation, and repository
quality work to directly linked procedures. Repository package scripts and CI
are executable command authority; personal skill paths are not dependencies.

## Active frontier and blockers

Atlas tickets #14–#22, the #16 implementation-collapse proof, BETA-01 issue
#288, and interstitial API gate #301 are accepted. #301 merged through PR #302
at `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9` and does not count toward the
native N=5 implementation queue. BETA-02 issue #289 is accepted through PR
#304 and tracker closure. BETA-03 issue #290 is accepted through PR #305 and
tracker closure. BETA-04 issue #291 is accepted through PR #308 and tracker
closure. BETA-05 issue #292 is accepted through PR #311 and tracker closure.
BETA-06 issue #293 is accepted through PR #312 and tracker closure. BETA-07
issue #294 is accepted through PR #313 and tracker closure. Interstitial
repository-quality gate #317 is accepted through PR #319 and tracker closure; it
pins the acceptance packet, proves the pinned reviewer before the packet is sent,
makes a no result terminal, and adds credential-free record verification, while
keeping exactly one reviewer and introducing no second provider and no new ADR.
It does not count toward the native implementation queue. BETA-08 issue #295 is
accepted through PR #320 and tracker closure. BETA-09 issue #296 is now the
active frontier. The accepted foundation
includes:

- Bun 1.3.14; TypeScript 6.0.2 as canonical bridge; native TypeScript 7.0.2 as
  one non-blocking forward lane because 7.0 lacks a stable programmatic API;
- changed/full/release/PostgreSQL/forward/micro/load/soak quality lanes;
- report-only Knip with only zero-noise unresolved/unlisted/binary classes
  blocking;
- separate correctness, microbenchmark, load, and soak/chaos evidence;
- PostgreSQL 17 CI, nightly/manual HA/fanout/worker/rolling/optional-loss load,
  tagged stable-runner release, OIDC provenance, CONTRIBUTING and SECURITY;
- a portable five-branch router skill and deterministic stateless Claude
  Opus-medium acceptance wrapper.

The native beta.1 queue is #288–#299. Accept one bounded tracer through normal
review, CI, merge, and tracker state before enabling its immediate successor.
Do not skip a blocked issue or parallelize dependent implementation.

## Latest verification

- #295 took four fresh stateless Opus-medium protocol v2 rounds, all
  byte-preserved in `docs/v4/implementation/beta08/`. Initial head `e1fec4eb`
  received `BLOCKED` with eleven findings. The first was procedural and blocked
  reading the rest: two changed `.ts` files carried literal NUL separators, so
  git classified them binary and the reviewer never saw the acceptance and
  protocol paths. The others included a codec failure classified
  `HANDLER_FAILED` and retried to exhaustion, a cancel-requested run re-admitted
  for a needless recovered attempt, a maintenance winner test that proved
  precondition rejection rather than single-winner election, an effect recovery
  clause with no executed path, and budgets pinned into the compatibility
  contract that nothing enforced. Head `8f538203` closed all eleven and received
  `BLOCKED` for four more, all introduced or exposed by that repair. Head
  `29a6861c` closed those and received `BLOCKED` for one: the published
  maintenance surface implements four of the seven properties Gate 8 names and
  disclosed none of the gap. Reviewed head `d0aedd54` implements expected-version
  fencing and the append-only maintenance audit, discloses the absent
  maintenance Authority as a narrower claim naming BETA-09 as its owner, and
  received `PASS`.
- #295 lesson recorded for later slices: the round-1 finding that a budget table
  can be pinned without an enforcing path generalizes. The accepted head pins
  only `claimBatch`, `eventsPerRun`, `payloadBytes`, `resultBytes`, and the retry
  horizon, and deliberately drops `activeAttemptsPerPrincipal`,
  `pendingRunsPerResource`, `deadLettersPerResource`, and the whole retention
  block from the compatibility contract the Runtime Build digests. That is
  correct for the slice and leaves the durable kernel pinning no
  noisy-neighbour budget at all; `durable_runs` stores `tenant_id` while
  admission orders only by `(available_at, run_id)`.
- #295 second lesson, from auditing round 4's twelve observations against the
  tree: **grep-shaped conclusions failed three times in one audit, in three
  different directions, for three different actors.** The pattern is concluding
  from the presence or absence of a _name_ what can only be concluded from
  reading the _code_.
  - _Absent name, wrong "no"._ `relational-nondisclosure.json` is named nowhere
    in `artifact-files.ts`, which read as "nothing verifies it". It is verified,
    through `build.inventory`, which covers every generated file without naming
    any. Settled on `feat/v4-beta-09` by tampering with the artifact and
    asserting the refusal, rather than by reading a second time.
  - _Present name, wrong "yes"._ `"durable maintenance requires a trusted
Principal"` matches a test, which read as coverage. That test trips the
    Execution root's brand check in a different file on a different code path.
  - _Present name, wrong subject._ Five `"fenced"` assertions exist, which read
    as the fence being driven. All five are kernel surfaces; the effect ledger's
    separate compare-and-set has none.
    The cheap defence is the one the branch used: when a claim is about whether
    something is _enforced_, break it and assert the failure. A test that breaks
    the thing cannot be satisfied by a name appearing somewhere. Reading is for
    finding candidates, not for settling enforcement.
- #295 third lesson, from measuring the BETA-09 design records: **a decision
  carrying both a correctness reason and a performance reason kept leading with
  the performance one, and the performance one kept failing measurement.** Three
  instances, each measured on PostgreSQL 17.10:
  - _"A total is a scan"_ justified omitting counts. A count over the same
    indexed predicate is an Index Only Scan at 0.47 ms for 2,000 rows. The
    surviving reason is that `countOracle: "absent"` is a nondisclosure
    commitment the operational lane matches.
  - _Cost_ justified rejecting `SERIALIZABLE` for the backlog cap. It admits
    **fewer** than the cap — three against a cap of five — because conflicting
    transactions abort. The surviving objection is the caller experience:
    transient retryable errors on the write path.
  - _Planner pruning_ justified deriving the fair-admission slice hint from the
    batch. The planner is nearly indifferent between `turn <= 8` and
    `turn <= 1000` (21.1 ms against 19.3 ms). The surviving reason is fairness —
    the hint bounds one tenant's contribution to a round.

  A fourth was found afterwards **by applying the rule rather than by stumbling
  into it**, which is the evidence that it works. Sweeping the records for
  performance-shaped words with no number nearby turned up "who cancelled what
  today has no source at acceptable cost". Measured, a global time-ordered audit
  feed over 200,000 rows costs 31.8 ms from the shipped indexes and 0.072 ms with
  a time-leading one — usable, not unacceptable. The true statement is that the
  cost is linear in audit size and nothing prunes the audit, so it grows without
  bound while one index removes it.

  In all four the decision was right and the stated reason was wrong, which is
  the dangerous shape: a reviewer who disproves the reason has grounds to doubt
  the decision. The rule is to measure a performance justification before writing
  it, or lead with the correctness one and let the performance claim follow only
  if it has a number. The sweep that finds these is one pass for words like
  cheap, expensive, faster, scan, or proportional with no figure within a few
  lines; expect most hits to be noise, since "scan" is also a verb.

- #295 GitHub Actions run `32076598594` is green on evidence head `78e81b67`
  across cached full quality, PostgreSQL 16/17/18 correctness, TypeScript 7
  forward conformance, and the selected-PR PostgreSQL microbenchmark gate, which
  needs the `performance` label on the pull request to run at all. Local
  PostgreSQL 16/17/18 measured 105/105/108 passing with zero failures across 26
  beta08 scenario tests; `bench:micro` measured 400.075 ms against a 2500 ms
  budget and `test:load` 330.045 ms against 2000 ms.
- #295 round 4's twelve observations were audited one by one against the tree,
  with four different outcomes. **One closed:** PostgreSQL 18's three extra
  passes are the `skipIf`-gated catalog cases in `beta02-catalog-reader.test.ts`
  — NOT ENFORCED checks, PERIOD constraints, and a non-inherited NOT NULL — each
  driving a construct only 18 has, so the difference is the version gate working.
  **One refuted:** the claimed effect-ledger/maintenance lock-order inversion is
  unreachable, because `FOR UPDATE` appears nowhere in `postgres-effects.ts` and
  its only `durable_runs` access is a bare fence `SELECT`, which takes no row
  lock. **One part stale.** **Three confirmed, all the same shape** — declared,
  implemented, driven by nothing: the effect fence (criterion 4's fourth surface,
  no test asserts it), the maintenance brand refusal (the only test matching its
  message trips the Execution root's check in a different file), and the
  `cancellationRequested` event (asserted as a field on `inspect()`, never read
  back as a kind from `events()`). Each has a written falsification in
  `docs/v4/prototypes/durable-evidence-gaps/FINDING.md`. Roughly half of what
  was accepted as minor was not real, which is the argument for auditing a
  review's observations rather than carrying them.
- #295 PR #320 merged normally to `feat/v4` at
  `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`, and issue #295 is closed. P16 now
  derives BETA-09 as the sole agent-ready frontier.

- Verification for accepted slices before BETA-08 is archived in
  `docs/v4/prototypes/accepted-slice-verification/ARCHIVE.md` — review rounds,
  reviewed and evidence heads, CI runs, merges and per-slice lessons for #294
  and older. **That archive is the only copy**: this file used to say the
  material lives in `PROOF-MAP.md`, and it does not.

## Open cross-slice findings

Recorded during BETA-09 design work, verified against the tree, and **owned by
nobody yet**. Each names its owner and takes no decision. They live under
`docs/v4/prototypes/` and are listed here because the skill routes here first
and would otherwise never surface them.

- **`authority.isSystem()` can never be true at runtime.** The public
  `Authority` type has one member and the only construction site always builds
  it, while the glossary, the relational layer, and the Policy authoring surface
  all assume two classes. The collaboration fixture's membership Policy is
  therefore satisfied by nobody, expressed as though it were satisfied by system
  callers. `docs/v4/prototypes/authority-contract-gap/FINDING.md`
- **Context bootstrap is a third read path with no Policy.** It is tightly
  bounded — one row, exact primary key, explicit selection — and its bounds are
  documented. What is not documented is that a bootstrap read's safety depends
  entirely on the provenance of its key values, a property the accepted
  projection's own example demonstrates without naming. Same record.
- **Durable admission scans the whole eligible set.** The `OR` between the two
  eligibility branches defeats `durable_runs_claim_idx`; three index-ordered
  branches merged run 31× faster on 50,000 ready runs. Measured.
  `docs/v4/prototypes/tenant-share-control/MECHANISM.md`
- **The runtime enforces no server-side statement or lock timeout.** Two
  accepted bounds are client-side hopes, measured: a client cancel leaves the
  backend running, and only `pg_cancel_backend` stops it. Maintenance can block
  without bound on `FOR UPDATE`.
  `docs/v4/prototypes/statement-timeout-gate/DECISION.md`
- **The accepted budget table measures on the wrong axis.** It bounds a
  Principal where the glossary makes Tenant the isolation identity.
  `docs/v4/prototypes/tenant-share-control/DECISION.md`
- ~~**The Studio packaging fork is narrower than it looks.**~~ **Resolved by
  ADR-0024:** beta.1 ships no Studio assets. The earlier alternatives remain
  evidence in `docs/v4/prototypes/studio-packaging/FINDING.md`; none is current
  release work.
- **Four of seven authoring factories have no runtime behind them, and the
  absence is typed rather than merely missing.** Action, Job, Workflow, and
  Route are generated into `#questpie/app` as
  `type EmptyDefinitionFactory = (definition: never) => never`
  (`fixtures/collaboration/.questpie/generated/app.ts:184`, applied at
  `:198`–`:201`). Nothing is assignable to `never`, so authoring one is a
  **compile error at the call site, not a silent no-op**. The runtime end is
  closed too: `RuntimeExecutableInventoryBinding`
  (`packages/runtime/src/application/bindings.ts:19`–`:35`) is a union of
  query/mutation, reaction, context and service only, its switch at `:146`–`:158`
  has no other case, and `:163`–`:176` returns just `operations` and
  `reactions`. Deferred by accepted authority and not a defect, but it caused
  three separate corrections in one record set, because an authored name is not
  evidence of a runtime.
  `docs/v4/prototypes/authority-contract-gap/AUTHORED-VS-BUILT.md`
- **Three accepted durable properties are driven by no test.** The effect fence,
  the maintenance brand refusal, and the `cancellationRequested` event are each
  named in a criterion, present in code, and asserted by nothing. Each has a
  falsification written out — what to break and what must then fail.
  `docs/v4/prototypes/durable-evidence-gaps/FINDING.md`

This list is maintained by hand and has already gone stale once. Treat
`ls docs/v4/prototypes/` as authoritative for what exists.

## Next invocation

BETA-09 issue #296 is re-scoped by ADR-0024 to backend maintenance
compatibility. The unaccepted `feat/v4-beta-09` branch is evidence only and is
not a merge candidate: retain bounded reason, evaluated maintenance Authority,
typed denial/current winner and protocol compatibility by fresh TDD against
`feat/v4`; drop Studio UI, mount, projection, worklist and inspection read
model. After BETA-09 passes, proceed directly to BETA-10's ten-instance fair
admission and rolling-compatibility fixture.

The analysis below predates ADR-0024. It is retained as decision provenance;
where it asks whether to finish or descope Studio, ADR-0024 answers **descope**.

### The finding that changes the plan

**What blocks building a real application on this framework is not Studio.** Of
the seven generated authoring factories, three have a runtime — Query, Mutation,
Reaction. `defineAction`, `defineJob`, `defineWorkflow`, and `defineRoute` are
generated as uncallable stubs — `(definition: never) => never` at
`fixtures/collaboration/.questpie/generated/app.ts:184`,`:198`–`:201` — and the
runtime binding union has no member that could represent them
(`packages/runtime/src/application/bindings.ts:19`–`:35`). ADR-0021:30-33 lists
them absent from beta.1. `beta-slice-p15/SLICE.json` names "raw Route and reference Auth
composition" and "Job and checkpointed Workflow vertical" under `laterBetas` —
planned, seamed, and with **no slice in `QUEUE.json`**, which covers only
`4.0.0-beta.1`.

So an application built on beta.1 gets Queries, Mutations, Reactions, Policy,
live query, migrations, and three call paths — and cannot define a custom HTTP
route or a scheduled job.

**The user-facing docs did not say this**, and that is now fixed — see the
first item below. The `docs/v4/` projections always disclosed the deferral in
their _Deferred seams_ sections; the guides did not inherit it.

### Ordered work

1. ~~**Scope `apps/docs` to beta.1 by removal.**~~ **Done at `1d85b472`.**
   15 guides → 13, boundary from `beta-slice-p15/SLICE.json`. Two removed, two
   renamed after surgery, four pruned. The cut's reasoning and the two guides
   the mapped list missed are in the record named in item 2.
2. **The beta.1 documentation gap.**
   `docs/v4/prototypes/beta1-documentation-gap/FINDING.md`
   Fourteen findings from scoping `apps/docs`, each verified at `c54b30ac`,
   sorted into four classes — grounded, invented, accepted-but-unbuilt, and
   precise-but-overstated. **Only "invented" admits a cut**; cutting an
   accepted-but-unbuilt claim moves the docs away from the accepted position.
   The two that dominate the rest: `defineQuery` accepts five keys where every
   guide example passes seven, and output inference is unimplemented, which
   together account for nearly every compile failure in the guides. One factory
   and one missing feature, not general rot.
   Blocked on the owner: `durable-reactions.mdx` (Action explanation, the
   `ctx.actions` member that is not in `ReactionContext`, and the `:233` link
   the cut left dangling — one decision settles all three), the four invented
   Runtime limits, whether Query should gain an operation-level Policy at all,
   and which application the guides teach.

3. **Prove the embedding — and the claim it was going to prove is false.**
   `createApp()` exposes `fetch(request: Request): Promise<Response>`
   (`packages/runtime/src/application/index.ts:111`). An earlier revision of
   this line said Hono, Elysia, Next route handlers and TanStack Start server
   routes "all mount it mechanically". **They do not, at a sub-path.**

   `packages/runtime/src/application/index.ts:436` gates on exact pathname
   equality — `if (new URL(request.url).pathname !== operationPath)` → 404 —
   with `operationPath = "/_questpie/operation"`
   (`packages/runtime/src/operation/wire.ts:7`). The realtime carrier does the
   same at `packages/runtime/src/application/realtime/carrier.ts:159-160`.
   There is no base-path, prefix, or mount option anywhere in
   `packages/runtime/src` — the only `prefix` hits are key paths in
   `mutation/collection.ts:60` and filesystem Origin prefixes in
   `compiler/src/runtime/application.ts:45-50`.

   So `app.fetch` mounts mechanically **at the host root only**, where the
   pathname arrives unmodified. A Next route handler is at a sub-path by
   construction, and `app.route('/api', …)` in Hono or `.group()` in Elysia
   produce the same thing: inbound `/api/_questpie/operation`, which 404s
   unless the host rewrites the URL back to app-absolute.

   This was never a discovery — `docs/v4/design-fiction/run-and-deploy.md:285-290`
   already says it, in accepted text: "it is not a Hono, Elysia, Next.js,
   Express, or Cloudflare adapter… QUESTPIE does not promise lifecycle parity
   across a host adapter matrix." The handoff asserted the opposite of its own
   projection, and the tree sides with the projection.

   **Still unmeasured, and now the measurement is worth more:** no test drives
   `app.fetch` behind any outer router. The existing coverage in
   `tests/integration/beta05-runtime-client.test.ts` drives it with real
   `Request`s (`:406`, `:444`, `:455`, `:462`, `:540`, `:563`, `:612`), so the
   `Request → Response` contract itself IS measured; the `fetch:` callbacks at
   `:419` and `:474` are the generated client's outbound transport, not a host
   mount. What needs a test is the mount boundary: root-mount passes,
   sub-path-mount 404s. **Blocked in-tick** — that suite needs a workspace
   build first (`packages/questpie/dist` is stale: "Export named 'durable' not
   found"), and building writes under `packages/`.

   This lands on open ADR question 2 below. "How much router must the compiler
   own" is not abstract: literal path identity is enforced at runtime today.

4. **Decide BETA-09.** Finish narrowly or descope. Descope costs an ADR-0021:23
   amendment plus `implementation-gates.md:438` and `:451`, and needs
   `blockedBy` on BETA-10 repointed to BETA-08 — the chain 09 ← 10 ← 11 ← 12 is
   strictly linear, so nothing after it moves until this is settled. **Owner
   decision.**
5. **BETA-10**, multi-instance correctness. Not optional for any real
   deployment.
6. **BETA-12**, managed PostgreSQL and the release cut.
7. **Open slices for Route + Auth and for Job + Workflow.** These do not exist
   and are what the goal actually needs.

**BETA-11** (archive portability) proves the kernel generalises to a second
domain. Valuable for the framework, not on the path to shipping one application
— the strongest candidate to defer.

### Route: decided, with two questions left open

Decided with the owner, grounded in ADR-0015 and the tree.

**Route stays, and the reason is narrower than "raw HTTP is sometimes needed".**
Query, Mutation, and Action all assume the caller is the generated client. Route
is for callers you do not control — a payment provider, an OAuth server, a
browser upload. ADR-0015:30 frames it the same way, and its non-goals forbid
"Modeling a raw Route as an Action or generated JSON Operation". The concrete
case is the signature check in
`docs/v4/service-route-and-auth-composition.md:44`: it reads the exact body bytes
before any parsing, which a typed input contract cannot supply. Convex, the model
the Query/Mutation/Action trio draws on, needed the same escape hatch alongside
its `action`.

**Provider primitives do not replace Route; they compose with it.** `createApp()`
exposes `fetch(request: Request): Promise<Response>`
(`packages/runtime/src/application/index.ts:111`), so the host framework owns the
outer server and forwards Requests to that seam. Routes then live inside the
compiled app and keep the credential resolver, cancellation, deadline,
Route-safe Service scoping, and compiler overlap diagnostics. Moving them out to
a host route inverts the framework's value: the riskiest code — webhooks,
callbacks, uploads — would get the fewest guarantees.

**This composition is narrower than "mounts as a subtree", which is what an
earlier revision of this line said.** Item 3 above has the grounding: pathname
equality is exact (`application/index.ts:436`,
`realtime/carrier.ts:159-160`) and no mount-prefix option exists, so a subtree
mount 404s until the host rewrites the URL. The argument for keeping Route
survives unchanged — it never depended on sub-path mounting — but the seam a
host actually gets is root-mount or an explicit rewrite, not a subtree.

**Two questions this leaves, both ADR-level rather than implementation choices:**

1. **Must `app.fetch` remain the only server entrypoint?** ADR-0015 says yes and
   lists "authored server entrypoints" under non-goals. Mounting one Route
   natively in a host router is an amendment.
2. **How much router must the compiler own?** Overlap diagnostics need literal
   path identity; mounting could be a thin per-provider adapter. The emitted
   `routes` map already exposes `direct()`, but `direct` deliberately does not
   resolve credentials, so it is not that adapter.

Nothing here is built — `route`, `action`, `job` and `workflow` have no runtime
binding the union can represent (`application/bindings.ts:19`–`:35`) and their
generated factories are uncallable by construction
(`generated/app.ts:184`,`:198`–`:201`) — so this is a live decision, not a sunk
cost. It also sets the floor on the Route + Auth slice: the work starts at the
binding union and the compiler's emitted inventory, not at a missing module.

### Still open from this slice

- A **term was projected before its gate**: `Operational Fact` was added to
  `CONTEXT.md` while BETA-09 has never been reviewed, and the design branch
  projects terms only after `PASS`.
  **Take the argued exception, not the revert.** The rule was broken in the
  letter — `f092d618` added it during an unaccepted slice — but the term
  projects no unbuilt capability. It names a category over four terms that are
  already accepted vocabulary and already implemented: `Durable Run`,
  `Physical Attempt`, `Effect Identity` and `Lease` each have a `### ` entry in
  this glossary and code under `packages/runtime/src/durable/`. Nothing in
  `packages/*/src` is named for the term itself, which is expected of a
  superordinate.
  Checked mechanically that it is the only instance: `git diff 8389cf5f..HEAD --
CONTEXT.md` returns exactly one added `### ` heading, and one commit touched
  the file. So this is a single deliberate addition, not drift.
  Reverting also costs four records that reference it — `HANDOFF.md`,
  `docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md`, and the two under
  `docs/v4/implementation/beta09/` — two of which are actively edited.
  **What would overturn this:** the definition growing to cover a fact only
  BETA-09 introduces, at which point it would be projecting ahead after all; or
  an owner reading the gate rule as unconditional, in which case content does not
  matter and the revert stands. Formally recording the exception is still the
  owner's, not mine.
- **Record-set health is tracked separately.**
  `docs/v4/prototypes/record-set-health/FINDING.md` holds the citation audit,
  the skill verification, the `SPEC.md` §16 gap, and the
  `beta09/owner-decisions.md` pointer defects, with the method notes that
  produced them. Four items there need a person:
  **`SPEC.md` §16 omits ADR-0022 and ADR-0023**, both Accepted, and ADR-0023
  supersedes a post-commit edge `SPEC:583`–`:590` still states in full;
  **`review:accept:verify` is still unwired into CI** though `proof.md`'s own
  trigger fired when BETA-08 merged; **`owner-decisions.md` carries six pointer
  defects** whose underlying claims are all true; and **the eight divergences D3
  batches are enumerated nowhere**, so that gate has a count and no membership.
- **Criteria 19-22 have no derived status.** The branch re-derived 1-17; the file
  holds 22. An earlier revision of this line said 18-22. **Criterion 18 is
  covered**, in a different file:
  `feat/v4-beta-09:docs/v4/implementation/beta09/narrower-claims.md:107` records
  "Criterion 18 is now measured: 255 ms against a 5,000 ms budget". Verified on
  the branch. `acceptance-shape.md`'s "Criterion 18 is covered, in a different file"
  paragraph had already corrected itself; the correction had not reached this
  file. (That pointer was a line range until it had moved three times under my
  own insertions — `:355` to `:361` to `:377` — each move caught by the sweep
  rule but only because the sweep ran in the same commit as the edit. Naming the
  paragraph ends the maintenance.)

```text
Use the repo-owned QUESTPIE v4 skill. Read HANDOFF.md first, then
docs/v4/implementation/beta09/README.md.

Repo /home/drepkovsky/code/questpie-v4, branch feat/v4. BETA-09 worktree is
/home/drepkovsky/code/questpie-v4-beta-09 on feat/v4-beta-09.

CONTEXT. BETA-01..08 are accepted and merged. BETA-09 (minimal Studio) is
unaccepted, implemented on its branch, and reaches no operational fact. The
queue chain 09 <- 10 <- 11 <- 12 is strictly linear.

THE THING THAT MATTERS. Studio is not what blocks building an application on
this framework. defineRoute, defineJob, defineWorkflow and defineAction are
generated as UNCALLABLE stubs -- (definition: never) => never at
fixtures/collaboration/.questpie/generated/app.ts:184, applied at :198-201 --
so authoring one is a compile error, not a silent no-op. The runtime end is
closed too: RuntimeExecutableInventoryBinding
(packages/runtime/src/application/bindings.ts:19-35) has no member that could
represent them. ADR-0021:30-33 lists them absent from beta.1; SLICE.json names
Route+Auth and Job+Workflow under laterBetas with no slice in QUEUE.json.
Scope those slices from the binding union and the generated declaration, not
from "a missing module" -- the floor is higher than that phrasing suggests.

The apps/docs guides no longer document them. That cut landed at 1d85b472:
13 guides remain, scoped by removal, not by callout -- the owner rejected
callouts because the guides must read as a finished product.

DO, IN ORDER.
1. Settle durable-reactions.mdx with the owner. It is the one guide the cut
   could not touch, and it now has two problems with one root: it explains
   external effects through the deferred Action capability (:86, :97, :170),
   and its :233 link to ./durable-jobs-and-workflows now points at a removed
   page. Deciding how a shipped Reaction performs an effect settles both.
2. Write one test for the app.fetch mount boundary, and do not expect it to
   pass everywhere. app.fetch gates on exact pathname equality
   (application/index.ts:436 against operationPath "/_questpie/operation" at
   operation/wire.ts:7; realtime/carrier.ts:159-160 does the same) and has no
   mount-prefix option, so it works at the host ROOT and 404s under a sub-path
   -- which is where a Next route handler lives by construction. Assert both
   halves. Needs a workspace build first: packages/questpie/dist is stale
   ("Export named 'durable' not found").
3. Bring the owner the BETA-09 decision with its cost stated: finish narrowly,
   or descope via an ADR-0021:23 amendment plus implementation-gates.md:438 and
   :451, repointing BETA-10's blockedBy to BETA-08.
4. Once 3 is answered, proceed on BETA-10 then BETA-12. Treat BETA-11 as
   deferrable.
5. Draft slices for Route+Auth and Job+Workflow. They do not exist and they are
   what the goal needs.

DISCIPLINE, learned the hard way this session and non-negotiable.
- An authored name is not evidence of a runtime. Before depending on a
  mechanism, name the file that executes it.
- Reading finds candidates and settles nothing. A claim about whether something
  is enforced needs the thing broken and the failure asserted.
- Measure a performance justification before writing it, or lead with the
  correctness one. Four decisions in this set led with a performance reason that
  failed measurement while the decision itself was right.
- When you correct a fact, grep the tree for its most distinctive token before
  calling the correction done. Five staleness fixes here were applied only where
  they were noticed.
- Verify every claim with file:line. Cite branch-only paths as
  feat/v4-beta-09:path, since the acceptance packet reads git show
  <reviewedHead>:<path> and a bare path will not resolve.
- Citations have TWO axes and they decay separately. Axis one, existence and
  range: audited at 3a084099, 121 v4-tree citations, none past EOF, none naming
  a missing file. That one is done; do not re-derive it. Axis two, does the
  cited line say what the sentence claims: NOT covered by that audit, and it is
  where the defects actually are. 81907d85 found two at
  statement-timeout-gate/DECISION.md, off by one and two lines. A content pass
  over durable-evidence-gaps/FINDING.md found a third: it cited
  worker.ts:300-304 for "counting the refusal and continuing" when the counter
  is refusedIncompatible += 1 at :294 and :300 is a field inside the pushed
  record. All three resolve, all three sit in the right function, all three
  point at the wrong statement. "None is stale" was never a claim about content.
  Numbers are a third axis and that one IS worth automating, because it
  converges. Roughly thirty figures across the guides are now checked against
  the tree; the results are in item 2 above. Grounded exactly: the whole
  realtime table, maximumItems 1-1,000 and container depth 8
  (field-contract.ts:197-202), callId 1-256 scalars / 1,024 bytes / NFC
  (call-identity.ts:14,:17-19), physical name 63 bytes, heartbeat 10 s and
  attempt deadline 5 min (durable-kernel.ts:61-62), payload and result 256 KiB,
  active roots 64 and drain 30 s. Not grounded: the four Runtime limits, the
  JSONB byte bound, the 255-character Resource Name bound, and one overstated
  word about page size. Do not re-derive the grounded ones.
  Two traps if you rerun axis one, both of which produced false positives the
  first time:
  (a) 66 further citations point at v3 paths -- packages/questpie/src/server|cli
  |client/, packages/workflows/, packages/admin/ -- which are ABSENT from
  feat/v4 on purpose, because v3 is behavioral evidence; they are not broken;
  (b) a regex for packages/... matches inside feat/v4-beta-09:packages/... and
  reports correctly-prefixed branch citations as missing files. Both
  studio-mount.ts citations are already correct.

  Axis two does NOT automate, and this was tried rather than assumed. A checker
  that pulls backticked identifiers from the sentence and looks for them within
  three lines of the cited position flagged 33 of 149 citations. Excluding
  markdown table rows -- whose neighbouring cells contribute unrelated
  identifiers -- still left 25 of 125. Six were spot-checked against the source
  and all six were false, from three causes the heuristic cannot separate from a
  real defect: a range citation `:464`-`:483` whose identifier sits later in the
  range; a sentence citing two files where the identifier belongs to the other
  one; and a dotted name like `ctx.values` whose head is not what appears in the
  code. A 20% false-positive rate is the "forty false positives" trap this
  repository already learned once -- such a checker gets run once and ignored.
  Read a sample instead: nine read by hand produced the two real defects at
  81907d85.

- Absence claims in the record set were swept and all hold. This is the class
  the repository already burned itself on -- grep-shaped conclusions failed
  three times in one BETA-08 audit -- so the negative result is worth not
  re-deriving. Verified: `tenant_id` is in no index, and tree-wide rather than
  only on `durable_runs` (no CREATE INDEX in schema/postgres names it, across
  the three tables carrying the column); `grep durable` over
  packages/runtime/src/application/index.ts returns exactly 0, so the request
  router really has no durable route; `accepted_at` appears only in
  acceptance.ts:63's INSERT column list, and inspect() selects `available_at`
  and `terminal_at` only, so no read returns it; `statement_timeout` and
  `lock_timeout` appear nowhere in packages/runtime/src; nothing prunes any
  `durable_*` table. What makes these sound where BETA-08's were not is that
  each names its search scope in the record, so the claim and its check are the
  same shape.
  **Re-checked under the positive-control rule below, since four of these rested
  on a grep returning empty and an empty result proves nothing on its own.** Each
  pattern was re-run against a case known to be positive: the index pattern finds
  0 for `tenant` and 8 for `state`; the `statement_timeout` grep finds 0 under
  packages/runtime/src and 1 under packages/compiler/src; `grep durable` finds 0
  in runtime/src/application/index.ts and 23 in
  compiler/src/runtime/application.ts; the delete-target pattern finds 0 against
  `durable_*` and 12 against `questpie_internal.*` overall. All four instruments
  demonstrably fire, so all four absences are real.

- A sweep that finds nothing is only worth reporting if you have shown the
  instrument can find something. Run it against a case you already know is
  positive first. Three times this run that step decided whether a clean result
  was real:
  (a) the Accepted-ADR sweep at eeec5093 first returned zero defects. The
  identifier regex excluded hyphens, so it could not have matched
  QP-COMPOSE-023 -- the one gap already known. Fixed, re-run, and only then
  reported;
  (b) the guard probe at 6327ca25 issued an unguarded INSERT and required it to
  fail with 42501 before testing that ALTER TABLE ADD COLUMN passes. Without
  that step a passing DDL against absent guards looks identical to one against
  live guards;
  (c) the CHECK migration at b5a4285e asserted the widened constraint still
  rejects an unknown code, because a constraint dropped and never replaced
  would let the migration "pass" just as convincingly.
  The cost is one extra command. The failure it prevents is reporting a green
  result produced by a broken check, which is worse than not checking.
  The same rule has a mirror worth stating: **a truncated read manufactures
  false positives as readily as a bad pattern manufactures false negatives.** I
  nearly reported `ROUTE-SHAPE.md`'s citation of
  `beta08/acceptance-manifest.json:120` as stale, because I inspected that line
  through `cut -c1-110` and the quoted clause sits past column 110. The line is
  criterion 13 and the citation is correct. When a line disagrees with the claim
  citing it, read the whole line before concluding — manifest and SQL lines in
  this repository routinely run past 200 characters.

Run bunx oxfmt on only the files you wrote, never across docs/. Then
bun run check:changed and git diff --check. Commit each increment and push.
For a change touching packages/ or tests/, that bare form is NOT enough: the
changed lane runs a test only for each --test you name and a typecheck only for
each --typecheck workspace you name (scripts/quality.ts:128-130). Use
  bun run check:changed -- --test path/to/test.ts --typecheck <workspace>
as references/implementation.md:11 specifies. Bare check:changed on a docs-only
change is correct, and it runs format and git diff --check -- NOT lint. oxlint
runs only when a changed file is lintable, and lintable is .js/.jsx/.mjs/.ts/.tsx
(scripts/quality.ts:94-97). Markdown is formatable (:73-93, .md and .mdx are in
that set) but never lintable, so a docs-only run does format plus git diff
--check and nothing else. Do not read a green docs-only gate as having linted
anything.
```
