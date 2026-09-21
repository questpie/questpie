# ADR-0048: Compiler-owned database-level Collection and Field immutability

- Status: Proposed (implemented; not marked Accepted — owner sign-off items
  remain, see below)
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
    for every writer regardless of role, (b) compose with `RETURNING`,
    `MERGE`, `ON CONFLICT DO UPDATE` the same way `database-owned-update.ts`'s
    existing `BEFORE UPDATE` trigger already does, and (c) can be ordered
    deterministically against the `AFTER` Change Ledger capture trigger.
    **Correction (this pass, per adversarial review):** an earlier draft of
    this ADR claimed the only bypass of a `BEFORE` trigger was a superuser
    setting `session_replication_role = replica`. That was wrong on two
    counts: (1) it requires no superuser — on PostgreSQL 15+ a role can be
    granted `SET ON PARAMETER session_replication_role` without superuser,
    and (2) it is not a rare escalation but the **default** posture of every
    logical-replication apply worker, which always runs with
    `session_replication_role = replica` so it does not re-fire triggers the
    origin already fired. A trigger created with PostgreSQL's default firing
    status (`'O'`, origin-only) is therefore skipped by every subscriber in
    a logical-replication topology and by any session with that GUC set —
    not just by a trusted superuser deployment boundary. **Fix shipped in
    this pass:** every guard trigger is created `ENABLE ALWAYS`
    (`ALTER TABLE ... ENABLE ALWAYS TRIGGER ...`, `pg_trigger.tgenabled =
'A'`), the one firing status that fires regardless of
    `session_replication_role`, and the expected catalog pins
    `triggerEnabled: "A"` so a guard silently downgraded to `'O'`/`'D'`/`'R'`
    out of band is `QP-SCHEMA-028` drift. Actual superuser bypass
    (`ALTER TABLE ... DISABLE TRIGGER ALL`, direct catalog surgery, or
    dropping the trigger outright) remains a trusted deployment boundary and
    a conformance failure, not a protected application path — consistent
    with ADR-0012's own framing — but the replication-role bypass this
    correction closes required no superuser or deployment-boundary trust at
    all, which is why it was a real bug, not an accepted risk.
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
  Collection/Field:** classified `safe` (existing `migration-classification.ts`
  vocabulary, as implemented in `migration-diff.ts`'s `immutabilityGuardSteps`
  and the equivalent block in `createSteps`) unconditionally — the guard is a
  `CREATE FUNCTION`/`CREATE TRIGGER` pair, instantaneous DDL that only takes a
  brief `ACCESS EXCLUSIVE`/`SHARE ROW EXCLUSIVE` lock, never rewrites the
  table, and never touches existing rows (a guard only rejects _future_
  writes). No `--accept-destructive` required to add, and none of the
  existing rows are scanned, validated, or at risk — unlike adding a `NOT
NULL` column, there is no data already in the table that could violate the
  new guarantee retroactively.
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
- **Kernel capability suppression (compile-time, not runtime): implemented.**
  `packages/compiler/src/mutation/operation-set.ts`'s
  `projectCollectionOperationSets` rejects an `update` or `delete` member on
  an append-only Collection's Operation Set with the existing
  `QP-COMPOSE-013 structuralTypeError` diagnostic (the same code this file
  already uses for every other statically-caught capability-shape violation,
  e.g. exposing a database-owned or kernel-immutable Field as caller input)
  — no new diagnostic code was needed. This turns "the framework's own
  writer would hit the trigger" into a build-time error instead of a runtime
  `RAISE EXCEPTION`: `compileApplication` throws before any SQL is generated
  for that Mutation. Field-level write-once exclusion from the `update`
  caller-input and trusted-value lanes required no new logic at all, because
  `immutable: "database"` already sets the field contract's `immutable: true`
  (a strict superset), and the existing `contract.immutable === true` checks
  in the same file already exclude it.
- **Compiler-planned bypass for migrations: NOT supported in this slice
  (v1).** Supervisor decision, reversing this ADR's earlier draft position.
  An append-only Collection cannot be backfilled by a migration at all while
  `appendOnly: true` is set: there is no step type that disables a guard,
  audited or otherwise. A migration that needs to backfill such a table must
  either (a) apply while the declaration is temporarily removed (a
  destructive-class change requiring `--accept-destructive`, per the
  "Removing" bullet above) and re-added afterward as a second, separately
  acknowledged migration, or (b) be written before the Collection ever
  becomes append-only. This is deliberately conservative: an audited
  disable/enable escape hatch is exactly the kind of narrow exception that
  is easy to state and easy to misuse later (a migration author under
  deadline pressure "just" backfilling one extra column while the guard is
  down); a future slice may reconsider this with its own explicit ADR if a
  real product need proves the two-migration workaround insufficient.

