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

ADR-0008 through ADR-0023 and their accepted workbench/public projections are
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

- #294 took four fresh stateless Opus-medium protocol v1 rounds, all
  byte-preserved in `docs/v4/implementation/beta07/`. Initial head `0a420838`
  received `BLOCKED` for re-framing a retained generation onto a fresh holder
  with no fresh root, a reconnect that was refused and surfaced a transport
  failure to application code, a baseline that disagreed with the manifest on
  the hosted gate, an untested 256 dependency-token cap, and wake prose the
  Runtime never enacts. Head `4f01bef3` closed all five and received `BLOCKED`
  for two defects introduced by that repair: a widened denial union that no
  production error could reach, and a re-frame branch that could never stage.
  Head `9318b819` received `BLOCKED` because its refusal mapping tested
  `instanceof DeclaredOperationError` while `context.error` builds a frozen
  plain `Error` with no class, so no refusal ever reached a client; the review
  found it by noticing that the design record and the tracer's passing
  assertion claimed opposite outcomes. Reviewed head `d25d9388` maps a refusal
  by the shape `context.error` actually builds, fences a refused binding at its
  invalidation generation, and received `PASS`.
- #294 lesson recorded for later slices: three consecutive rounds shipped a
  test that proved something other than what it claimed, because each injected
  a construct the production path cannot produce. Every repair in the accepted
  head is falsified against the unrepaired code, and the manifest pins an
  explicit typecheck of the changed test files because `tests/**` has no root
  tsconfig and is not covered by `check-types`.
- #294 GitHub Actions run `32029361604` is green on evidence head `dfa46116`
  across full quality, PostgreSQL 16/17/18, TypeScript 7 forward conformance,
  and the selected-PR performance gate. Local PostgreSQL 16/17/18 measured
  79/79/82 passing with zero failures; `bench:micro` measured 178.344 ms and
  `test:load` 7645.066 ms, both inside the committed budgets.
- #294 PR #313 merged normally to `feat/v4` at
  `8edfa11a8d62afbd867c4a1e1b6551241d89667e`, and issue #294 is closed. P16 now
  derives BETA-08 as the sole agent-ready frontier.

- #293 initial reviewed head `a550c3ac3d25965f4391b5a32fba29d0cfe4ce4a`
  received a fresh stateless Opus-medium `BLOCKED` for an untrue Mutation
  Service projection and unexecuted sparse-Field/candidate-Policy denial
  branches. Repaired head `7b37e8ec37f3f8fdb59b080e1a2edbcb15fda9e9`
  closed the denial evidence but retained the Service wording and received a
  second `BLOCKED`. Exact authority repair
  `76016e581f72ea9058a1fed3c784317934ff695d` pinned the no-Service boundary;
  reviewed head `ef37bd6b5fedef555f39e2e02a6e08fa1f2bce3c` then received
  fresh stateless Opus-medium `PASS`. All raw reviews are byte-preserved in
  `docs/v4/implementation/beta06/`.
- #293 release, architecture, package, Knip, TypeScript 7, hostile,
  PostgreSQL 16/17/18, and selected-PR performance gates are PASS. Final
  GitHub Actions run `31926134431` measured 20 PostgreSQL 17 Mutation
  transactions at 166.026 ms, a 168-byte maximum result, 41,030 public
  declaration bytes, and 19,276 TypeScript instantiations, all inside the
  committed budgets.
- #293 PR #312 merged normally to `feat/v4` at
  `0d1f35dd8685fdeb55c76547a6775df994f41315`, and issue #293 is closed. P16
  now derives BETA-07 as the sole agent-ready frontier.

- #292 initial reviewed head `a2a3c90f30d3c0845c1b2b7e6595574d89d1826f`
  received a valid fresh stateless Opus-medium `BLOCKED` with four findings:
  review-packet source shaping, a timestamp handler type mismatch, unproven
  private-package relocation, and an unmeasured compiler budget. Repaired
  reviewed head `884b5d8a5f051b23d34705be9916140629187509`
  received replacement `PASS`; raw findings are byte-preserved in
  `docs/v4/implementation/beta05/`.
- #292 focused changed, full, release, architecture, package, PostgreSQL
  16/17/18, TypeScript 7, generated Runtime/client, hostile, and selected-PR
  performance gates are PASS. GitHub Actions run `31913365744` measured BETA-05
  PostgreSQL 17 cold start at 91.162 ms and 20 wire executions at 62.622 ms;
  the final evidence head passed run `31913658818`.
- #292 PR #311 merged normally to `feat/v4` at
  `740f2e0049a64f5a541f33ab8da44cf8e114041b`, and issue #292 is closed. P16
  now derives BETA-06 as the sole agent-ready frontier.
- P6R1 initial reviewed head `d5c562d8e70e140f9736a5ab56815cb76cc313c5`
  received a valid fresh stateless Opus-medium `BLOCKED` for an unbound v2
  digest, missing v1 declared-error/result-kind continuity, and inconsistent
  v1 retirement. Repaired clean head
  `deea51ba2799867825b120ec46ec5d8944991d1b` received the single replacement
  `PASS`; raw reviews are byte-preserved in
  `docs/v4/prototypes/p6-postcommit-outcome/REVIEW*.json`.
- P6R1 preserves Operation Wire v1 digest
  `d9c28927d2ced07aaecc8d2cd8caf0f94327232b33d8466535642c2af1c9115c`
  and accepts Wire v2 digest
  `2f4cd0631be02ff8a979a0aaa22d0fd393d3638db55e4cc9bbb2db6d9a5ade28`.
  Wire v2 adds the exact post-commit transaction outcome while carrying v1
  result kinds and declared errors forward. Retained v1 Queries may execute;
  v1 Mutations fail before Context Resolution or Operation execution.

