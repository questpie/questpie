# ADR 0020: Establish the repository foundation

- Status: Accepted
- Date: 2026-08-14

## Context

Production implementation needs a fast local loop, enforceable full and
release gates, portable agent context, and honest performance evidence. The
docs-first repository previously had no root test, PostgreSQL, Knip, package,
release, or benchmark architecture, and its long HANDOFF duplicated procedure.

## Decision

QUESTPIE accepts one closed repository quality runner with eight lanes:
`changed`, `full`, `release`, `typescript-forward`, `postgres`, `micro`,
`load`, and `soak`.

- `changed` owns changed-scope format/lint, one selected test, the smallest
  relevant workspace typecheck, and diff hygiene. It targets seconds.
- `full` owns the cached repository-wide correctness loop. PostgreSQL remains
  an independent required CI job.
- `release` adds the stable strict Knip classes, performance manifests, package
  exports, declarations, built artifacts, and publication shape.
- TypeScript 6.0.2 is canonical and invoked by exact package path. Native
  TypeScript 7.0.2 is the single non-blocking forward-conformance lane until
  its stable programmatic API and complete toolchain pass.
- Knip begins report-only for noisy issue classes. `unlisted`, `binaries`, and
  `unresolved` are zero-noise blocking classes, with a negative control.
- Correctness, microbenchmarks, load, and soak/chaos are distinct evidence.
  GitHub-hosted timing reports small movement and blocks only clear repeated
  regressions; stable runners own strict release budgets. The repository owns
  the harness and each accepted implementation slice owns its budgets.

The repository owns one concise `.agents/skills/questpie-v4/SKILL.md` router
with directly linked design, proof, implementation, public-documentation, and
repository-quality procedures. Root `AGENTS.md` is trigger-oriented. HANDOFF
contains only accepted outcome/heads, preservation state, frontier, latest
verification, and a short next invocation.

Acceptance review uses the repository Bun wrapper. It validates every path,
the exact clean reviewed commit, authority heads, ancestry, verification
results, exact diff, packet order, and secret-like material before invoking a
fresh stateless Claude Opus-medium process with no tools. A timeout, transport
failure, empty response, or missing unique leading PASS/BLOCKED verdict is no
result. BLOCKED repairs require a new clean head and one replacement review.

## Consequences

- Repository scripts and CI are executable command authority; contributor and
  agent documents point to them rather than copying checklists.
- Generated output, virtual modules, proof fixtures, and test helpers receive
  narrow classifications; broad ignores are not accepted.
- Multi-instance HA, fanout, durable-worker, rolling-deployment, and optional-
  infrastructure loss load scenarios run nightly or manually, outside the
  ordinary red-green path.
- No production QUESTPIE Runtime is introduced by this decision.

## Rejected alternatives

- One check command for every feedback loop.
- Arbitrary user-defined quality lanes or a second CI language.
- Blocking every historical Knip/format finding through broad ignores.
- Strict percentage timing gates on noisy GitHub-hosted runners.
- Repository behavior that depends on personal skills or resumed Claude state.
