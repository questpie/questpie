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

## 2026-09-22 security review round (Opus, FIX-THEN-MERGE)

Fixed, with tests written first (each reproduced the gap or race against a
real Postgres before the fix, or against a stale `packages/questpie` dist
build that made the fix look like a no-op — see below):

- **F1/F2 (HIGH, admission-gate bypass)**: delete ran no `validate` and
  bypassed issue-mapping coverage regardless of the Collection's Policy.
  Fixed in `packages/compiler/src/lifecycle/index.ts`
  (`bindCollectionLifecyclePrograms` now attaches a kernel-owned delete's
  lifecycle program), `packages/compiler/src/mutation/generated-contract.ts`
  (the issue-mapping visibility gate now covers delete), and a new
  `currentValidation` plan step (`packages/compiler/src/mutation/
  postgres-delete.ts`, `packages/runtime/src/mutation/
  postgres-delete-program.ts`, `packages/runtime/src/mutation/
  collection-delete.ts`) that interprets `validate` against
  `{ candidate: null, current, now }` — the same "one side absent" shape
  create's own validate already uses. Tests:
  `tests/unit/adr0047-f1f2-delete-lifecycle-gate.test.ts`,
  `tests/integration/postgres/adr0047-f1f2-delete-validate.test.ts`.
- **F3 (transaction-abort proof + authoring guidance)**: proved and
  documented that an FK-refused delete dooms the whole enclosing Mutation
  transaction (no savepoints), not just the delete statement. Test:
  `tests/integration/postgres/adr0047-f3-transaction-abort.test.ts`.
- **F4 (tenancy proof)**: proved cross-tenant delete-by-key is neutral,
  leaves the row, and records no change-ledger fact, under a realistic
  `current.companyId.equal(tenant.id)` Policy, not just the reference
  fixture's boolean flag. Test:
  `tests/integration/postgres/adr0047-f4-tenancy.test.ts`.
- **Concurrency, raised to N=50 with interleaving evidence and outcome
  distributions**: `tests/integration/postgres/adr0047-concurrent-delete.test.ts`
  now runs 50 randomized trials each for delete-vs-delete and
  delete-vs-update, reporting how many times each side won and, for the
  first 10 trials of each race, polling `pg_stat_activity` concurrently
  with the race (the same technique `collaboration-walking-skeleton.test.ts`
  already uses to prove a blocked read) to assert a real lock wait was
  observed — direct evidence both transactions were in flight together,
  not serialized by accident. Results across three runs:
  delete-vs-delete a/b splits of 34/16, 29/21, 34/16 out of 50; both sides
  win every run; contention observed = true every run. Two structural test
  bugs were found and fixed along the way, both revealed only once the
  trial count and distribution assertions forced a real answer instead of
  a lucky small sample: (1) the first draft's mutual-exclusivity
  assumption for delete-vs-update was wrong (update can commit first, then
  delete removes that same row afterward — both legitimately report
  success; fixed to check final row state only); (2) with the reference
  fixture's original always-true delete Policy
  (`current.id.equal(current.id)`), delete-vs-update could never actually
  produce a "row survives" outcome — delete always eventually removes the
  row regardless of lock-acquisition order, since update never blocks a
  later delete. Fixed by giving the race fixture's delete Policy a
  realistic conditional check (`current.label.equal("race")`, denied once
  update has changed the label) so a genuine two-outcome race exists:
  whichever call wins the row lock decides the final state, and delete's
  Policy is re-evaluated fresh at write time against a row update may have
  just changed. Distributions after the fix: delete/update splits of
  27/23, 22/28, 25/25 out of 50; both sides win every run.
- **F5 (documented, no code change)**: delete then create with the same
  key resets write-once Fields and creation provenance; folded into
  ADR-0047's Consequences with the ADR-0048 (append-only Collections)
  cross-reference.
- **F7(a) architecture:check**: fixed by extracting the pure, verbatim-
  duplicated request/row helpers (`record`, `exactPaths`,
  `exactRequestWithOptionalKeys`, `decodeRow`, `bind`, …) that
  create/update/get/delete all shared into a new
  `packages/runtime/src/mutation/collection-shared.ts`, and having
  `collection-get.ts`/`collection-delete.ts` import the same copy instead
  of each duplicating it. `collection.ts`: 837 -> 670 lines.
  `architecture:check`: PASS.
