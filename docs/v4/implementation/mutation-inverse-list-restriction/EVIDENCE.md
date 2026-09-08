# Inverse Collection list restriction

This closes ADR-0043 review observation 4 by testing the existing restriction,
not by adding inverse lists to Mutation or lifecycle capabilities.

## Correction to the initial audit

The first audit inspected the private Runtime list bridge in isolation. It
correctly found that `PostgresQueryObservationV1.observed` counts visible root
rows, not inverse children, but incorrectly described that as a reachable
Mutation row-budget bypass.

A generated PostgreSQL tracer disproved reachability before executing its
Mutation: the compiler rejected the Collection Operation Set with
`QP-COMPOSE-013 structuralTypeError`, stating that its list cannot project an
inverse child list. `packages/compiler/src/mutation/operation-set.ts` accepts
only Data Query Template v1 for that member. Independently, Runtime's
`mutation/query-template.ts` rejects v2 and inverse selection nodes;
`mutation/program.ts` checks the embedded v1 template digest.

The general Query kernel supports ADR-0032 inverse projections. The Collection
Operation Set used by `ctx.data.<collection>.list` does not. Neither a named
Mutation nor compiled lifecycle can obtain the unsupported plan through this
generated capability. The Query's 5,050-position and semantic-byte guards are
separate from Mutation budgets; they are not the reason this path is withheld.

## Regressions

The compiler test authors an otherwise valid inverse list over Collaboration's
existing `channels.messages` Relation and asserts the specific Operation Set
diagnostic. Runtime tests re-sign the embedded template after each alteration:
v2 with its edge ceiling, a v2 header under v1 keys, and an inverse selection
relabelled as v1. All fail in the closed decoder rather than relying on a stale
digest. Existing scalar Collection and ordinary inverse Query tests remain the
positive controls.

Verified on 2026-09-08 with the unchanged implementation from `ba336b234`:

- `bun test --timeout=15000 tests/unit/beta06-operation-set-projection.test.ts`:
  four passes, zero failures, 41 assertions in 30.66 seconds.
- `bun test --timeout=15000 tests/unit/beta06-runtime-mutation-program.test.ts
tests/unit/mutation-collection-list.test.ts
tests/unit/inv03-inverse-postgres-runtime.test.ts`: 23 passes, zero failures,
  59 assertions in 0.215 seconds.
- `bun run --cwd packages/runtime types:check`, warning-denying lint and
  focused formatting over both changed tests, and `git diff --check`: PASS.

The test processes used an owned on-disk `TMPDIR`; no shared fixture output or
PostgreSQL schema was reset by these rejection tests. This is 27 passing tests
and 100 assertions, not a new full release or PostgreSQL execution run.

The initial compiler test omitted the required root filter and failed during
controlled source evaluation. Supplying the valid filter reached the intended
diagnostic. An initial broad invocation used Bun's default five-second test
timeout and timed out unrelated existing compiler cases; subsequent commands
use the repository quality runner's existing fifteen-second setting.

Exploratory Runtime edits remain uncommitted in the separate
`fix/mutation-inverse-row-budget` worktree and are not part of this closure.
Its private-seam probe recorded two expected budget rejections instead resolving;
an exploratory change passed 35 tests and 135 assertions. The generated
PostgreSQL attempt then stopped at compilation, so it supplies no inverse
Mutation execution or rollback PASS. Its owned database was removed and a
read-only catalog check found no remaining `qp_mutation_list_*` databases.

Logs are retained locally under
`/home/drepkovsky/code/questpie-v4-mutation-inverse-tmp`. No production file,
budget, artifact format, public capability or accepted ADR changes here.
