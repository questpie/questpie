# ADR-0048: Compiler-owned database-level Collection and Field immutability

- Status: Proposed
- Date: 2026-09-21
- Owners: compiler, schema lifecycle
- Ticket: Autopilot port kill criterion — see
  `autopilot-worktrees/v4-r1/docs/architecture/v4-r1-stage-a-evidence-2026-09-21.md`
  section 3.

## Context

A real application (Autopilot) has 69 migrations that add PostgreSQL triggers
and constraints to protect rows against writers that bypass the generated
kernel entirely: direct `psql`, another service's credentials, a buggy
one-off script. Two shapes recur: append-only audit/evidence tables (no
`UPDATE`, no `DELETE`, ever) and write-once columns on otherwise mutable rows.

Today the schema model in `packages/compiler/src/schema` has no trigger _step_
at all except the two the compiler already owns for its own reasons: the
Change Ledger capture trigger (ADR-0012, `change-capture.ts`) and the
database-owned `onUpdate: "now"` timestamp trigger (`database-owned-update.ts`).
A trigger added out of band — by hand, by a raw migration, by a DBA — makes
every later `migration apply` fail with `QP-SCHEMA-027 targetDrift` during
planning and `QP-SCHEMA-028 invalidObject` at Runtime startup, because the
catalog reader (`catalog-reader.ts`) enumerates all non-internal triggers on
managed tables and compares them against the expected fingerprint. There is no
declarative way to make that object legitimate.

Separately, `field.*({ immutable: true })` (`field-contract.ts` line ~348)
already exists but is a **kernel-only** promise: the generated Mutation input
type omits the field after create, and nothing else. `packages/compiler` never
reads `field.immutable` when planning schema objects. A writer that reaches
the table directly — the exact class of writer this ADR is about — can update
that column freely.

This blocks Autopilot's port: it cannot express 69 existing guarantees, so
every one of them would have to become either (a) unenforced at the database
level, a real regression, or (b) a hand-authored trigger the compiler cannot
see, which permanently breaks `migration apply`/startup drift detection for
that table.

## Two existing precedents for compiler-owned triggers

`packages/compiler/src/schema/postgres/` already carries two different trigger
mechanisms, and they differ in exactly the way that matters for this decision:

1. **`change-capture.ts`** (ADR-0012): one pair of trigger functions,
   `questpie_internal.capture_reactive_row` / `capture_reactive_truncate`,
   defined _once_ as part of the versioned internal protocol
   (`internal-protocol-v3.ts`, carried forward to v9). Every reactive
   Collection's trigger is a thin `CREATE TRIGGER ... EXECUTE FUNCTION
questpie_internal.capture_reactive_row(args...)` referencing that shared,
   `SECURITY DEFINER`, owner-locked function. Adding a _new_ shared function
   name to `questpie_internal` means adding it to the internal protocol
   catalog and checksum, which is exactly the kind of change ADR-0006/ADR-0043
   gate behind an explicit, non-rolling protocol version cutover (the
   `internal-protocol-vN` sequence, currently v9).

2. **`database-owned-update.ts`**: one function _per protected field_,
   generated into the **application's own PostgreSQL schema**
   (`schema.application.postgresSchema`), `SECURITY INVOKER`, `REVOKE ALL ...
