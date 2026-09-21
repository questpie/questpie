# Collection/Field database-level immutability — implementation status

Scope: give an application a compiler-owned way to declare append-only
Collections and write-once Fields that are enforced by PostgreSQL itself, so
that a writer bypassing the generated kernel (direct `psql`, another
service's credentials, a buggy script) cannot mutate or delete protected
rows, and so that drift detection (`QP-SCHEMA-027`/`QP-SCHEMA-028`) stays
truthful about those objects. Motivated by Autopilot's 69 existing
migrations doing this by hand outside v4's schema model (evidence:
`autopilot-worktrees/v4-r1/docs/architecture/v4-r1-stage-a-evidence-2026-09-21.md`
section 3).

Decision record: `docs/adr/0048-collection-database-immutability.md`
(Status: Proposed, implemented — not marked Accepted).

Worktree: `/home/drepkovsky/code/questpie-v4-worktrees/db-immutability`,
branch `work/collection-db-immutability`. Commits (in order): `cc13f20c7`
(docs/ADR reconnaissance pass), `8e894d135` (slice 1 — declaration +
compiler planning), `7b34707b6` (slice 2 — kernel capability suppression),
`3e026e551` (slice 3 — PostgreSQL integration proof + two real bugs found
and fixed), plus one small uncommitted-at-time-of-writing fix to the
`QP-SCHEMA-027` recovery hint (see Gates section — committed as part of
finishing this pass).

## Declaration API (as built)

- `defineCollection({ ..., appendOnly: true })` — no `UPDATE`, no `DELETE`,
  no `TRUNCATE` at the database level, enforced by a compiler-owned trigger.
- `field.*({ ..., immutable: "database" })` — strict superset of
  `immutable: true` (kernel omission always applies); additionally enforced
  by a compiler-owned `BEFORE UPDATE` trigger that only fires when that
  specific column's value actually changes.

## Mechanism (as built)

`packages/compiler/src/schema/postgres/append-only.ts`, modeled on
`database-owned-update.ts`: per-object, application-schema, `SECURITY
INVOKER` PL/pgSQL functions (not `questpie_internal`, so no internal
protocol version bump), `REVOKE ALL ... FROM PUBLIC`. Append-only
Collections get one function shared by a `BEFORE UPDATE OR DELETE FOR EACH
ROW` trigger and a `BEFORE TRUNCATE FOR EACH STATEMENT` trigger; write-once
Fields get one `BEFORE UPDATE FOR EACH ROW` trigger per field, checking `NEW
IS DISTINCT FROM OLD` for that column only. Both raise a fixed, reserved
SQLSTATE (`QP001` append-only, `QP002` write-once) naming the Collection
(and Field). No `REVOKE UPDATE/DELETE` from the application role was added
(supervisor decision: left as optional future defense in depth, open item 2
in the ADR).

## Slices completed

