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

Decision record: `docs/adr/0048-collection-database-immutability.md` (Status:
Proposed — not Accepted; do not treat this as authorized for a full
implementation slice without owner sign-off, per that ADR's open items).

## What this pass actually did

This pass covered reconnaissance and the design decision only. It did **not**
change any code. Concretely, this pass:

1. Read the existing trigger-planning precedents in
   `packages/compiler/src/schema/postgres/change-capture.ts` (ADR-0012 Change
   Ledger capture: shared `questpie_internal` functions, part of the
   versioned internal protocol) and
   `packages/compiler/src/schema/postgres/database-owned-update.ts`
   (`onUpdate: "now"`: per-field generated functions in the application's own
   schema, _not_ part of the internal protocol).
2. Confirmed, by reading `internal-protocol-v9.ts` and
   `internal-protocol-v3.ts` (where `capture_reactive_row`/
   `capture_reactive_truncate` are defined), that only the first pattern is
   gated behind the `internal-protocol-vN` cutover machinery
   (ADR-0006/ADR-0043). The `database-owned-update.ts` pattern is not.
3. On that basis, decided database-level immutability should follow the
   `database-owned-update.ts` shape (per-object, application-schema,
   `SECURITY INVOKER`, `REVOKE ALL FROM PUBLIC` functions) — which means
   **this feature does not require an internal-protocol-v9 → v10 bump.**
   This was the single largest open risk named in the task (a protocol bump
   is an explicit STOP/owner-decision point) and it resolves to "not needed"
   given the chosen mechanism.
4. Confirmed free `QP-SCHEMA-0xx` diagnostic code space: `008`–`019` and
   `030` are unused anywhere in `packages/` or `docs/` on this branch.
5. Confirmed the existing `migration-classification.ts` vocabulary
   (`safe`/`guarded`/`destructive`) already has a precedent for "relaxing a
   guarantee is destructive" (nullable relaxation, widening constraints),
   which the ADR uses to classify removing `appendOnly`/`immutable:
"database"` as destructive, and adding it as safe.
6. Wrote ADR-0048 with the full declaration API, mechanism choice and
   rejected alternatives (REVOKE-only, RULEs, shared internal-protocol
   functions, automatic enforcement of existing `immutable: true`), firing
   order against ADR-0012 capture triggers, drift/fingerprint wiring,
   lifecycle (add/remove/rename, migration-scoped audited bypass for
   backfills), and the kernel capability-suppression requirement
   (compile-time diagnostic, not a runtime trigger error, for any Mutation
   that tries `update`/`delete` on an append-only Collection).
7. Registered ADR-0048 in `docs/adr/README.md` under Proposed.

## What was NOT done (explicitly out of scope for this pass)

- No code changes anywhere in `packages/compiler`. No new module
  (`postgres/append-only.ts` as designed in the ADR), no `field-contract.ts`
  change to accept `immutable: "database"`, no `contracts.ts` change to
  accept Collection-level `appendOnly`, no wiring into
  `expected-fingerprint.ts`/`fingerprint.ts`, `catalog-reader*.ts`,
  `migration-diff.ts`, `migration-step.ts`, `migration-planning.ts`,
  `migration-renderer.ts`, `migration-classification.ts`, or
  `postgres/apply.ts`.
- No new `QP-SCHEMA-0xx` diagnostic implementation (codes identified as free,
  not registered in `diagnostic.ts`).
- No kernel-side compile-time capability suppression (no Mutation-shape
  diagnostic for `update`/`delete` against an append-only Collection).
- No Runtime PostgreSQL-error → typed-issue mapping for the new SQLSTATEs.
- No `QP-SCHEMA-027` dangling recovery-hint fix (`bunx questpie schema
drift` still points at a nonexistent command) — filed as ADR-0048 open
  item 3, not fixed here.
- **No tests of any kind were written or run**, because no implementation
  exists yet to test. Nothing in "PROOF" (unit tests, PostgreSQL integration
  test, idempotency, drift detection, `alreadyApplied`) was attempted.
- **No gates were run.** No format/lint/typecheck, no `package:check`, no
  `architecture:check`, no unit suites, no `cli-onboarding-packed`, no
  `collaboration-walking-skeleton`/`team-support-desk` regression suites. The
  worktree has zero code diff (`git status` is clean except the two new docs
  files and the README index edit), so there is nothing for those gates to
  meaningfully check that differs from the branch's base commit
  (`a2c8e4a08`), and running multi-minute PostgreSQL suites against a
  no-op change would not produce meaningful evidence.
- No disposable PostgreSQL container was started (`v4-immut-pg`) — not
  needed since no schema/DDL code was written to test against it.

## Why this pass stopped at the design/ADR layer

The task's own gating language — "if emitting new object kinds requires a
protocol bump ... STOP before bumping, write the options and your
recommendation in the ADR, and report — that is an owner decision" — signals
that the single highest-leverage, highest-risk decision in this task is
exactly the mechanism choice made here (per-application-schema functions vs.
shared `questpie_internal` functions requiring a protocol cutover). Given the
size of the remaining implementation surface (new compiler module, six+
existing modules to wire into, new diagnostics, kernel-side static
capability checking, a migration-scoped audited-bypass step type, a
PostgreSQL integration test matrix covering direct-`psql` UPDATE/DELETE/
TRUNCATE refusal, write-once column refusal, Live-Query-plus-capture
coexistence, drift detection, idempotent re-apply, and plan-class tests for
add/remove of the declaration, plus running the full named gate list), doing
that work carelessly in the same pass as the mechanism decision risked
either an untested half-wired feature or fabricated gate results. Neither is
acceptable per this repository's test-first and no-fabricated-evidence
norms.

## Recommended next slice (concrete, ready to pick up)

1. `packages/compiler/src/schema/postgres/append-only.ts`: two projections
   (`PostgresAppendOnlyGuardsV1`, `PostgresWriteOnceFieldGuardsV1`), copying
   `database-owned-update.ts`'s project/render/assert/verify shape.
2. `contracts.ts` + `field-contract.ts`: accept `appendOnly: true` on
   Collection definitions and `immutable: "database"` on Field definitions
   (superset of `immutable: true`); reject `immutable: "database"` without
   also implying kernel-level omission.
3. Wire both projections into `expected-fingerprint.ts`, `fingerprint.ts`
   (call sites alongside `verifyPostgresDatabaseOwnedUpdates`), and the
   catalog reader if a dedicated query is cheaper than reusing
   `database-owned-update.ts`'s generic trigger/function catalog query.
4. `migration-diff.ts`/`migration-step.ts`/`migration-renderer.ts`: new step
   kinds for add/drop of each guard kind, classified via
   `migration-classification.ts` per ADR-0048 (add = safe, remove =
   destructive).
5. New `QP-SCHEMA-008`..`011` diagnostics (append-only violation reserved
   name collision, write-once Field validation, kernel capability
   diagnostic, migration-scoped bypass validation) registered in
   `diagnostic.ts`.
6. Kernel/Mutation compiler: static check rejecting `update`/`delete`
   capability on an append-only Collection.
7. PostgreSQL integration test (new fixture or extend an existing one) per
   the task's PROOF list, run against the worktree's own disposable
   container.
8. Full gate list run and reported with real numbers.

## Unverified items carried into ADR-0048

- Custom SQLSTATE codes (`QP001`/`QP002` proposed) — collision-freedom
  against extensions not verified.
- Whether an additional `REVOKE UPDATE, DELETE` on the table (defense in
  depth beyond compile-time kernel suppression) is worth the shared-role
  privilege-model complexity — left open for the implementation slice.