FROM PUBLIC`, verified by a catalog query scoped to that schema. It is
   fingerprinted with the same `canonicalBytes`/`digest` idiom as every other
   schema object and never touches `questpie_internal` or the internal
   protocol version at all.

Database-level immutability is data-plane, per-application policy — the same
shape as the `onUpdate: "now"` trigger, not the same shape as cross-application
Change Ledger capture (which genuinely is shared framework machinery that
every reactive Collection in every application must agree on bit-for-bit).

**Decision: follow the `database-owned-update.ts` shape.** Both new object
kinds — the append-only guard and the write-once field guard — are generated,
per-collection/per-field, `SECURITY INVOKER` PL/pgSQL functions and triggers
owned by the application's own PostgreSQL schema, not by `questpie_internal`.

### Protocol version impact — no bump required, but flagged for owner sign-off

Because neither new trigger function is added to `questpie_internal` or to
`internalProtocolV9Catalog`/`internalProtocolV9Sql`
(`internal-protocol-v9.ts`), **this slice does not require an
internal-protocol-v9 → v10 cutover.** The objects are ordinary managed schema
objects, planned, diffed, rendered, and fingerprinted exactly like columns,
indexes, and the existing database-owned-update trigger — all of which already
coexist with internal-protocol-v9 without being part of it.

This is still flagged here as a STOP/owner-decision point per the working
agreement, because the alternative (shared `questpie_internal` functions,
option B below) was seriously considered:

- **Option A (chosen): per-object functions in the application schema.**
  Pros: no protocol bump, reuses a proven, already-shipped pattern
  (`database-owned-update.ts`), smaller blast radius, each function's body is
  trivial and fully determined by its parameters so duplication cost is low
  (a few lines of PL/pgSQL per guarded table/field, not a shared library).
  Cons: N functions instead of 1 shared one; a body-text change to the guard
  logic must be re-rendered into every existing function by a migration
  instead of a single internal-protocol upgrade.
- **Option B (rejected for this slice): shared `questpie_internal` functions**
  like Change Ledger capture. Pros: one function body to maintain forever,
  consistent with the "framework machinery" precedent. Cons: forces an
  internal-protocol-v9 → v10 non-rolling cutover (ADR-0006/ADR-0043) for a
  feature that is fundamentally per-application policy, not shared
  cross-application infrastructure; raises the stakes of this slice from "new
  schema object kind" to "coordinated protocol cutover," which is exactly the
  kind of decision this task was told to stop and escalate rather than make
  unilaterally.

If a future slice needs the shared-function shape (e.g. because guard bodies
need to evolve independently of application migrations), that is a separate,
explicitly-scoped ADR that proposes internal-protocol-v10.

## Decision

### 1. Declaration API

- **Collection-level, append-only:** `collection.<name>({ ..., appendOnly:
true })`. Chosen over `immutable: true` at the Collection level because
  CONTEXT.md already uses "immutable" for value-level (Context, Execution,
  wire envelope) semantics, and because the guarantee is specifically "no
  `UPDATE`, no `DELETE`" — `appendOnly` names the mechanism precisely and
  matches the existing "append-only Runtime Envelope" vocabulary in
  CONTEXT.md/SPEC.md. `INSERT` remains unrestricted at the database level
  (Policy/Authority still gate it through the kernel); `TRUNCATE` is refused
  by the same guard (see below).
- **Field-level, write-once:** `field.*({ ..., immutable: "database" })`,
  **opt-in**, not automatic for the existing `immutable: true`.
  - Automatic enforcement was rejected: `field.*({ immutable: true })` is
    already used across existing applications purely for the kernel-level
    promise ("this Mutation input never re-offers the field"), most commonly
    on fields that legitimately need a compiler-planned or operator backfill
    later (renamed fields, corrected default, migrated foreign key). Making
    every one of those fields database-immutable retroactively would turn an
    ordinary future `alterField`/backfill migration into a hard failure for
    every existing application on upgrade, with no way to opt out short of
    editing every Field declaration — a correctness regression injected by a
    compiler upgrade, which the schema lifecycle contract (ADR-0002) does not
    allow silently.
  - `immutable: "database"` is a strict superset of `immutable: true`
    (kernel-level omission is required whenever database-level enforcement is
    requested — offering `update` on a column the database will refuse is a
    compiler diagnostic, not a runtime surprise); `field.*({ immutable: true
})` keeps its current, unchanged, kernel-only meaning.

### 2. Planned schema objects

New module `packages/compiler/src/schema/postgres/append-only.ts` (modeled
directly on `database-owned-update.ts`):

- **Append-only Collection guard**: one `BEFORE UPDATE OR DELETE` row trigger
  plus one `BEFORE TRUNCATE` statement trigger per append-only Collection,
  each calling a generated `SECURITY INVOKER` PL/pgSQL function in the
  application's own schema that unconditionally `RAISE EXCEPTION`s with a
  fixed SQLSTATE and a message naming the Collection identity. `REVOKE ALL ...