- **F7(b)**: the new unit test (`adr0047-collection-delete-kernel.test.ts`)
  now has its own 30s timeout instead of Bun's 5s default.
- **F7(c)**: the runtime linker (`postgres-delete-program.ts`) now also
  verifies the write statement's parameters bind exactly the compiled key
  (mirroring the existing lock check), not just that the SQL text looks
  like a `DELETE FROM`.

- **Live Query subscription convergence — now proven end to end.**
  `tests/integration/postgres/adr0047-live-query-delete.test.ts` wires a
  network-exposed, watchable Query (`list` with `first: 1`, the same
  "detail" shape `channels.detail` already uses) over a Collection that
  also grants delete, opens the watch through the generated network
  client (the level `inv03-inverse-query-runtime.test.ts` uses — trigger
  -> change ledger -> Runtime reconciliation -> delivered snapshot, no
  lower-level harness existed that was smaller and still end-to-end),
  confirms the initial snapshot, calls the delete Mutation directly, and
  asserts (bounded `eventually`, 20s) the watch delivers a later snapshot
  of `null`. A second row proves the inverse: a Policy-denied delete
  (`current.locked === true`) never produces a "gone" snapshot within a
  2s bounded negative wait — the watch stays on the original value and
  the row is confirmed still present in the database.

Still open, with reasons:

- **Type-visibility diagnostic fix**: the misleading "property does not
  exist" TypeScript error when `.delete` is hidden by the issue-mapping
  gate is unchanged. Follow-up.
- **A true "operation" discriminator in the authored lifecycle grammar**:
  `validate` for delete works today only for Collections whose validate
  function doesn't unconditionally dereference `candidate.*`; one that
  does fails safe (dooms the transaction) rather than being rejected at
  compile time or branching explicitly. Flagged in ADR-0047 as follow-up.

### A debugging detour worth recording

The F1/F2 fix initially appeared to do nothing when exercised through the
CLI-built integration test: `plan.operation.lifecycleProgram` was always
`null` at runtime even though the compiler's own artifact
(`collection-operation-programs.json`) correctly carried
`lifecycleProgramDigest` for the kernel delete operation. Root cause:
`packages/questpie/dist/cli.js` is a **built** artifact and does not pick
up `packages/compiler`/`packages/runtime` source changes until
`bun run --cwd packages/questpie build` re-runs. Every Postgres
integration test in this feature goes through that CLI, so the package
was rebuilt before each subsequent test run in this pass; a stale build
would have silently made every later fix look like a no-op again.

### Commands and gate results (2026-09-22 round)

```
cd /home/drepkovsky/code/questpie-v4-worktrees/collection-delete
bun install --frozen-lockfile
bun run --cwd packages/questpie build     # re-run after every compiler/runtime change
bun run --cwd packages/opentelemetry build
```

- Typecheck (compiler, runtime): clean, 0 errors.
- `oxfmt`/`oxlint`: clean on all touched files.
- `architecture:check`: **PASS** (434 production TypeScript files) — was
  red on `collection.ts` (837/800 lines) before the F7(a) extraction.
- `package:check`: **PASS** (2 publishable packages valid) — was red on
  `questpie-opentelemetry: missing built export ./dist/index.d.ts`; fixed
  by running that package's own `build` script (pre-existing, unrelated
  to this feature's source changes — the package just hadn't been built
  in this worktree yet).
- New/updated unit tests re-run together:
  `adr0047-collection-delete-kernel`, `adr0047-f1f2-delete-lifecycle-gate`,
  `beta06-operation-set-projection`, `adr0030-compiler-provenance`,
  `adr0030-runtime-operation-adapter`, `beta06-runtime-collection-operations`,
  `beta06-runtime-postgres-operation-program`: **44 pass, 0 fail, 215
  assertions**.
- New PostgreSQL integration tests, run together as a sanity pass (final
  gate run has them alongside the regression suites, each alone — see
  final report): `adr0047-collection-delete-kernel`,
  `adr0047-f1f2-delete-validate`, `adr0047-f3-transaction-abort`,
  `adr0047-f4-tenancy`: **4 pass, 0 fail, 49 assertions**.
  `adr0047-concurrent-delete` (delete-vs-delete, delete-vs-update, 10
  trials each): **2 pass, 0 fail, 44 assertions**.
