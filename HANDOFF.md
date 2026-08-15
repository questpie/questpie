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

Fixed accepted proof authority:

| Contract                             | Accepted head                              |
| ------------------------------------ | ------------------------------------------ |
| Foundation data/query                | `d03358b749c4c8efb769d1c0fed50e8fbf983fb0` |
| P1 executable Definition compiler    | `713485a64bcc4795d960d576fea51da56bc4dcdd` |
| P2 Context and Policy                | `5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` |
| P3 Query/Mutation/lifecycle          | `a09bf55f0e22f65e059cda9f3eda914520dd4f9d` |
| P4 Live Query/ledger                 | `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` |
| P5 dispatch/Reaction                 | `3f8618613bde1bdd7e13863970eb1c140e201c6f` |
| P6 Runtime/client/Studio             | `94c237c9aa910a60a332b1ef97473f34fe89d65b` |
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

ADR-0008 through ADR-0021 and their accepted workbench/public projections are
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
  `feat/v4`, accepted merge head `a7d24541c433ab502316b34906d97c9dd51f7ee1`.
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
tracker closure. BETA-04 issue #291 is now the active frontier. The accepted
foundation includes:

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

## Next invocation

```text
Use the repo-owned QUESTPIE v4 skill. Implement and accept BETA-04 issue #291
from merge base `a7d24541c433ab502316b34906d97c9dd51f7ee1` without
widening its relationally authorized Query tracer. Preserve the #289/#290
review evidence, docs-hygiene branch, marketing worktree, scalar-research
worktree, and archive branch.
```