### 4. Error identity

- Both guard functions `RAISE EXCEPTION` with a fixed, reserved SQLSTATE:
  `QP001` for the append-only guard, `QP002` for the write-once guard
  (`packages/compiler/src/schema/postgres/append-only.ts`,
  `APPEND_ONLY_SQLSTATE`/`WRITE_ONCE_FIELD_SQLSTATE`). **Verified, per
  supervisor instruction:** PostgreSQL's SQLSTATE scheme (documented in its
  manual's Appendix A, "PostgreSQL Error Codes") gives every condition a
  5-character code whose first two characters are its "class". A class is
  standard-defined only when its first character is a digit `0`-`4` or a
  letter `A`-`H`; classes whose first character is a digit `5`-`9` or a
  letter `I`-`Z` are reserved for implementation- and application-defined
  conditions and will never be assigned a standard meaning. `Q` (the first
  character of both `QP001` and `QP002`) falls in the `I`-`Z` range, so
  neither code can collide with any current or future PostgreSQL-defined
  condition. A repository-wide `grep` for `RAISE EXCEPTION`/`USING ERRCODE`
  across `packages/compiler/src/schema/postgres/*.ts` (`internal-protocol-v3*.ts`,
  `internal-protocol-v4-sql.ts`, `internal-protocol-v3-realtime.ts`) found no
  other custom SQLSTATE anywhere in this codebase — every other raised
  exception uses plpgsql's default `P0001`, so `QP001`/`QP002` also do not
  collide with an existing compiler-owned condition. Collision against a
  third-party PostgreSQL _extension_ the deployment happens to install
  remains unverified (no such extension was in the test database) and is
  carried forward as a residual, lower-probability risk, not blocking.
  A message that embeds the Collection identity (and, for write-once, the
  Field identity) is included:
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
  operation (compile-time `update`/`delete` capability suppression for
  append-only Collections; write-once Fields already excluded from the
  update lane via the existing `immutable` contract). There is no
  compiler-planned bypass for migrations in this slice: an append-only
  Collection cannot be backfilled while the declaration is set; the
  declaration must be temporarily removed (destructive, acknowledged) and
  re-added afterward.
- Implemented and proven against a real PostgreSQL 17 database (see
  `docs/v4/implementation/collection-db-immutability.md`): direct
  `psql`-equivalent `UPDATE`/`DELETE`/`TRUNCATE` refused with the reserved
  SQLSTATE; `migration apply` idempotent; out-of-band `DROP TRIGGER`
  detected as `QP-SCHEMA-028` drift; the fixed `bunx questpie migration plan`
  recovery hint (item 3 below) shipped in this slice.

## Open items for owner sign-off

1. ~~Custom SQLSTATE codes need a collision check against any PostgreSQL
   extension~~ — **resolved for this repository's own code**: `QP001`/`QP002`
   verified against PostgreSQL's Appendix A class-reservation rule and
   against every other `RAISE EXCEPTION`/`USING ERRCODE` in this codebase
   (see "Error identity" above). Collision against a third-party extension
   installed by a specific deployment remains unverified and is a residual,
   low-probability risk for the owner to accept or reject.
2. Whether to _additionally_ `REVOKE UPDATE, DELETE ON <table> FROM
<application_role>` as defense in depth once the kernel is compile-time
   incapable of emitting those statements anyway — **decided for this
   slice: no.** Supervisor instruction: not implemented; left as optional
   future defense in depth. It would still be valuable against a
   compromised/misused application credential, but changes the privilege
   model for shared roles (the generated kernel typically connects as the
   table owner) and needs its own review, separate from this slice.
3. ~~The dangling `QP-SCHEMA-027` recovery hint~~ — **fixed in this slice**:
   `packages/compiler/src/schema/postgres/apply.ts`'s drift recovery now
   reads `bunx questpie migration plan --name <slug>` (the command that
   actually surfaces drift, via `inspectSchemaFingerprint` when a
   `DATABASE_URL`/connection string is available), replacing the
   nonexistent `bunx questpie schema drift`.
4. **New in this slice**: whether the two-migration workaround for
   backfilling an append-only table (remove declaration → backfill →
   re-add declaration) is acceptable product ergonomics, or whether a
   future ADR should add the narrower audited-bypass step type this ADR's
   first draft proposed and the supervisor then declined for v1.

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
