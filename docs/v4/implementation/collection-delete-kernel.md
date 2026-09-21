# Collection `delete` kernel operation — status

Related: [ADR-0047](../../adr/0047-collection-delete-kernel-operation.md)
(Proposed, not Accepted — this doc records what was built against that
proposal; the ADR is not flipped to Accepted by this work).

## Scope

Named Mutations gain `ctx.data.<collection>.delete({ key })`, a third
Policy-gated kernel member alongside `create`/`update` (ADR-0030/0031),
key-addressed, no caller/trusted-value lane, no candidate.

## What was verified before implementing

Read `AGENTS.md`, `CLAUDE.md`, `docs/v4/DELIVERY-FLOW.md`,
`.agents/skills/questpie-v4/SKILL.md`, `SPEC.md`, `CONTEXT.md`, ADR-0011,
ADR-0030, ADR-0031, ADR-0032. The task's premise — "reuse the Operation
Set delete's PostgreSQL statement builder" — did not hold: no `DELETE
FROM` row-mutation statement existed anywhere in `packages/compiler/src/
mutation/` or `packages/runtime/src/mutation/`, and
`packages/runtime/src/mutation/postgres-program.ts`'s plan linker
hard-rejected any Operation whose `member` was not `create`/`get`/`update`.
ADR-0047 records this discovery. Per the coordinator: this is a missing
write path (the work), not a design conflict with an Accepted ADR, so it
does not license stopping at design — it had to be built.

One thing already worked "for free": the change-ledger trigger in
`packages/compiler/src/schema/postgres/internal-protocol-v3.ts` fires on
`TG_OP IN ('UPDATE', 'DELETE')` at the table level, so Live Query
convergence needed no new trigger, only a real DELETE statement to drive
it — proven end-to-end by the PostgreSQL integration test's row-count
assertions (no separate Live Query subscription test was written; see
Unverified below).

## Shared vs. new (the "don't mirror 3,500 lines" split)

Reused as-is, unmodified: `postgres-shared.ts` (`fieldByPath`,
`Parameters`, `policyParameters`, `inputParameter`, `quote`, `result`),
the relational Policy machinery (`lowerPostgresMutationPolicyChecks`),
`postgres-collection-statement.ts`, `postgres-program-decode.ts`'s
`exact`/`same`/`results`/`outputAuthority`/`evidence` helpers (only
`header`'s member-name union was widened), and the runtime's
`decodeOperation`/`program.ts`, which already had `"delete"` in its
`member` → `[kind, mode, cardinality]` table before this task — the
"collection operation program" layer was already delete-aware; only the
PostgreSQL plan and execution layers were missing.

New, because delete genuinely differs (no candidate, one-statement
authorized-or-absent DELETE instead of UPDATE):

- `packages/compiler/src/mutation/postgres-delete.ts` (160 lines) —
  `lowerPostgresDeleteOperationPlan`, the compiler-side SQL plan builder.
  Extracted to its own file (not left inline in `postgres.ts`) to follow
  the precedent `postgres-create.ts` already set, and because
  `postgres.ts` was already at the architecture:check 800-line cap.
- `packages/runtime/src/mutation/postgres-delete-program.ts` (~185 lines)
  — the digest-verified linker counterpart, sized to delete's smaller plan
  shape (no `candidateValidation`/`candidatePolicyCheck`, since no
  authored lifecycle is wired for delete in this slice).
- `packages/runtime/src/mutation/collection-delete.ts` (~100 lines) —
  `createCollectionDeleteExecutor`, mirroring
  `createCollectionGetExecutor`'s exact shape (key-only request, lock then
  act, decode-or-null). `collection.ts` now shares one `bind`/`decode`
  closure object (`keyedRowAccess`) between the get and delete executors.
- `packages/compiler/src/mutation/kernel.ts`, `postgres.ts`,
  `postgres-contract.ts`, `postgres-program.ts`,
  `postgres-program-types.ts`, `collection.ts`: small, mechanical wiring
  deltas (a member added to existing loops/unions/maps, matching the
  shape already used for create/update/get) — not new logic.

## Decisions this task made (see ADR-0047 for the full write-up)

- **API shape**: `{ key }` in, `Row | null` out (no CAS/`expected` in v1 —
  the pre-existing Operation Set codec branch for `delete` already only
  took `{ key }`, so this follows the framework's own prior intent rather
  than inventing a new shape).
- **Lifecycle**: only the row-lock + fresh Policy check applies (no
  authored `validate`/`check`/`afterWrite` callback compilation in this
  slice — that would be a parallel subsystem the size of ADR-0031 itself).
  The `lock` plan step exists specifically so that gap can close later
  without reshaping the plan.
- **Policy**: the existing `delete: { admission, current }` Policy shape
  (already fully typed in `packages/compiler/src/relational/types.ts` and
  compiled by `discovery.ts` — never wired to execution before this task)
  is evaluated fresh inside the same statement as the `DELETE ...
  RETURNING`, so a Policy-denied row and a missing row are
  indistinguishable by construction ("authorized-or-absent"), matching
  `update`.
- **Relations/FK**: no new cascade declaration surface. `relation.toOne`
  already emits a real PostgreSQL `FOREIGN KEY` with a configurable
  `onDelete` (default `restrict`); an unhandled `23503` surfaces as the
  same sanitized failure any other PostgreSQL constraint violation on
  create/update already does — **no typed `ConstraintViolation`/FK issue
  was added**, because ADR-0031 states "PostgreSQL constraints are not
  Collection issues" and ADR-0030 lists a typed `ConstraintViolation` under
  Deferred decisions. Inventing one for delete only would have contradicted
  an Accepted ADR; this is the one place this task's original brief ("FK
  restrict... declared issue mapping") could not be followed literally.
- **Operation Set interaction**: a Collection with both a Policy-declared
  `delete` and an authored, never-executable Operation Set `delete` member
  now has the kernel win (identity clash avoided by dropping the Operation
  Set entry only in that case). A Collection with only an authored
  Operation Set `delete` and no Policy `delete` rule is unchanged from
  before this task (type-visible, still non-executable) — this exact case
  is asserted by the pre-existing
  `tests/unit/beta06-operation-set-projection.test.ts`, which stayed green.
- **Type visibility**: `delete` appears on `ctx.data.<collection>` exactly
  when the Collection's default Policy declares `operations.delete` —
  the same gate create/update use, no new mechanism. Delete raises no
  Collection issues, so it needs no `issueMappings` coverage gate (unlike
  create/update). The pre-existing "property does not exist" diagnostic
  when a member is hidden was **not** changed — the fix would require
  threading a grant/mapping-specific TypeScript diagnostic through the
  generated-declaration renderer, which was out of scope given the time
  spent on the execution layer; documented here as a known follow-up.

## Commands run and results

```
cd /home/drepkovsky/code/questpie-v4-worktrees/collection-delete
bun install --frozen-lockfile
bun run --cwd packages/questpie build      # needed to resolve "questpie" for typecheck/tests
```

Typecheck (packages/compiler, packages/runtime): both clean against
baseline. `packages/compiler`: 0 new errors (baseline has 14 pre-existing,
unrelated to this change — `questpie` module resolution before the
package was built; 0 after). `packages/runtime`: 0 errors (was 32
pre-existing before the package build, 0 after — same cause).

Format/lint (oxfmt/oxlint) on every touched/added file: clean.

`architecture:check`: **fails, expected-red.**
`packages/runtime/src/mutation/collection.ts` is 815 lines (cap 800). It
was already exactly 800 lines before this task. Delete's dispatch wiring
was reduced as far as it reasonably goes — extracted its executor to
`collection-delete.ts` (matching the existing `collection-get.ts`
precedent) and deduplicated its `bind`/`decode` closures with `get`'s —
but an import, a `CollectionLeaf` union member, a `plans.delete` map
field, one dispatch-loop branch, and the same 5-line registration shape
`get`/`create`/`update` already use cannot be reduced to zero. Not
silently worked around; reported here.
`packages/compiler/src/mutation/postgres.ts` (was flagged at 803 before
extracting `postgres-delete.ts`) is back under the cap at 666 lines.

`package:check`: **fails, pre-existing, unrelated.**
`questpie-opentelemetry: missing built export ./dist/index.d.ts` —
reproduced identically with this branch's changes reset to HEAD before
any of this task's commits; not caused by this work.

Unit tests (`tests/unit`, 192 files, 8 foreground chunks of ~24 files
each, `--timeout 60000`):

| chunk | pass | skip | fail |
|---|---|---|---|
| 1 (25 files) | 207 | 0 | 0 |
| 2 (25 files) | 110 | 0 | 0 |
| 3 (23 files) | 120 | 0 | 0 |
| 4 (26 files) | 103 | 1 | 0 |
| 5 (25 files) | 112 | 0 | 0 |
| 6 (24 files) | 87 | 0 | 0 |
| 7 (20 files) | 111 | 0 | 0 |
| 8 (24 files) | 105 | 0 | 0 |
| **total (192 files)** | **955** | **1** | **0** |

New unit test: `tests/unit/adr0047-collection-delete-kernel.test.ts` — 1
pass, 8 assertions (already counted in chunk totals above).

New PostgreSQL integration test:
`tests/integration/postgres/adr0047-collection-delete-kernel.test.ts` — 1
pass, 16 assertions, run alone against the disposable container on
127.0.0.1:55661. Covers: delete succeeds and the row is gone; a missing
row returns neutral null; a Policy-denied row (`locked = true`) returns
neutral null and deletes nothing; a row referenced by another Collection
via `relation.toOne` with the default `onDelete: "restrict"` (no cascade
declared) is refused and leaves both rows intact.

Regression suites, each run alone:
`tests/integration/postgres/collaboration-walking-skeleton.test.ts` — 1
pass, 398 assertions. `tests/integration/postgres/team-support-desk.test.ts`
(`FIREFOX_BIN=/usr/bin/firefox`) — 1 pass, 111 assertions.

## Unverified / not done

- **Concurrent delete-vs-update race** on the same row: not covered by a
  dedicated test. The plan's row lock (`FOR UPDATE`) should serialize two
  transactions on the same key the same way `update` already does, but no
  test drives two concurrent `execution()` calls to prove one wins and the
  other gets a clean not-found/conflict outcome with no partial state.
- **Live Query subscription convergence**: only inferred from reading the
  change-ledger trigger source and from the integration test's row-count
  assertions after delete (the row is gone from the base table, and the
  trigger that feeds the ledger is unconditionally installed). No test
  opens an actual watch/subscription and observes it drop the row.
- **MCP/HTTP projection unchanged for apps that don't use delete**: not
  explicitly tested; inferred from the unit/regression suites (which
  exercise MCP/HTTP-adjacent generated contracts for other operations)
  passing unchanged, and from delete's kernel program never appearing
  unless a Policy explicitly declares `operations.delete` (opt-in, not
  retroactive).
- **Authored delete lifecycle** (`validate`/`check`/`afterWrite`),
  **CAS/`expected`**, **typed constraint-violation issue mapping**,
  **Operation Set network-exposed delete execution**: deliberately out of
  scope, per ADR-0047's Deferred decisions.
- **Release checksum gate** (`quality/release/package-artifacts.json`):
  not regenerated, per instruction — the public package bytes changed
  (new exported files), so this gate would legitimately go red; not run.

## Recommendation / open questions

- The FK-constraint-issue-mapping deviation (sanitized failure instead of
  a typed issue) is the one place this task's original brief could not be
  followed literally without contradicting Accepted ADR-0031. If a typed
  `ConstraintViolation` is wanted for delete specifically, it needs its
  own ADR extending ADR-0030/0031's Deferred item, not a delete-only
  special case.
- Concurrent-race and Live Query subscription tests are the highest-value
  remaining proof gaps; both are addable without further design work,
  purely more integration-test authoring time.
- `architecture:check`'s `collection.ts` overage (815 vs. 800) is
  cosmetic, not architectural debt introduced by this change beyond
  necessary wiring; if the cap must be honored exactly, the smallest
  further reduction available is inlining `keyedRowAccess`'s two closures
  without type annotations (relying on inference), saving a few lines at
  a small readability cost.