FROM PUBLIC` on the function (matches `database-owned-update.ts`).
- **Write-once Field guard**: one `BEFORE UPDATE` row trigger per Collection
  that has at least one `immutable: "database"` field (not one trigger per
  field — PostgreSQL fires row triggers per statement, and a single generated
  function can check `IS DISTINCT FROM` for every guarded column on that
  table and raise naming the first changed column), function generated the
  same way.
- **Mechanism choice — row/statement `BEFORE` triggers, not rules or bare
  `REVOKE`:**
  - `REVOKE` alone does not stop the table owner or a superuser, and the
    generated kernel connects as the application's own role, which typically
    _is_ the table owner in the current bootstrap (`bootstrap.ts`) — revoking
    `UPDATE`/`DELETE` from that role would also stop the kernel's own
    legitimate paths on other Collections sharing the role, and does nothing
    against a superuser `psql` session, which is the primary threat named in
    the evidence doc. Rejected as insufficient on its own; still applied
    additionally is out of scope for this slice (see open question below).
  - `RULE`s rewrite the query at parse time and interact badly with
    `RETURNING`, are officially discouraged since PG 10+ in favor of
    triggers, and would fire _before_ row visibility the same way a `BEFORE`
    trigger does but with much worse composability with the existing
    trigger-based Change Ledger capture — rejected.
  - **`BEFORE` row/statement triggers** are the only mechanism that (a) fire
    for every writer regardless of role, short of superuser `session_replication_role
= replica` bypass (an explicit, auditable, already-out-of-scope
    escalation, consistent with ADR-0012's "actual superuser ... remain
    trusted deployment boundaries, not protected application paths"), (b)
    compose with `RETURNING`, `MERGE`, `ON CONFLICT DO UPDATE` the same way
    `database-owned-update.ts`'s existing `BEFORE UPDATE` trigger already
    does, and (c) can be ordered deterministically against the `AFTER`
    Change Ledger capture trigger.
  - `TRUNCATE`: covered by a `BEFORE STATEMENT` trigger on the append-only
    guard, refusing before the Change Ledger's own `AFTER TRUNCATE` capture
    trigger runs (see firing order below) — so an append-only table's
    `TRUNCATE` never reaches Change Ledger capture at all, and is refused,
    matching "no DELETE at the database level" (`TRUNCATE` is unqualified
    delete-all).

- **Firing order vs. ADR-0012 Change Ledger capture (same table):**
  PostgreSQL fires same-timing/same-event triggers in name order
  (`pg_trigger.tgname`, alphabetical). The guard triggers are named with a
  `questpie_guard_` prefix and the capture triggers already use a
  `_questpie_capture_row`/`_questpie_capture_truncate` suffix pattern
  (`shortenedPostgresName`) — sorting on the _table-qualified_ name would be
  fragile, so this ADR requires the guard trigger name to embed an explicit
  ordering token so guards always sort before any other trigger on the same
  timing/event: `qp00_guard_<table>` (row) and `qp00_truncate_guard_<table>`
  (statement), reusing `uniquelyShortenedPostgresName`. Because the guard is
  `BEFORE` and capture is `AFTER`, PostgreSQL already fires all `BEFORE`
  triggers (guard included) before any `AFTER` trigger (capture) regardless
  of name — the `qp00_` prefix additionally protects against a second
  `BEFORE` trigger kind being added later on the same table and firing before
  the guard. Net effect: an `UPDATE`/`DELETE`/`TRUNCATE` on an append-only
  table is refused before Change Ledger capture ever sees it — no ledger
  fact is recorded for a rejected write, which is correct (nothing committed).
  A Live Query watching the Collection is unaffected: it only observes
  committed facts, and a refused write commits nothing.
- **Name collisions:** guard function/trigger names are derived from
  `uniquelyShortenedPostgresName` the same way every other generated name is,
  guaranteeing no collision with capture (`_questpie_capture_*`),
  database-owned-update (`_questpie_on_update` / `qp_on_update_*`), or
  user-chosen Field/Collection names.
- **Schema Fingerprint:** both new catalogs (`PostgresAppendOnlyGuardsV1`
  collection guards, `PostgresWriteOnceFieldGuardsV1` field guards) are wired
  into `expected-fingerprint.ts`/`fingerprint.ts` the same way
  `verifyPostgresDatabaseOwnedUpdates` already is, so an out-of-band `DROP