- #291 initial reviewed head `f2c1f7be06deaf6ebca9e934c64be0a290034172`
  received a valid fresh stateless Opus-medium `BLOCKED` with three findings:
  an unbounded materialized page plan, a mocked PostgreSQL performance claim,
  and an unreviewed authority revision. Repaired reviewed head
  `7918bac0c7d579142fc4882c23f6a61e82dc1a51` received the single replacement
  fresh stateless Opus-medium `PASS`. Raw findings are byte-preserved in
  `docs/v4/implementation/beta04/`.
- #291 focused changed, full, release, architecture, package, PostgreSQL
  16/17/18, generated-contract, hostile, and selected-PR performance gates are
  PASS. GitHub Actions run `31892854190` measured PostgreSQL 17 execute20 at
  37.725 ms, planning at 0.422 ms, execution at 0.575 ms, 101 returned rows,
  and 509 total scan rows. The first-plus-one hostile proves
  `qp_ix_messages_page`, exactly two Message rows at `first=1`, and no Message
  sequential scan on all three supported majors.
- #291 evidence head passed final CI run `31893362124`; PR #308 merged normally
  to `feat/v4` at `275cad0c1d25251dc5d1ca1835a1316769218d7c`, and issue #291
  is closed.

- P2R1/BETA04 authority candidate `10d5712a` received a valid fresh stateless
  Opus-medium `BLOCKED` because its checker required two unretained authoring
  objects. Raw findings remain in
  `docs/v4/prototypes/beta04-authority-revision/REVIEW.json`. Portable repaired
  head `f8e12ead9f667ecc2c6e5478a3071b7f23e67099` received replacement `PASS`;
  raw evidence is `REVIEW-02.json` and commit `2ae19817`. The sibling revision
  preserves original P2 and v1 bytes while accepting only Policy cursor v2,
  two fatal compiler diagnostics, and mechanically derived BETA-04 readiness.

- #290 initial reviewed head `6d0c81392297964180c6032164e3d4b87814b5cc`
  received a valid fresh stateless Claude Opus-medium `BLOCKED` with four
  findings. Repaired reviewed head
  `f830e48c554b027afcb13efea6d3f900fd8c7ece` received the single replacement
  fresh stateless Opus-medium `PASS`. The byte-preserved raw reviews are in
  `docs/v4/implementation/beta03/`.
- #290 focused changed, full, release, architecture, package-isolation,
  generated-contract, hostile, and performance gates are recorded PASS. The
  timing evidence is an honestly labelled local reference with a mechanically
  derived binding budget; it makes no tagged stable-runner claim.
- #290 PR #305 merged normally to `feat/v4` at
  `a7d24541c433ab502316b34906d97c9dd51f7ee1`; issue #290 is closed. The target
  branch reported no status checks, so none were bypassed. #291 is the next
  dependency-ordered frontier.

- #289 exact diff `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9..dca711f06ca4b3cc58adbc7b2e56799cabd4839a`
  received five valid fresh stateless Claude Opus-medium `BLOCKED` reviews at
  `edaabc83`, `62de1be4`, `391138c0`, `a65ddbf1`, and `e151b748`, followed by a
  fresh stateless Opus-medium `PASS` at `dca711f0`. Verbatim findings are in
  `docs/v4/implementation/beta02/`; the disclaimer-prefixed `aaedd3ea` output
  is not review evidence.
- #289 `quality:full` and `quality:release` PASS with 80 tests, 0 failures, and
  15 snapshots. PostgreSQL 16/17/18 lifecycle evidence is 22/22 PASS; catalog
  evidence is 16 PASS plus 3 version skips on PostgreSQL 16 and 17, and 19/19
  PASS on PostgreSQL 18. `architecture:check`, `package:check`, and
  `git diff --check` PASS.
- #289 recorded performance is 2,690 ms for the changed lane, 6.847 ms for
  migration planning, and 25,528 golden bytes. The accepted slice exposes
  compiler and library-level schema/migration/Seed behavior plus CLI explanation
  producers and goldens; it does not claim a wired `questpie` command binary.
- #289 PR #304 merged normally to `feat/v4` at
  `b630fb01c6966b97fb3ac265bd416c4cfe0f1908`; issue #289 is closed. The target
  branch has no required status checks because CI currently targets `main`;
  no failing or required check was bypassed.

- #301 reviewed proof head `ff2dfa762c953f2511c5f65e6f930bac3da77868`
  received a fresh stateless Claude Opus-medium `PASS` after two preserved
  `BLOCKED` rounds and repairs. Raw reviews are in
  `docs/v4/prototypes/api-ergonomics-gate/REVIEW*.json`; authority evidence is
  `fbbf05d457f97927dc2b847b0ad049f26d887151`.
- #301 fixes named `defineKind`, nested-only Query/Mutation/Action server
  capability maps, exact canonical Resource Identity, diagnostics
  `QP-COMPOSE-023`/`024`, one durable kernel with distinct Job/Reaction/Workflow
  meanings, and the permanent v4 capability map. ADR-0022 and public mirrors
  project the result.
- #301 proof runner, canonical TypeScript diagnostics, scoped Oxlint, Oxfmt,
  docs typecheck/build, `quality:full`, and `git diff --check` PASS. Latest live
  sample: 1,594 TypeScript instantiations; 84,473 maximum measured declaration
  bytes; root completion/hover p95 0.253/0.346 ms; 50-operation p95
  0.367/0.179 ms; 500-operation p95 1.572/0.233 ms. All budgets PASS.

- #288 initial reviewed head
  `78a08b1eec8bd0c9459a76157171ac0425e4e23a` received a valid fresh stateless
  Claude Opus-medium `BLOCKED` with five compiler blockers. Repaired reviewed
  head `f510579567bc587e3679b817d1c68892e6c5de59` received the single replacement
  fresh stateless Opus-medium `PASS`; raw findings are in
  `docs/v4/implementation/beta01/`.
