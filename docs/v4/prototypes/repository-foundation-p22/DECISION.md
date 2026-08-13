# P22 repository-foundation decision

## Measured starting point

- HANDOFF: 1,220 lines / 66,347 bytes; root AGENTS: 26 lines / 1,234 bytes.
- Root lint: 0.17 seconds / 237,000 KiB, but 10 intentional proof-expression
  errors and one warning made it unusable as a blocking production gate.
- Root format: 2.34 seconds / 201,612 KiB with 10 reported legacy files before
  the accepted P21 snapshot. After pinning the #22 formatter and formatting its
  own scope, one pre-existing file remains in the exact ratchet baseline.
- Docs typecheck on TypeScript 5.9.2: 3.38 seconds / 689,600 KiB.
- V3 contains 494 test-like files, three ad hoc benchmarks, one serial
  45-minute CI test timeout, and mixed Postgres/Redis/Soketi matrices. Its jobs
  are evidence; its organization and feedback time are rejected.

## Selected interface

One closed repository runner owns eight lanes: `changed`, `full`, `release`,
`typescript-forward`, `postgres`, `micro`, `load`, and `soak`. Package scripts
give them stable names. A free-form lane/plugin manifest is rejected because it
would become a second CI language; only performance scenario data varies.

- `changed` checks changed format/lint, an explicitly selected test and smallest
  workspace typecheck, plus diff hygiene. Measured at 2.09 seconds on this
  foundation fixture uncached and 0.50 seconds warm.
- `full` runs the format ratchet, zero-warning lint, canonical types, ordinary
  tests, Knip report, docs/build, and diff hygiene. Measured cold at 9.08
  seconds for the initial docs-only foundation and 9.40 seconds after the
  final compiler/package gate repair.
- `release` adds strict stable Knip issue classes, validates performance
  manifests, and checks every publishable package's exports, built artifacts,
  declarations, and publication shape. With no implementation package yet the
  contract reports that state without inventing a placeholder package.
- `postgres` is independent correctness evidence against PostgreSQL 17 in CI.
  The local fixture passed PostgreSQL 17.10 in 39 ms.
- TypeScript 6.0.2 is canonical. Each lane invokes and asserts the exact
  package binary, avoiding workspace-bin alias ambiguity. Removing `baseUrl`,
  setting explicit `rootDir`, and retaining explicit `types` passes docs/MDX.
  Native TypeScript 7.0.2 also passes as the single non-blocking forward lane;
  its missing stable programmatic API prevents canonical adoption.

Knip 6.32.1 is report-only for current noisy classes. The baseline reports 17
unused files, two dependency groups, and three unused exports. Strict
`unlisted`, `binaries`, and `unresolved` is zero-noise and blocking. Generated
route output, Fumadocs virtual modules, proof fixtures, and test helpers are
classified narrowly; no broad ignore hides shipped source. A disposable
negative fixture proves that both an unlisted dependency and binary make the
strict gate fail.

Correctness, microbenchmarks, load, and soak/chaos have separate schedules and
result meaning. A repository-owned manifest validator requires every scenario
to name its implementation-slice budget owner and metrics. Selected-PR micro
may run only for quick stable cases. Ten-instance HA, fanout, durable-worker,
rolling-deployment, and optional-infrastructure loss belong to nightly/manual
load; crash/leak/retention belong to manual soak. GitHub-hosted timing reports
small movement and blocks only clear repeated regression; tagged stable runners
own strict release budgets.

## Agent and acceptance context

The repo-owned `questpie-v4` skill is one concise router with five directly
linked branches. Root AGENTS is trigger-only plus universal rules. The proof
branch contains a deterministic Bun wrapper around a fresh stateless Claude
Opus-medium process. It validates paths, clean HEAD and manifest head,
verification PASS results, ancestry and non-empty diff; orders long XML
documents before the review task; rejects secret-like content, database URLs,
timeouts, transport errors, empty output, and missing/duplicate verdicts; and
records the raw finding with model, effort, exact head, base, and verdict.

HANDOFF is reduced only after these procedures and proof histories have a
verified canonical home. It retains current outcome/heads, worktree and dirty
state, frontier/blockers, latest verification, and one short invocation.

Earlier attempted subagent and ephemeral Codex contexts were transport
non-results and are not claimed as evidence. Three replacement fresh stateless
Opus-medium read-only contexts started from root AGENTS. Design and proof
routing returned PASS. Implementation returned the expected BLOCKED because it
correctly located #22 as the active gate and refused to invent an agent-ready
Runtime slice. The deterministic context fixture separately asserts that all
three branches locate exact authority and package commands without the retired
continuation prompt or any personal skill path.

`skills-ref` is pinned in the root dev dependencies and its validation runs in
the full lane, so skill validity does not depend on an implicit network fetch.

## Rejected alternatives

- One `check` command for every loop: hides latency and makes red-green wait on
  graph/build/infra work.
- Arbitrary user-defined lanes: a shallow orchestration framework with invalid
  combinations and duplicated CI semantics.
- Blocking every current Knip or format finding: rewards broad ignores or a
  mass unrelated cleanup. Ratchets make new drift impossible while debt falls.
- Canonical TypeScript 7 now: the CLI passes, but the stable programmatic API
  needed by future compiler tooling does not exist in 7.0.2.
- GitHub-hosted strict percent budgets: runner noise would create false gates.
- A personal-machine skill or resumed Claude session: non-portable and cannot
  establish an exact independent acceptance result.

## Acceptance repair

The first clean reviewed head
`bf45e2036fb1796f7f97899b9ef5672bdce4d27d` received a valid fresh stateless
Opus-medium `BLOCKED`. Its blocking finding was that `knip:strict` selected
`unlisted` and `binaries` while their configured severity remained `warn`.
The repair promotes both to `error`, pins and runs the skill validator, binds
both compiler lanes to explicit package binaries through Bun, and adds the
negative Knip control. The original raw review remains in `REVIEW.json`;
replacement findings use `REVIEW-REPLACEMENT.json`.