TRIGGER` on a guard is `QP-SCHEMA-028 changedObject` drift at startup, and
  an out-of-band `CREATE TRIGGER` occupying a guard's reserved name is
  `QP-SCHEMA-027 targetDrift` at `migration plan` time — both truthful,
  matching the existing precedent for capture and database-owned-update
  objects.

### 3. Lifecycle of the declaration

- **Adding `appendOnly: true` / `immutable: "database"` to an existing
  Collection/Field:** classified `guarded` (existing `migration-classification.ts`
  vocabulary) if the table/column currently has rows — the guard trigger
  itself is instantaneous DDL (no table rewrite, no scan), but planning
  treats _adding a new invariant over existing data_ the same conservative way
  ADR-0002 treats a new `NOT NULL` without a default: the plan surfaces it,
  no silent data loss is possible (a guard only _rejects future writes_, it
  never touches existing rows), so this is a **safe** addition, not
  destructive. No `--accept-destructive` required to add.
- **Removing `appendOnly` / `immutable: "database"`:** classified
  **destructive**, requiring `migration create --accept-destructive` (the
  existing machinery, per `migration-classification.ts`'s existing pattern of
  treating "relaxes a guarantee" as destructive, e.g. widening a constraint).
  Rationale: dropping the guard silently is indistinguishable, from the next
  developer's perspective, from "we never had this guarantee" — the same
  asymmetry-of-harm argument that already makes column drops and nullable
  relaxation destructive.
- **Rename (Collection or Field):** the guard trigger/function names are
  derived from the _physical_ table/column name via
  `uniquelyShortenedPostgresName`, exactly like every other generated object
  name in this codebase (see `database-owned-update.ts`). A rename plans as
  drop-old-guard-name + create-new-guard-name bound to the same
  `renameCollection`/`renameField` migration step, never as an add+remove of
  the declaration itself — the guarantee is continuous across the rename.
- **Kernel capability suppression (compile-time, not runtime):** the compiler
  must not offer `update`/`delete` capability at all for an append-only
  Collection, and must reject a `Mutation` body that attempts `update`/
  `delete` calls against it as a compiler diagnostic
  (`QP-SCHEMA-0xx unsupportedCapability`, new code — see open item below),
  the same category of error as any other capability-shape violation the
  compiler already catches statically. This turns "the framework's own
  writer would hit the trigger" into a build-time error instead of a runtime
  `RAISE EXCEPTION`, matching item 4's "kernel hit maps to a typed issue, not
  a raw PostgreSQL error" requirement one layer earlier (it never reaches the
  database at all for the generated kernel's own code).
- **Compiler-planned bypass for migrations:** **supported, explicit, and
  audited**, scoped to inside a single compiler-planned migration transaction
  only. A migration step type `alterAppendOnlyBackfill`/`alterWriteOnceBackfill`
  may wrap operator-authored backfill SQL with `ALTER TABLE ... DISABLE
