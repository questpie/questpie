# Collection `delete` kernel operation — status

Related: [ADR-0047](../../adr/0047-collection-delete-kernel-operation.md)
(Proposed, not Accepted).

## Scope of this pass

Task: give named Mutations `ctx.data.<collection>.delete(...)`, reusing the
existing Operation Set `delete`'s PostgreSQL statement builder.

## What was verified

Read `AGENTS.md`, `CLAUDE.md`, `docs/v4/DELIVERY-FLOW.md`,
`.agents/skills/questpie-v4/SKILL.md`, `SPEC.md`, `CONTEXT.md`, ADR-0011,
ADR-0030, ADR-0031, ADR-0032, and the current kernel/Operation Set code:

- `packages/compiler/src/mutation/kernel.ts` — `create`/`update` only.
- `packages/compiler/src/mutation/operation-set-contract.ts` — the
  `CollectionOperationMember` union and the write-resource codec branch
  (`operation-write-resource.ts:145`) already anticipate a `delete` member
  at the type/codec level.
- `packages/runtime/src/mutation/postgres-program.ts:595` — the plan linker
  hard-rejects any Operation whose `member` is not `create`/`get`/`update`:
  `"has no executable Collection Operation plan"`.
- No `DELETE FROM` row-mutation statement exists anywhere under
  `packages/compiler/src/mutation/` or `packages/runtime/src/mutation/`.
  `packages/runtime/src/mutation/collection.ts:305,347-349` only ever
  populates `members.create` / `members.update` / `members.get`.
- The change-ledger trigger
  (`packages/compiler/src/schema/postgres/internal-protocol-v3.ts`, around
  line 104) is table-level and already branches on
  `TG_OP IN ('UPDATE', 'DELETE')`, so Live Query convergence after a delete
  needs no new trigger — confirmed by reading the trigger body, not proven
  by a running test (no delete statement exists yet to drive it).

**This contradicts the task's stated premise** ("study exactly how `update`
does each and mirror it" / "reuse the Operation Set delete's PostgreSQL
statement builder if it fits") — there is no existing Operation Set delete
execution to reuse. The `create`+`update` execution stack this would need to
mirror is ~3,500 lines across `postgres-create.ts`, `postgres.ts`,
`postgres-shared.ts`, `postgres-update-program.ts`, `collection.ts`,
`collection-lifecycle-check.ts`, `adapter-execution.ts`, with ~4,300 lines of
matching unit tests. Building an equivalent, correctly gated delete path
(digest-verified linker plan, FK-issue mapping, CAS, lock-then-validate
lifecycle, type-visibility gating, MCP/HTTP projection, full regression
suite) is comparable in size to the ADR-0030/0031 work itself.

## Decision

Per the task's own stop condition ("If the design needs an owner decision
you cannot make ... stop implementing, finish the ADR with options and a
recommendation, and report"), this pass stops at design: **ADR-0047
(Proposed)** captures the API shape, lifecycle/Policy/relations/CAS/type-
visibility decisions and a four-phase implementation plan (compiler
metadata → runtime execution → proof → diagnostic fix). No runtime or
compiler code was changed in this pass beyond the ADR and this doc, to avoid
landing compiler-level `delete` metadata (e.g. a `kernelProgram(...,
"delete")` entry) that nothing downstream executes — that would look wired
but silently do nothing, which is worse than not landing it.

## Commands run

```
cd /home/drepkovsky/code/questpie-v4-worktrees/collection-delete
git log --oneline -5          # confirmed a2c8e4a08, work/collection-delete-kernel
grep -rln "delete" packages/compiler/src/mutation packages/runtime/src/mutation
grep -n "member" packages/runtime/src/mutation/postgres-program.ts
grep -rln "DELETE FROM" packages --include="*.ts"
```
No build/test/gate commands were run because no source files changed;
running the full gate list (`package:check`, `architecture:check`, unit
suites, Collaboration/team-support-desk regressions) against a docs-only
diff would not exercise anything relevant to this task and would misreport
as "green" for work that was not done.

## Unverified / not done

- No code changes (compiler kernel, runtime execution, generated types).
- No unit or PostgreSQL integration tests.
- No gates run (format/lint/typecheck were not needed for a docs-only
  change touching no `.ts` files).
- The release checksum gate (`quality/release/package-artifacts.json`) is
  untouched and not expected to change, since no package bytes changed.

## Recommendation

Owner should confirm or amend ADR-0047's phasing before phase 2 (runtime
execution) is built, since it is the majority of the work and the one that
determines gate scope (which regression suites, how FK issues are named,
whether CAS reuses `update`'s `expected` shape verbatim). Phase 1 (compiler
metadata only) is low-risk and could be landed standalone as a first commit
once the ADR is accepted, but has no observable effect until phase 2 lands.