- #288 focused changed lane PASS in 4.151 s; hostile suite 8/8 PASS;
  `quality:full`, `quality:release`, `package:check`, and `git diff --check`
  PASS. Latest stable micro sample: compile 1013.34 ms, typecheck 879.98 ms,
  34,665 generated bytes, 4,103 public declaration bytes, 1,824 TypeScript
  types, 3,684 instantiations, and 106,592 KiB memory, all within BETA-01
  budgets.
- #288 PR #300 merged to `feat/v4` at
  `20ad8529ee18aba6830a7646acb3a9c9292f2fc6`; issue #288 is closed and #289 is
  the exact remaining frontier.

- #21 repaired reviewed head
  `0f44e985cf897a499cae6801966a2467c1e09b68` received replacement fresh
  stateless Claude Opus-medium `PASS`; accepted evidence head is `d50d4334...`.
- #21 authority projection: Oxfmt on 21 relevant files, docs MDX/TypeScript, and
  `git diff --check` PASS; issue #261 comment `#issuecomment-5286723736`.
- #22 candidate: skill validation, zero-warning scoped Oxlint, performance
  manifest validation, canonical TS 6 docs/MDX, native TS 7 forward check,
  strict Knip zero-noise classes, full docs build, and `git diff --check` PASS.
- Initial #22 reviewed head `bf45e2036fb1796f7f97899b9ef5672bdce4d27d`
  received a valid fresh stateless Opus-medium `BLOCKED`: the strict Knip
  filter left unlisted dependencies and binaries at warning severity. The
  repair promotes those classes to errors and adds a negative control.
- Repaired #22 reviewed head `fe8b5158d4d4eefb5920f07b3c7198fa3a4d8553`
  received one replacement fresh stateless Opus-medium `PASS`; accepted
  evidence head is `17008b0547f24b53d456530b798e8d96ae2e2b1e`.
- #14 initial reviewed head `e222be7484f6b5ae10eaf7eb209b2259f5a17865`
  was validly BLOCKED; repaired head
  `56a39c27704afef00c6b25fdbd13ade88278b668` received replacement fresh
  stateless Opus-medium PASS. Evidence head is
  `3a89c565cb1eba59815d106df1c06406ac20ac98`.
- #15 initial reviewed head `49e142607e9c0275ee07a2fa4b90ff516eaf6995`
  was validly BLOCKED because Service lifetime had no beta owner. Repaired head
  `5c4bdfa67ea97fa48793d01fbee188b7dbf19e3b` received replacement fresh
  stateless Opus-medium PASS. Evidence head is
  `0d8e2543ff7e9d50bdab7d2b66b62ec4c35d8a6f`.
- Measured #22 candidate loops: focused changed lane 2.09 s; cold docs-only full
  lane 9.40 s; the warm focused lane is 0.50 s. The format ratchet records one
  historical file and permits no new drift. Knip report baseline is 17 unused files, two dependency groups,
  and three unused exports; these noisy classes remain report-only.

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
- **The Studio packaging fork is narrower than it looks.** Studio is optional in
  ADR-0003 and the glossary, so always-bundled-with-no-opt-out is unavailable;
  and assets inside the checksum-verified Runtime bundle inherit its integrity
  guarantee while assets read from a resolved root at request time do not.
  `docs/v4/prototypes/studio-packaging/FINDING.md`
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

BETA-09 issue #296 is the nominal frontier, but the scope question below outranks
it. Read `docs/v4/implementation/beta09/README.md` before touching
`feat/v4-beta-09`; it carries the merge state and the slice's open items.

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

1. ~~**Scope `apps/docs` to beta.1 by removal, not by callout.**~~ **Done at
   `1d85b472`.** The guides now read as a finished product; the boundary came
   from `beta-slice-p15/SLICE.json` `deferred` + `laterBetas`, not from what
   has a runtime module.

   `apps/docs/content/docs/v4/` now holds 13 guides. Removed wholly:
   `durable-jobs-and-workflows.mdx`, `files-search-and-contract-projections.mdx`.
   Renamed after surgery, because the slug promised what the page no longer
   delivers: `services-routes-and-auth.mdx` → `services.mdx`,
   `multi-instance-and-acceleration.mdx` → `multi-instance.mdx`. Enumerations
   pruned in `index.mdx`, `semantic-kernels-and-public-surface.mdx`,
   `executable-definitions.mdx`, `definition-composition.mdx`.

   **The mapped list this file carried was wrong in both directions, from one
   sentence.** The warning that `Channel` in `realtime.mdx`,
   `queries-and-mutations.mdx` and `context-and-policy.mdx` is the
   collaboration fixture's own Company/Space/Channel/Membership/Message graph
   holds — all three read, all three confirmed. But it generalised to "those
   three guides are unaffected", and that is false for a _different_ token:
   `queries-and-mutations.mdx:428` prescribed "an Action for an external
   effect" and `:387` named an "external Action bag";
   `context-and-policy.mdx:243` listed "Route transitions" among the entry
   points constructing a fresh root. Both cut at `1d85b472`. The warning was
   about one token; it was applied to whole files. Verify per token, not per
   guide: `schema-lifecycle.mdx`'s three hits are all "file" meaning source
   file, and `runtime-and-studio.mdx`'s four are a fetch `credentials` option,
   a lowercase Studio route, and two negative telemetry statements — those two
   are genuinely unaffected.

   Two counts in this file were also wrong: it said 17 guides in one place and
   fourteen in another. The directory held 15, all `kind: guide`.