TRIGGER <guard>` / `... ENABLE TRIGGER <guard>` inside the same transaction
  as the rest of the migration (never outside one), recorded in the Committed
  Migration artifact so it is visible in history exactly like every other
  step (ADR-0006 transactional schema artifact protocol already guarantees
  the whole file commits atomically or not at all). This is deliberately
  narrow: it is not a general "disable my guard" escape hatch available
  outside `migration create`-generated files, and the disable/enable pair
  must bracket exactly the backfill statements the migration author wrote,
  not the whole migration.

### 4. Error identity

- Both guard functions `RAISE EXCEPTION` with a fixed, reserved SQLSTATE
  (recommend a custom class code such as `QP001` for the append-only guard,
  `QP002` for the write-once guard — PostgreSQL reserves the ability to
  register application error codes outside its own `22xxx`/`23xxx`/`42xxx`
  ranges; this needs confirmation this is collision-free against any
  extension in use, flagged as unverified below) and a message that embeds
  the Collection identity (and, for write-once, the Field identity):
  `Collection <identity> is append-only; UPDATE and DELETE are refused at the
database level` / `Field <identity> on Collection <identity> is
database-immutable; it cannot change after insert`.
- Because the generated kernel never emits `update`/`delete` for an
  append-only Collection (compile-time refusal above), the kernel can only
  ever hit the write-once field guard, and only via a legitimate `update`
  Mutation that does not touch the guarded column — which never fires the
  trigger. The only way the framework's own kernel hits either guard is a
  bug in the compiler's capability suppression; the Runtime's PostgreSQL
  error mapping layer should still map the fixed SQLSTATE to a typed issue
  (not surface a raw driver error) as defense in depth, consistent with
  "maps to a typed issue rather than a raw PostgreSQL error" — this is a
  small, mechanical addition to the existing PostgreSQL error → typed issue
  mapping and does not require new protocol.

## Consequences

- Applications can express append-only tables and write-once columns as
  declarative schema, and the compiler owns and fingerprints the resulting
  triggers, keeping `migration apply`/startup drift detection truthful for
  them — closing the Autopilot port's blocking gap.
- No `internal-protocol-v9` → `v10` cutover in this slice. If shared-function
  consolidation is wanted later, it is a new ADR.
- `field.*({ immutable: true })` keeps its exact current meaning; no existing
  application's generated migrations change on upgrade. Only applications
  that newly opt into `immutable: "database"` pay the classification cost.
- Removing either declaration is a destructive-class migration change,
  requiring explicit `--accept-destructive` acknowledgment.
- The generated kernel can never itself trigger either guard under normal
  operation; only a compiler-planned, transaction-scoped, explicitly-authored
  backfill step may temporarily disable a guard.

## Open items for owner sign-off

1. **Custom SQLSTATE codes** (`QP001`/`QP002` proposed) need a collision check
   against any PostgreSQL extension the deployment target uses; not verified
   in this pass.
2. Whether to _additionally_ `REVOKE UPDATE, DELETE ON <table> FROM
<application_role>` as defense in depth once the kernel is compile-time
   incapable of emitting those statements anyway — likely still valuable
   against a compromised/misused application credential, but changes the
   privilege model for shared roles and needs its own review; not decided
   here, left for the implementation slice.
3. The dangling `QP-SCHEMA-027` recovery hint (`bunx questpie schema drift`,
   a command that does not exist) should be fixed to point at
   `bunx questpie migration plan` (the command that actually surfaces drift)
   or filed as a follow-up if out of scope for this ADR's implementation
   slice.

## Rejected alternatives

- Automatic database enforcement for every existing `immutable: true` field
  (rejected: silent migration-breaking regression for existing applications).
- Shared `questpie_internal` guard functions, i.e. folding this into the
  internal protocol (rejected for this slice: forces an unscoped
  internal-protocol-v9→v10 cutover for what is per-application policy, not
  shared framework infrastructure).
- `REVOKE`-only enforcement (rejected: does not stop the table owner or a
  superuser, the named threat).
- PostgreSQL `RULE`s (rejected: discouraged since PG 10, poor `RETURNING`
  composability).
- A general, unscoped guard-disable escape hatch outside compiler-planned
  migrations (rejected: reintroduces exactly the "out-of-band trigger
  tampering" class this ADR closes).
