# QUESTPIE v4 handoff

## Current accepted outcome

QUESTPIE v4 is a docs-first rewrite. Public documentation projects Accepted
ADRs; v3 is behavioral evidence only. The working rule is “v3 jobs, v4
ownership and invariants, the fewest new public concepts.” No production v4
compiler or Runtime exists yet.

Fixed accepted proof authority:

| Contract                          | Accepted head                              |
| --------------------------------- | ------------------------------------------ |
| Foundation data/query             | `d03358b749c4c8efb769d1c0fed50e8fbf983fb0` |
| P1 executable Definition compiler | `713485a64bcc4795d960d576fea51da56bc4dcdd` |
| P2 Context and Policy             | `5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` |
| P3 Query/Mutation/lifecycle       | `a09bf55f0e22f65e059cda9f3eda914520dd4f9d` |
| P4 Live Query/ledger              | `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` |
| P5 dispatch/Reaction              | `3f8618613bde1bdd7e13863970eb1c140e201c6f` |
| P6 Runtime/client/Studio          | `94c237c9aa910a60a332b1ef97473f34fe89d65b` |
| Post-P6 gates                     | `a164e33e752ab54d48fcf903371938ecff3dc082` |
| Reviewed post-P6 repair           | `79d7816dbf0b9b6e052706daf71fe173e1cbfc42` |
| #17 Service/Route/Auth            | `79d3667019e0a4cda6f7652d24f2d9c6b68d4fca` |
| #18 lifecycle/durable kernel      | `71463e99a70481b0950ae18d1ff409c034c1b158` |
| #19 HA/optional acceleration      | `96829bd7b08ea54e60fdc7d5b077366235d2dfea` |
| #20 File/Search/projections       | `6e056bc44c15740b2797a9489fe3823c3100bdad` |
| #21 kernels/naming/exports        | `d50d4334b116a5bdc46e95cdabf566d8db938d37` |
| #22 repository foundation         | `17008b0547f24b53d456530b798e8d96ae2e2b1e` |
| #14 conformance map               | `3a89c565cb1eba59815d106df1c06406ac20ac98` |

ADR-0008 through ADR-0020 and their accepted workbench/public projections are
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
  `feat/v4`, head `21f80fc06feec50a156937e83178233caa295324`.
- Main contains the accepted uncommitted documentation projection plus the
  user's baseline `e2b8ed36`; preserve it and any concurrent unrelated change.
- Accepted proof worktrees and their heads are fixed and clean. Inspect all
  worktrees before editing and never modify an accepted proof worktree.
- Accepted #22 proof worktree:
  `/tmp/questpie-v4-repository-foundation-proof`, branch
  `feat/v4-repository-foundation-proof`.
- Its synthetic parent `9fd5d41e6ce8627959d9e72ba017fd0d0cd441bf` is an exact snapshot of
  the accepted uncommitted P21 projection. It changed neither main HEAD nor its
  index.

Use the repo-owned `.agents/skills/questpie-v4/SKILL.md` after this file. It
routes design, proof, implementation, public documentation, and repository
quality work to directly linked procedures. Repository package scripts and CI
are executable command authority; personal skill paths are not dependencies.

## Active frontier and blockers

Atlas tickets #14 and #17–#22 are accepted. The active frontier is #15 beta
slicing and then #16 implementation collapse. The accepted foundation
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

Resolve atlas #14 conformance, #15 beta slicing, and #16 implementation
collapse; reconcile the subordinate beta1 decision map; produce
one buildable specification; derive small dependency-ordered tracer issues with
exact authority/artifacts/fixture/non-goals/hostile cases/budgets/commands; mark
only genuinely unblocked children agent-ready; then update issue #261 and this
handoff. No production Runtime implementation belongs in this design session.

## Latest verification

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
- Measured #22 candidate loops: focused changed lane 2.09 s; cold docs-only full
  lane 9.40 s; the warm focused lane is 0.50 s. The format ratchet records one
  historical file and permits no new drift. Knip report baseline is 17 unused files, two dependency groups,
  and three unused exports; these noisy classes remain report-only.

## Next invocation

```text
Use the repo-owned QUESTPIE v4 skill. Resolve atlas #14–#16 in order, reconcile
beta1, produce the buildable spec and
dependency-ordered agent-ready issues. Preserve the dirty main projection and
accepted proof worktrees; do not implement production Runtime.
```