1. **Declaration + compiler planning** (`8e894d135`). New projection module;
   wired into `contracts.ts` (`immutabilityGuards` on `SchemaProjectionV1`,
   4 new migration step kinds), `migration-diff.ts` (add = safe, remove =
   destructive, mirroring `database-owned-update.ts`'s pattern exactly),
   `migration-renderer.ts`, `schema/index.ts` exports, `artifacts.ts`,
   `fingerprint.ts` (verify + managed-object identities so drift stays
   truthful), `database-readiness.ts` (startup readiness, mirroring the
   existing `readiness.database-owned-updates` statement). Threaded through
   the authoring DSL: `packages/questpie/src/index.ts` (`FieldBaseOptions`,
   `fieldDefinition` generics, `defineCollection`), `field-contract.ts`,
   `collection-contract.ts`. Widened two type-level `FieldDefinition`
   pattern matches (`collection-input.ts`'s `FieldOperationValue`,
   `operation-set.ts`'s `TrustedFieldNames`) so a field with
   `immutable: "database"` doesn't collapse to `never` instead of typing
   correctly. 6 new unit tests in `tests/unit/adr0048-immutability-guards.test.ts`
   (projection/render/SQLSTATE-range/fingerprint/drift-assert/DSL-end-to-end),
   all real, all run.
2. **Kernel capability suppression** (`7b34707b6`). `model.ts`'s
   `ownerCollectionContract` carries `appendOnly` through to
   `packages/compiler/src/mutation/operation-set.ts`, which now refuses an
   `update`/`delete` Operation Set member on an append-only Collection with
   `QP-COMPOSE-013 structuralTypeError` (existing code, no new diagnostic
   needed) before any field/lane processing. Field-level write-once
   exclusion needed zero new compiler logic — it was already covered by
   slice 1's decision to make `immutable: "database"` set `immutable: true`.
   Widened the DSL's own type-level `Immutable extends true` checks to
   `true | "database"` for static-type parity. 2 new `compileApplication`-based
   tests proving `update` and `delete` are each refused with a message
   naming the Collection and ADR-0048.
3. **PostgreSQL integration proof** (`3e026e551`). New
   `tests/integration/postgres/adr0048-immutability-guards-postgres.test.ts`,
   gated on `PGHOST`, run against the worktree's own disposable Postgres 17
   container (`v4-immut-pg`, port 55671). Found and fixed two real bugs
   while getting this test green against a real database:
   - `migration-diff.ts`'s `createSteps()` had no path emitting
     `addAppendOnlyGuard`/`addWriteOnceGuard` for a **brand-new** Collection
     (the per-existing-collection diff path skips new collections by
     design, matching `databaseOwnedUpdateSteps`'s own skip — the missing
     piece was the block at the end of `createSteps` that
     `databaseOwnedUpdateSteps` already had and I'd missed on first read).
     Fixed by adding the equivalent block for both guard kinds.
   - `append-only.ts`'s projected `catalog` array must be sorted by
     `(table, triggerName)` to byte-match the catalog reader's
     `ORDER BY c.relname, t.tgname`. Unsorted, a real `migration apply`
     against a real database produced a false `QP-SCHEMA-027 targetDrift`
     immediately after installing byte-identical objects — the content
     matched, only the array order differed, and `canonicalBytes` comparison
     is order-sensitive. Fixed with an explicit sort.
     Proven, for real, against PostgreSQL 17:
   - direct `UPDATE`/`DELETE`/`TRUNCATE` on an append-only table refused
     with SQLSTATE `QP001` naming the Collection;
   - kernel-equivalent `INSERT` succeeds and is recorded by Change Ledger
     capture on the same table (ADR-0012 coexistence);
   - a refused `UPDATE` records **no** Change Ledger fact — the guard
     (`BEFORE`) fires before capture (`AFTER`) always, by PostgreSQL's own
     trigger-timing semantics, not by a naming trick;
   - a write-once column refuses a direct `UPDATE` of itself (`QP002`) but
     not of a sibling column on the same row;
   - an out-of-band `DROP TRIGGER` is caught as `QP-SCHEMA-028` drift;
   - `migration plan → migration create → migration apply` through the real
     `questpie` CLI: adding the declaration to a new Collection plans
     `addAppendOnlyGuard`/`addWriteOnceGuard` steps and installs a working
     trigger; `migration apply` is idempotent (second run reports
     "already applied"); removing the declaration plans `destructive` and
     `migration create` refuses without `--accept-destructive`
     (`QP-SCHEMA-020`), succeeding once acknowledged.
     Also found, not a bug, a real interaction worth recording: when a
     Collection is both `appendOnly` and has a write-once Field, a raw
     `UPDATE` of that Field can trip either guard depending on PostgreSQL's
     trigger-name ordering (`evidence_log_kind_questpie_write_once_*` sorts
     before `evidence_log_questpie_append_only_*`, so the write-once guard
     fires first on that table). Both are correct refusals; the append-only
     guard's own SQLSTATE is proven in isolation (no competing write-once
     guard on the same table) by the first raw-SQL test.
4. **Gates** (this pass). See below for exact numbers.

## Gates — real commands and results

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/db-immutability` with
`TMPDIR=/home/drepkovsky/.cache/v4-immut-tmp`. PostgreSQL:
`docker run -d --rm --name v4-immut-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_INITDB_ARGS=--locale=C.UTF-8 -p 127.0.0.1:55671:5432 postgres:17`,
env for Postgres-gated tests: `PGHOST=127.0.0.1 PGPORT=55671 PGUSER=postgres
PGPASSWORD=pw PGDATABASE=postgres QUESTPIE_REALTIME_HMAC_KEY=<random 32-byte
hex>` (`cli-onboarding-packed` needs the HMAC key for its packaged
tutorial's `try-ticket.ts`; not documented as a test prerequisite anywhere
in the test file itself, only in the tutorial docs — a real onboarding
friction point, noted but not fixed, out of this ADR's scope). Dependencies
installed with `bun install --frozen-lockfile` only.

- `bunx oxfmt` / `bunx oxlint` on every changed file, each time a slice
  changed files: clean every time, 0 issues.
- `bun run check-types` (all 9 `types:check`-having packages via turbo):
  clean, run after each slice.
- `bun run package:check`: `package-contract: 2 publishable package(s)
valid`.
- `bun run architecture:check`: `architecture: PASS (431 production
TypeScript files)` (advisory >500-line review list grew by one file,
  `database-readiness.ts`, now 739 lines — not a failure, the check passed).
- **`tests/unit/adr0048-immutability-guards.test.ts`** (new, slice 1+2): 8
  pass, 0 fail, 48 `expect()` calls.
- **`tests/integration/postgres/adr0048-immutability-guards-postgres.test.ts`**
  (new, slice 3): 2 pass, 0 fail, 35 `expect()` calls.
- **Full `tests/unit`** (192 files), run in 6 foreground chunks
  (`ls tests/unit/*.test.ts | split -n l/6`, each chunk `bun test
--timeout=15000 <files>`):
  - chunk 1 (34 files): 252 pass, 0 fail
  - chunk 2 (32 files): 172 pass, 0 fail
  - chunk 3 (33 files): 123 pass, 1 skip, 0 fail
  - chunk 4 (33 files): 150 pass, 0 fail
  - chunk 5 (30 files): 133 pass, 0 fail
  - chunk 6 (30 files): 132 pass, 0 fail
  - **sum: 252+172+123+150+133+132 = 962 pass, 1 skip, 0 fail** across all
    192 unit test files.
- **`tests/integration/postgres/cli-onboarding-packed.test.ts`**, alone: 1
  pass, 0 fail, 55 `expect()` calls (packs the modified `questpie` package
  via `bun pm pack`, provisions the Barbershop tutorial, runs it against
  real Postgres end to end — proves the packaged/published shape of the DSL
  and CLI changes, not just the workspace-linked shape).
- **`tests/integration/postgres/collaboration-walking-skeleton.test.ts`**,
  alone: 1 pass, 0 fail, 398 `expect()` calls.
- **`tests/integration/postgres/team-support-desk.test.ts`**, alone, with
  `FIREFOX_BIN=/usr/bin/firefox`: 1 pass, 0 fail, 111 `expect()` calls.
- **`tests/integration/postgres/beta02-migration-restart.test.ts`** (touched
  by proximity: exercises `QP-SCHEMA-027`/`assertMigrationBoundary`, the
  same code path the recovery-hint fix touches): 32 pass, 0 fail, 195
  `expect()` calls.
- **Release checksum gate — legitimately red, not regenerated.**
  `QUESTPIE_RELEASE_DRY_RUN_CONTRACT=1 bun test tests/unit/beta12-release-contract.test.ts`
  fails with `release: questpie: artifact checksum mismatch (expected
8f8321d0..., received b06fdef5...)` against the committed
  `quality/release/package-artifacts.json`. This is exactly the expected,
  correct failure mode described in the task brief: the `questpie` package's
  bytes changed (new DSL surface for `appendOnly`/`immutable: "database"`),
  so its checksum no longer matches the frozen release manifest.
  `quality/release/package-artifacts.json` was **not** regenerated; this is
  reported, not fixed, per instruction. Without
  `QUESTPIE_RELEASE_DRY_RUN_CONTRACT=1` the same test file passes (2 pass, 1
  skip) because the strict dry-run pack/checksum path only runs under that
  flag — this matches the existing `release` quality lane's own use of the
  flag, not a workaround I introduced.
- **Not run**: the full `bun run quality:release` lane (started once,
  stopped deliberately after ~40s once the specific checksum evidence above
  was obtained directly and more cheaply; it duplicates the full unit suite,
  `knip:strict`, and several packed-browser suites already covered or out of
  this ADR's scope, and would have added many more minutes for no additional
  evidence relevant to this task).
- **Not run**: `tests/type/*` beyond the two files already touched
  (`adr0030-collection-input-authoring.test.ts`,
  `beta06-operation-set-authoring.test.ts`), both passing — the task's gate
  list names `tests/unit`, not `tests/type`, as the full-suite requirement.

## Files changed (cumulative)

Compiler: `packages/compiler/src/schema/postgres/append-only.ts` (new),
`packages/compiler/src/schema/contracts.ts`,
`packages/compiler/src/schema/field-contract.ts`,
`packages/compiler/src/schema/index.ts`,
`packages/compiler/src/schema/manifest.ts`,
`packages/compiler/src/schema/migration-classification.ts`,
`packages/compiler/src/schema/migration-diff.ts`,
`packages/compiler/src/schema/migration-renderer.ts`,
`packages/compiler/src/schema/postgres/database-readiness.ts`,
`packages/compiler/src/schema/postgres/fingerprint.ts`,
`packages/compiler/src/schema/postgres/apply.ts` (recovery hint),
`packages/compiler/src/model.ts`,
`packages/compiler/src/mutation/operation-set.ts`. DSL:
`packages/questpie/src/collection-contract.ts`,
`packages/questpie/src/collection-input.ts`,
`packages/questpie/src/field-contract.ts`,
`packages/questpie/src/index.ts`,
`packages/questpie/src/operation-set.ts`. Tests:
`tests/unit/adr0048-immutability-guards.test.ts` (new),
`tests/unit/pb05-postgres-database-complete-readiness.test.ts` (touched:
mocked readiness statement list),
`tests/integration/postgres/adr0048-immutability-guards-postgres.test.ts`
(new). Docs: this file, `docs/adr/0048-collection-database-immutability.md`,
`docs/adr/README.md`.

## Unverified / open items (owner)

Carried from the ADR, unchanged by this pass except where noted:

1. Custom SQLSTATE codes verified against PostgreSQL's own reservation rule
   and against this codebase; **not** verified against every possible
   third-party PostgreSQL extension a deployment might install.
2. No `REVOKE UPDATE, DELETE` defense in depth added (supervisor: deferred).
3. The `QP-SCHEMA-027` recovery hint fixed to `bunx questpie migration plan
--name <slug>` (was `bunx questpie schema drift`, nonexistent).
4. Whether the "remove declaration → backfill → re-add declaration"
   two-migration workaround is acceptable ergonomics for backfilling an
   append-only table, given this pass explicitly does not implement an
   audited in-migration bypass.