2. **Four things `apps/docs` exposes; two are docs defects and two are not.**
   **The distinction matters more than either finding:** the same symptom — a
   guide documenting behavior the tree does not produce — has opposite remedies
   depending on whether accepted authority backs the claim. Check that before
   reaching for a cut.
   - **Eleven diagnostic codes the compiler cannot emit. Backed by authority,
     so the gap is in `packages/`, not the guide.**
     `docs/v4/definition-composition.md:1163` calls the composition diagnostics
     a "closed code registry", tabulates 24 `QP-COMPOSE-*` codes at
     `:1165`–`:1189`, and specifies the exact union `CompositionDiagnosticCodeV1`
     at `:1200`+ with all 24 — binding, in its own words: "this mapping is part
     of v1 and an implementation cannot choose a different severity or blocking
     effect". `packages/compiler/src/diagnostic.ts` declares **13**: 002, 004,
     005, 006, 008, 010, 011, 012, 013, 014, 015, 017, 020. Missing: 001, 003,
     007, 009, 016, 018, 019, 021, 022, 023, 024 — absent from the declared
     union, so no throw site can reach them, and absent from all of
     `packages/*/src`.
     `definition-composition.mdx` cites every one of the eleven;
     `semantic-kernels-and-public-surface.mdx` cites 023 and 024.
     **The guides are right against the contract and wrong against the tree, so
     do not cut them.** The remedy is finishing the registry. Codes 023 and 024
     arrived with the API ergonomics amendment
     (`docs/v4/prototypes/api-ergonomics-gate/`), which is the likely reason the
     projection ran ahead.
     For 023 and 024 the authority is stronger than the projection and was
     checked separately: **ADR-0022 is `Status: Accepted`** and states in its own
     voice that "the compiler reports `QP-COMPOSE-023 operationProjectionCollision`"
     (`docs/adr/0022-freeze-api-ergonomics-and-operation-projection.md:28`) and
     the same for `QP-COMPOSE-024` (`:32`). Both are absent from every file under
     `packages/`, and the declared union stops at 020. So for these two the gap is
     an Accepted ADR asserting compiler behaviour that cannot occur, not a
     projection running ahead of a tree that will catch up.
     **And those two are the whole of it, checked rather than assumed.** All 23
     Accepted ADRs were swept for code-like identifiers they name -- 48 distinct
     ones. Eight are absent from `packages/*/src`, and six are explainable:
     `COPY`, `MERGE`, `LISTEN`, `NOTIFY` are PostgreSQL keywords in prose
     describing the capture boundary, not symbols the tree must contain
     (ADR-0012:35 permits `LISTEN`/`NOTIFY` as "a lossy wake hint only" rather
     than requiring it); `upload(file)` is ADR-0018 File/Search, which
     `beta-slice-p15/SLICE.json` puts in `laterBetas`; and `DataCursorV1` is
     named by ADR-0008:95 as deliberately frozen for the accepted proofs, with
     `DataCursorV2` -- the one it says execution emits -- present at
     `packages/runtime/src/relational/cursor.ts:65`, `:124` and `:287`. So the
     Accepted ADR surface asserts nothing else the tree fails to provide. Do not
     re-derive this; it is a bounded corpus and the sweep was cheap.
     **`QP-COMPOSE-003` is the one with substance behind it: the Resource Name
     grammar is not enforced at all.** `definition-composition.mdx:103`–`:113`
     documents segments of 1–63 characters, a 255-character total, and names
     `Appointments`, `booking_availability` and `booking..availability` as
     invalid. In the compiler, `model.ts:128` reduces a Resource name to
     `string(value.name, "resource name")`, and `string()` at `:33`–`:41` checks
     `typeof` only. The three grammar checks that do exist are all pointed
     somewhere else, which is why a grep for the bound finds nothing:
     `field-contract.ts:49` `/^[a-z][A-Za-z0-9]{0,62}$/` is `memberKey`, applied
     at `:187`, `:234` and `:262` to embedded properties and Field path
     segments; `change-capture.ts:50` is a dotted qualified-name regex used once,
     at `:133`, against `input.applicationName`; `physical-name.ts:40` is the
     PostgreSQL identifier rule. **No 255-character bound exists anywhere in
     `packages/*/src`.**
     The consequence is quiet rather than loud, which is the opposite of the
     dead factories: an invalid Resource Name is not rejected, it is mangled.
     `manifest.ts:54` `defaultCollectionName` splits on `.`, snake-cases each
     part and joins with `__`, so `booking..availability` becomes
     `booking____availability` and `Appointments` becomes `appointments`, both of
     which then pass `validatedPhysicalName`. Whoever implements 003 should
     expect to be changing what currently compiles, not only adding a code.
   - **The flagship guide's first Query example does not compile, and neither
     does its recursive-output example.** Higher severity than everything else
     in this item, because these are copy-paste starting points rather than
     prose a reader can route around.
     `queries-and-mutations.mdx:67` is `input: operation.input(channelMessagePage)`
     inside the guide's opening `defineQuery`. `packages/questpie/src/operation.ts:68`
     is the whole namespace: `Object.freeze({ error, text })`. There is no
     `input` member. (`operation.error` at `:69` of the same example is fine.)
     `queries-and-mutations.mdx:147` is
     `const threadNode: Codec<ThreadNode> = codec.lazy(() => …)`. `codec`
     (`packages/questpie/src/codec/index.ts:55`) has nine members — uuid, text,
     boolean, integer, timestamp, object, array, nullable, optional. `lazy`
     appears nowhere in `packages/questpie/src`.
     **They are different classes, so check before fixing either.**
     `operation.input` is accepted-but-unbuilt: it is the design-fiction
     shorthand at `docs/v4/design-fiction/queries-and-mutations.md:57`, `:145`,
     `:191` and `realtime.md:45`, `:175`. `codec.lazy` has no authority
     anywhere in the record set — invented.
     **The working fixture shows what the real API is today, which makes this
     actionable rather than just wrong.** `fixtures/collaboration/src/consumer.ts`
     is the same query as the guide's example. It writes the input codec out
     explicitly — `codec.object({ channelId, first, after })` at `:10`–`:14` —
     and reaches the plan through `ctx.data.run(channelMessagePage, input)` at
     `:32`, rather than deriving the input from the plan.
     Verified the imports around them are clean, so this is two symbols and not
     a general rot: all 23 symbols the guides import from `questpie` are real
     exports, and of 37 distinct namespace members used across every `ts` block,
     these two are the only ones that do not exist.
     **The shape is worse than the symbols, and it is one gap rather than many.**
     `defineQuery` takes five keys. The template is static —
     `packages/compiler/src/generate.ts:375`–`:386`, no conditional — so every
     generated `#questpie/app` says the same thing: `name`, `network?`, `input`,
     `output`, `handler({ input, ctx })`. **No `policy`, no `errors`, and the
     handler input has no `errors` to destructure.** `MutationFactory` is where
     those live: the generated contract gives it `policy` and `errors`, both
     **required**, and puts `errors` in the handler input. Every `defineQuery`
     example in the guides is shaped like a Mutation —
     `queries-and-mutations.mdx:65` and `executable-definitions.mdx:19` both
     pass `policy` and `errors`, and neither passes `output`, which is required.
     **Accepted-but-unbuilt, and the accepted side is unambiguous.**
     `docs/v4/query-mutation-and-lifecycle.md:36`–`:38`: "Each local exported
     Definition owns its Resource Identity, input, output, declared errors,
     Policy, exposure, limits, Origin, Executable Slot, and inline handler" —
     each Definition, Query included. `:39`–`:40` also makes `output` the
     override rather than a requirement: "The compiler can infer a closed
     supported output. Use `output` when the contract must remain independent of
     inference or is recursive." Both factories require it, and the fixture
     always passes it, so **output inference is unimplemented too**.
     So the guides are not sloppy here; they document the accepted authoring
     API, and the compiler emits a narrower one. The fix is in `packages/`, and
     it is one change — Query's factory shape — not a list of examples.
     **Nothing would have caught this.** `apps/docs` `types:check` runs
     `fumadocs-mdx && tsc --noEmit` over the app's own sources; fenced code in
     MDX is highlighted by shiki and never compiled. A guide example can be
     arbitrarily wrong and every gate stays green.
     **And the release gate that should catch it has no instrument.**
     `beta-slice-p15/SLICE.json` `releaseGates` ends with "public finished-product
     beta.1 docs and explicit absence documentation". `release.yml:29` runs
     `quality:release`, which is `full()` plus `knip:strict`, `package:check`
     and `scripts/performance.ts check` (`scripts/quality.ts:200`–`:204`).
     Nothing in that path reads `apps/docs/content`. The only `apps/docs`
     reference in all of `scripts/` and `tests/` is the tsconfig path at
     `scripts/quality.ts:215`, in the `typescript-forward` lane, and it compiles
     the site's own TSX.
     Positive control, because "no check exists" is exactly the claim a bad
     search invents: the sibling gates in the same list ARE mechanically
     enforced — `tests/type/beta01-generated-contract.test.ts:233` asserts the
     generated declarations match no `Drizzle|Kysely|drizzle-orm|any`, which is
     the "no ORM types" gate. My first pass looked only in `scripts/` and found
     nothing for that gate either; the instrument was wrong, not the tree. Once
     pointed at `tests/`, it fires for the siblings and still finds nothing for
     docs.
     **Reaction closes the inventory, and one gap turns out to span all three
     factories.** `ReactionFactory`
     (`packages/compiler/src/reaction/declarations.ts:113`–`:128`) takes `name`,
     `input`, `output`, `runAs`, `retry`, `effects?`, `errors?`, `handler`.
     `output` is required there too — as it is on Query (`generate.ts:379`) and
     Mutation. The accepted contract says the opposite
     (`query-mutation-and-lifecycle.md:39`–`:40`: "The compiler can infer a
     closed supported output"), **every** guide example of all three factories
     omits `output`, and **every** fixture definition passes it. So output
     inference being unimplemented is one gap that costs one compile error in
     every authoring example in the docs.
     Two things Reaction settles that Query left ambiguous. First, the thinness
     is **specific to Query, not general**: `ReactionContext`
     (`reaction/declarations.ts:89`) is `Omit<RootExecution, "services">` plus
     `data`, `queries`, `mutations`, `run`, `attempt`, so a Reaction handler does
     see the Principal and Tenant. Second, `policy` is a Mutation-only key —
     Reaction has none either.
     **An earlier revision of this line added "so that one may be by design in a
     way Query's absence is not". That was wrong, and the correction matters
     more than the point it was attached to.** Policy in v4 is Collection-bound,
     not Operation-bound: `compiler/src/relational/discovery.ts:136` attaches it
     as `{ kind: "default", requiredForNormalDataAccess: true }`, and the
     compiled read plan carries `policy` and `policyProgramDigest`
     (`runtime/src/relational/query.ts:97`–`:98`, `:621`). The generated
     `policy-projection.json` holds `operations.read` with
     `admission: { kind: "authenticated" }`. So a `defineQuery` reading through
     `ctx.data` **is** Policy-checked, admission included, and the guides'
     `policy: policy.authenticated()` is closer to redundant than load-bearing.
     `QueryDefinition` carries no `policy` field either, which is consistent
     rather than a second gap.
     The compile error stands — `QueryFactory` rejects the key — but it is a
     surface mismatch, not evidence that Queries are unauthorized, and it must
     not be fixed by assuming Query needs an operation-level Policy. The
     Collection binding may already be the answer; that is an owner call.
     It also puts a type under the open `durable-reactions.mdx` decision:
     `ctx.actions` there is not merely explained through a deferred capability,
     it is **not a member of `ReactionContext`**. That guide's example is also
     missing the required `output`.
     **The structural factories are clean except one example, and that one
     contradicts the guides' own prose.** `defineCollection` requires
     `constraints` — `packages/questpie/src/index.ts`, `constraints: Constraints
& ValidateFieldReferences<Fields, Constraints>`, no `?`. Eleven of the
     twelve `defineCollection` examples across the guides pass it. The twelfth,
     `semantic-kernels-and-public-surface.mdx:20`–`:27`, does not, so it does not
     compile. `data-and-queries.mdx:9` states the rule the example breaks: "A
     regular Collection must have exactly one named primary-key Constraint."
     Docs against docs, with the tree siding with the prose — a different shape
     from every other finding here, and the only one that is an isolated slip
     rather than a contract mismatch.
     `defineContext` (`name`, `input`, `resolve`), `defineSeed` (`name`,
     `steps`, `dependsOn?`) and `defineService` (`name`, `lifetime`, `effect`,
     `create`, `dependencies?`, `dispose?`) all match their guide examples
     exactly.
     **The client and app surface is clean, checked the same way.**
     `GeneratedApp` is `fetch`, `execution`, `close`; `GeneratedClientScope` is
     `context`, `queries`, `mutations`, `withContext`
     (`fixtures/collaboration/.questpie/generated/client.ts:41`+). Every use in
     the guides resolves, including the `withContext({…}).queries[…]` call
     shape. Two apparent misses were my regex reading inside string literals —
     `app.context` is `name: "app.context"` at `context-and-policy.mdx:129`, and
     `app.example` is a `baseUrl` URL at `runtime-and-studio.mdx:51`. The
     authoring surface is where the gap is; the calling surface is not.
     **That is why seven compile errors sit in the flagship guide with every
     gate green**, and it is the cheapest thing on this list to fix: one check
     that extracts `ts` blocks and compiles them would have caught every example
     finding above, and the numeric and symbol findings are the kind a second
     check could reach.
     **The Context is thin the same way, so this is one gap and not two.**
     `QueryContext` in the generated contract is two members —
     `{ data, signal }`. `MutationContext` is `Omit<RootExecution, "services">`
     plus `data`, `operationTime`, `callId`, `transactionId`, `dispatch`, and
     `RootExecution` carries `principal`, `authority`, `tenant`, `values`,
     `signal`, `deadline`. So a Query handler cannot reach the Principal or the
     Tenant at all. The guide's opening Query uses both —
     `queries-and-mutations.mdx:77` and `:82` for `ctx.tenant.id`, `:83` for
     `ctx.principal.id`. Design fiction has the same lines in the same example
     (`design-fiction/queries-and-mutations.md:67`, `:73`, `:74`), so this is
     accepted-but-unbuilt like the rest, not a slip.
     **Counted end to end, that one example fails on seven points:**
     `operation.input`, `policy`, `errors`, missing required `output`, a handler
     destructuring `errors`, `ctx.tenant`, `ctx.principal`.
     **The Mutation example beside it is correct on all seven**, which is the
     tell: Query is implemented as a much thinner thing than the accepted design
     and the guides were written against the design.
     Two positive controls, since a thin result is worthless if the instrument
     cannot see a thick one. The same reading method finds five members on
     `MutationContext` and two on `QueryContext`. And the only Query in the
     compiling fixture, `fixtures/collaboration/src/consumer.ts`, uses exactly
     `ctx.data` and nothing else — the tree is self-consistent; only the docs
     and the design run ahead of it.
   - **One more accepted-but-unbuilt bound, same class as the codes above.**
     `data-and-queries.mdx:79` says a JSONB-backed Field has at most 1,048,576
     canonical UTF-8 JSON bytes. The projection agrees —
     `docs/v4/data-model-and-query-grammar.md:325`, "a maximum canonical UTF-8
     JSON size of 1,048,576 bytes". Nothing enforces it: there is no JSON byte
     check in `packages/runtime/src/relational` or `.../codec` and none in
     `packages/compiler/src`; the only `byteLength` on that path is the 63-byte
     name check at `relational/bootstrap.ts:72`. The 1_048_576 literals that do
     exist are operation payload limits (`compiler/src/mutation/index.ts:65`,
     `:66`) and the realtime result cap — different contracts. Guide right,
     tree behind; do not cut.
   - **`data-and-queries.mdx:175` overstates one word.** "The hard v1 page
     maximum is 100 rows. A deployment can set a lower limit." 100 is the
     _default_: `runtime/src/relational/query.ts:599` is
     `input.maximumPageSize ?? 100`, and `:600` rejects only `< 1`, so it can be
     raised as well as lowered. It is enforced per request — `:328`,
     `first > maximumPageSize` → `QP-DATA-012` — so "hard maximum" is right for
     the default configuration and wrong as a bound. Small, and a cut is not the
     fix; a word is.
   - **Half of one Runtime limits table is invented.**
     `runtime-and-studio.mdx:224`–`:232` presents eight "Defaults". Four are
     exact: active root Executions per Principal 64 and drain deadline 30 s are
     `packages/runtime/src/application/index.ts:205` and `:206` (the only two
     numeric defaults in that module), and request/response body 1 MiB is
     `packages/compiler/src/runtime/index.ts:234`. **The other four have no
     constant in the tree and no source anywhere in the record set** — Runtime
     event 64 KiB, events per Execution 2,048, telemetry exporter queue 4,096,
     startup deadline 30 s. `packages/runtime/src/application/events.ts` is 93
     lines and holds no cap at all; the only `limits: {…}` block in
     `packages/*/src` is the wire one at `:234`; there is no exporter module and
     no startup-deadline constant. The 2,048 and 4,096 that do exist elsewhere
     are the ADR-0008 cursor envelope and a Convex comparison — different
     things.
     **Not a systemic docs problem, which is why it is worth the space.** The
     realtime table at `realtime.mdx:203`–`:212` is eight for eight against
     `packages/compiler/src/live-query/index.ts:134`–`:143`, key by key. One
     table is grounded; this one is half-invented.
     **I did not cut them, deliberately.** The removal criterion is what the
     BETA-01–BETA-12 passes deliver, _not_ what has an implementation today —
     that distinction is the one this record already had to correct once. The
     Execution Envelope is BETA-05 and accepted, so an unbuilt envelope limit
     may be intended rather than out of scope, and SLICE.json says nothing about
     these four either way. Establishing which needs the owner, and cutting a
     user-facing table on my own reading of the tree would repeat the exact
     mistake the criterion exists to prevent.
   - `durable-reactions.mdx:233` links to `./durable-jobs-and-workflows`, now
     removed. This is the same open defect already recorded for that file: a
     shipped BETA-08 guide explaining itself through deferred capabilities —
     "a generated server Action capability projection" (`:86`), "through a
     generated Action. It cannot write a Collection directly" (`:97`), and the
     receipt reuse at `:170`. Removing Action leaves the shipped guide with no
     account of how a Reaction performs an effect. **One content decision
     settles the link and the Action explanation together.**
   - `docs/v4/prototypes/api-ergonomics-gate/AMENDMENT.md:124` names
     `services-routes-and-auth.mdx` in a work-list. Left deliberately: it is a
     historical record of a past amendment's scope, not a live claim, and
     concurrent ticks are active under `docs/v4/prototypes`.

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
- `owner-decisions.md` states an owner answered its three questions. **That
  attribution cannot be verified from this repository.** Two of the three are
  independently grounded in citations and stand regardless; the attribution still
  needs confirming before review.
  **The count is also wrong, and the discrepancy is not cosmetic.** The intro at
  `:3`–`:7` says three decisions were put to the owner and names them — whether
  ADR-0010 grows, whether maintenance Authority is evaluated, and how Studio
  assets are packaged. The file then records **four**, D1 through D4, each headed
  "**Answered:**". D3 (batching the divergences) and D4 (repairing the glossary)
  are not among the three named, so it is unclear whether they carry the same
  owner attribution or were settled in-branch.
  **D3 is settled by the file itself, in the other direction.** Its subject
  reappears at `:181`–`:183` in the author's own "Judgment calls, and what would
  overturn them" list — "That batching the divergences is safe" — with an
  overturning condition attached. A decision cannot be both an owner answer and
  the author's judgment call; the judgment-call framing is the one with
  reasoning attached, so treat D3 as needing no owner confirmation and resolve
  the heading instead.
  D4 is what added `Operational Fact` to `CONTEXT.md`. The recommendation above
  to take the argued exception rests on the term's content, not on D4's
  provenance, so it holds either way.
  **D1's premise holds; one of its three citations does not.** D1 is the
  decision seven of the eight divergences are batched under, so its grounding
  is worth checking rather than inheriting. Two of three verify exactly:
  `docs/adr/0010-freeze-trusted-context-and-relational-policy.md:41` does say
  `definePolicy(collection, body)` "binds one closed typed Policy program to one
  Collection", and **the durable kernel really has no Collection** — no
  `defineCollection` anywhere under `packages/runtime/src/durable/` or
  `packages/compiler/src/reaction/`, and the tables are raw DDL in
  `questpie_internal` (`internal-protocol-v4-sql.ts:15`). That premise carries
  the batching argument and it is sound.
  The third citation is wrong. `owner-decisions.md` cites `CONTEXT.md:405` for
  "Policy applies to normal clients, direct operations, workers, recomputation,
  and Studio". That sentence is at **`:411`**. Line 405 sits inside the
  **Authority** definition; `### Policy` does not start until `:407`. The
  sentence exists and says what the argument needs, so **the conclusion stands
  and only the pointer is broken** — the same citation-axis-two class as the two
  found in `statement-timeout-gate/DECISION.md`, in a load-bearing decision this
  time.
  **D2 has the same defect, and its cause is worth more than the fix.** D2
  cites `CONTEXT.md:400`–`:403` for "the immutable class of actions an Execution
  may request … cannot be derived from request input". That text is at
  `:404`–`:405`; `:400` is the **Tenant** definition, `:402` the `### Authority`
  heading, `:401` and `:403` blank. The cited range holds not one word of the
  quote.
  It was correct when written. At `f092d618^` the text sat at `:402`, inside the
  cited range. `f092d618` — the commit that wrote `owner-decisions.md` — also
  edited `CONTEXT.md`, and its first hunk (`@@ -25,7 +25,9 @@`) added two lines,
  pushing everything below down by two. **The record cited the file and edited
  the file in the same commit, and the citations were not re-derived after the
  edit.** That is a decay mode this record set has not named: not staleness over
  time, but staleness within a single commit.
  **D1's is not explained by that**, and I checked before assuming one cause
  covers both. The Policy sentence sat at `:409` before the commit and `:411`
  after; D1 cites `:405`, which holds it in neither version.
  Both quotes exist and both arguments stand. **Rule the pair earns: when a
  record edits `CONTEXT.md` and cites `CONTEXT.md` in the same commit, re-derive
  every line number after the edit, not before.**
  **The same decay has a wider form, and the narrow rule does not catch it.**
  That rule runs from a record to itself. The obligation actually runs the other
  way: from the file being edited, to everyone who cites it. `c4e6f7cb` fixed my
  instance — `statement-timeout-gate/DECISION.md` cited
  `inspection-contract.md:164`–`:166` for D3 in two places, then `13992051`,
  `70b9b083` and `69c08cc9` inserted blocks into `inspection-contract.md` and
  pushed D3 to `:206`. Three commits apart, two different files, and nobody
  editing the second file had any reason to look at the first. So: **before
  committing an insertion into any record, grep the set for
  `<that filename>:[0-9]` and re-derive what you find.** Nothing else catches it
  — both stale citations resolved to real lines in the right file, so axis one
  passes them, and the citing record was untouched so no diff flags it.
  **D2's three tree claims are all true, and two of them cite bare branch paths
  — the failure this file's own discipline block names.** Verified each against
  `feat/v4-beta-09`:
  - `postgres-maintenance.ts:209`–`:210` is exactly
    `input.authorize !== undefined && !(await input.authorize({…}))`. Exact.
  - `compiler/src/runtime/application.ts:411` is exactly
    `const durableMaintenance = createPostgresDurableMaintenance({ sql,
application: durableApplication })` — the construction site, passing no
    authorizer. Exact.
  - `feat/v4-beta-09:tests/integration/postgres/beta09-authority-guard.test.ts:60`–`:63`
    says what D2 quotes. Exact, **and correctly prefixed**.
    The first two are cited without the `feat/v4-beta-09:` prefix, in the same
    paragraph as the third that has it. **On `feat/v4` those paths resolve to
    something else entirely**: `postgres-maintenance.ts:209`–`:210` is a
    `VERSION_MISMATCH` rejection record, and the string `authorize` does not appear
    anywhere in that file; `application.ts:411` is
    `if (!binding) throw new TypeError(…)`.
    So a reviewer following the citation lands on unrelated code and concludes the
    record cited something that does not exist. **The claims are true and the
    pointers make them look fabricated** — worse than an ordinary stale line,
    because it discredits a correct finding.
    **It is four, not two, and the pattern is systematic in that one file.**
    Swept every bare `packages/…` and `tests/…` citation in the record set for
    the shape "feat/v4 does not match the claim, the branch does".
    `owner-decisions.md` carries four, each with line numbers exactly right for
    `feat/v4-beta-09`: `:100` → `postgres-maintenance.ts:209`–`:210`, the
    `authorize` guard; `:103` → `compiler/src/runtime/application.ts:411`, the
    `createPostgresDurableMaintenance` call; `:46` →
    `compiler/src/runtime/application.ts:464`–`:483`, where the branch has
    `const durable = Object.freeze({` and `feat/v4` has a comment about worker
    polling; and `:46`–`:47` → `runtime/src/application/index.ts:433`–`:447`,
    which on the branch is exactly realtime, then the Studio shell, then Studio
    artifacts, then the wire. **`studio` appears zero times in that file on
    `feat/v4`**, so that sentence cannot be checked against it at all.
    One citation in the same file — the test at `:60`–`:63` — does carry the
    prefix, so the rule was known and applied unevenly rather than missed.
    **Scope of what I checked:** the sweep produced 32 bare citations where the
    two refs differ at the cited line. Most are records correctly citing
    `feat/v4` where the branch merely shifted, including several of mine. I read
    the four above and confirmed them.
    **Read eleven more, and every one is a correct `feat/v4` citation** — which
    bounds the defect to one file rather than leaving it open across the slice.
    Each was verified against the claim, not just the line: three records cite
    `postgres-maintenance.ts:130` for `actorOf` and its
    `principalKernel.is(actor)` brand check, and `:130`–`:131` is exactly that;
    two cite `:61` for `reason` on `cancelRun`, and `:58`–`:61` is exactly that;
    two cite `rows.ts:139` for the `event_sequence` bump, and `:139`–`:141` is
    exactly that; two cite `index.ts:592` and two `compiler/src/runtime/
application.ts:489` for `beginDrain()` reachable only through `close()`, and
    both are exactly that. Those eleven span `acceptance-shape.md`,
    `design-context.md`, `hostile-cases.md`, `maintenance-decisions.md` and
    `studio-purpose.md`.
    **Sweep closed: 32 candidates, all 32 read, 4 defects, all four in
    `owner-decisions.md`.** The remaining 28 are 27 correct `feat/v4` citations
    plus one correct-at-its-own-reviewed-head historical citation. The habit is
    one file's, not the slice's.
    **One methodological point the last candidate earned.**
    `beta05/claude-initial-review.md:18` cites
    `tests/integration/postgres/helpers/beta05-runtime.ts:31`, which is a blank
    line on `feat/v4` today. At BETA-05's reviewed head `884b5d8a` it is
    `const beta05FixtureRoot = resolve(` — correct when written, shifted by one
    since. **An accepted review record is a snapshot against its own reviewed
    head, and checking it against `HEAD` is the wrong ref.** Any future citation
    sweep should exclude `docs/v4/implementation/*/claude-*.md` or resolve them
    against the matching accepted head in the authority table above.
    **D3 has a bigger problem than its heading: the eight divergences it batches
    are never listed.** `owner-decisions.md:122`–`:123` commits "the eight
    divergences between accepted documentation and the tree that this slice
    surfaced" to one interstitial gate before BETA-12, and `:126`–`:131` even
    splits them seven-and-one by root cause. No record enumerates them. "Divergence"
    appears eleven times in the whole record set, across seven files: three in this
    file (two of them about D3 itself, one about branch commits), three in
    `owner-decisions.md`, one in `beta09/README.md:167` about a `hasMore` comment,
    one in `beta09/hostile-cases.md:106` about a test technique, and three in
    unrelated beta03/05/07 records. Checked the `feat/v4-beta-09` branch too,
    including its five files that are not on `feat/v4` — same three mentions, no
    list.
    So the gate has a count and no membership, and whoever builds it cannot know
    when it is done. It also makes the overlap with this section unresolvable: the
    findings catalogued above — eleven diagnostic codes, the Resource Name grammar,
    the JSONB bound, `operation.input`, the Query factory shape, output inference —
    are exactly "accepted documentation against the tree", but whether any is
    already one of the eight cannot be determined. **Enumerating them is the
    precondition for scoping the gate, and this section is a candidate starting
    set, not a replacement.**
- **Criteria 19-22 have no derived status.** The branch re-derived 1-17; the file
  holds 22. An earlier revision of this line said 18-22. **Criterion 18 is
  covered**, in a different file:
  `feat/v4-beta-09:docs/v4/implementation/beta09/narrower-claims.md:107` records
  "Criterion 18 is now measured: 255 ms against a 5,000 ms budget". Verified on
  the branch. `acceptance-shape.md:361`–`:368` had already corrected itself; the
  correction had not reached this file. (That range read `:355`–`:365` until my
  own insertions into `acceptance-shape.md` pushed the paragraph down six lines
  — the decay the rule above names, found by applying it.)

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

Run bunx oxfmt on only the files you wrote, never across docs/. Then
bun run check:changed and git diff --check. Commit each increment and push.
```
