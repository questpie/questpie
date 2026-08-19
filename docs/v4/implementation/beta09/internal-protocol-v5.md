# BETA-09: internal protocol v5, the maintenance reason

Specifies the one schema change BETA-09 owns. `maintenance-decisions.md`
decided that every maintenance command carries a bounded reason recorded in the
append-only audit; this record fixes the exact shape, the upgrade mechanics, and
the two edges the schema forces.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state. It writes no production code.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Why a protocol version at all

The accepted contract requires each maintenance command to carry a bounded
reason and an append-only audit. At this base `reason` exists on `cancelRun`
alone and lands in `durable_cancellations`; `durable_maintenance_commands` — the
audit itself — has no reason column
(`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:213`), and
`durable_run_events` cannot absorb it because it carries only a closed
`error_code` enum (`:145`, `:150`).

There is nowhere to put it. That is the whole justification, and it is why
`design-context.md` was corrected to say this slice owns one minimal internal
protocol extension.

## The column, and the edge that decides its nullability

```
reason text,
CONSTRAINT durable_command_reason_bounded CHECK (
  reason IS NULL OR length(reason) BETWEEN 1 AND 256
)
```

**Nullable at the schema, required at the surface.** This is the interesting
part, and it is forced once one premise is stated: the audit stays **one
table** and v4 rows survive in it. A fourth option exists and is rejected on
that premise rather than on impossibility — a new v5 table with
`reason text NOT NULL`, leaving v4 rows behind in the old one. `CREATE TABLE`
clears the guards exactly as `ADD COLUMN` does. It is rejected because splitting
an append-only audit across two tables to satisfy a constraint is a worse
artifact than a nullable column whose null carries a precise meaning. Within
that premise the nullability is forced; the premise itself is the choice.

`durable_maintenance_commands` is append-only, guarded by
`durable_maintenance_commands_append_only`
(`internal-protocol-v4-sql.ts:302`). Rows written under v4 genuinely had no
reason. There are only two ways to make the column `NOT NULL`: backfill
existing rows, or give it a `DEFAULT`. Both write a reason into historical
audit entries that no operator ever supplied.

**Fabricating audit content to satisfy a constraint is worse than the
constraint being loose.** So the column permits `NULL`, the CHECK bounds only
non-null values, and the requirement lives where it can be honest: the runtime
refuses any new command without a reason. A `NULL` in this column therefore
means exactly one thing — "written before v5" — and that is a true statement
about the record.

The bound reuses 1–256 from `durable_cancellation_reason_bounded`
(`internal-protocol-v4-sql.ts:210`) rather than introducing a second number.

## The rejection codes, and the second edge

**Two** codes join `DurableMaintenanceRejection`
(`packages/runtime/src/durable/postgres-maintenance.ts:20`) and the
`durable_command_rejection_known` CHECK, which currently admits
`ALREADY_REQUESTED`, `ATTEMPTS_EXHAUSTED`, `NOT_AMBIGUOUS`, `RUN_IS_TERMINAL`,
`RUN_NOT_FAILED`, and `VERSION_MISMATCH` (`internal-protocol-v4-sql.ts:232`).

`REASON_INVALID` is the one this record was written for. `AUTHORITY_DENIED`
was added later, when `hostile-cases.md` worked through the maintenance
Authority denial case: if a denial is audited — and it must be, since the
audit's purpose is that every attempt is recorded, applied or rejected — then
the denial needs a code the CHECK admits. Six members becomes eight.

Auditing a denial records the denied caller's identity against a run they
cannot see. That is correct: the audit is not visible to them, and an audit
that omits rejected attempts is the artifact this slice is trying not to ship.

The edge: **a command rejected for an invalid reason has no valid reason to
record.** The audit column cannot hold the offending value — that is what makes
it invalid.

Decision: audit it anyway, with `reason IS NULL` and
`rejection_code = 'REASON_INVALID'`. The alternative — refusing before the
audit insert — would make exactly one rejection class invisible in an
append-only audit whose entire purpose is that every attempt is recorded,
applied or rejected. The null is semantically exact here for the same reason it
is exact for pre-v5 rows: there is no valid reason to record, and the record
says so.

This also means the bound must be enforced **before** the statement, not only by
the CHECK. Today `cancelRun`'s only enforcement is the database constraint, so
an over-long reason surfaces as a raw PostgreSQL error rather than a typed
outcome — the seam defect `maintenance-decisions.md` names. Enforcing in the
command turns it into a `rejected` outcome that the audit can hold.

## Upgrade mechanics

Mirror the v3 → v4 upgrade exactly
(`packages/compiler/src/schema/postgres/internal-protocol-v4.ts:275`–`:310`):

1. Read the protocol row. If already version 5 with the v5 checksum, verify and
   return.
2. Otherwise require version 4 with the exact v4 checksum, or fail
   `QP-SCHEMA-023` / `checksumMismatch`.
3. Inside `withPinnedTransaction`: verify the v4 catalog against the recorded
   protocol row, apply the v5 SQL, `update questpie_internal.protocol set
version = 5, checksum = <v5>`, then verify v5.
4. In a `finally`, **assert the backend pid first, then release** the advisory
   lock — `assertBackendPid(sql, expectedPid, "internal protocol v4 unlock")`
   precedes `pg_advisory_unlock`
   (`packages/compiler/src/schema/postgres/internal-protocol-v4.ts:311`–`:313`).
   An earlier revision of this step said release-then-assert, which is the wrong
   order and would have been copied. The order matters: asserting first proves
   the unlock is being issued on the same backend that took the lock, and
   unlocking first would release it before that is established.

Three consequences worth stating before the implementing slice hits them:

- **DDL is not blocked by the guards.** Both the kernel guard and the
  append-only guard are DML-scoped — `BEFORE INSERT OR UPDATE OR DELETE`
  (`internal-protocol-v4-sql.ts:290`) and `BEFORE UPDATE OR DELETE OR TRUNCATE`
  (`:302`). `ALTER TABLE ... ADD COLUMN` passes both. No guard needs relaxing,
  and any change that _did_ require relaxing one should be treated as a signal
  that the change is wrong.

  **Measured rather than reasoned**, because this is the claim the whole
  migration rests on and a DDL/trigger interaction is exactly where reasoning
  goes wrong. Rebuilt both guard functions and both triggers on PostgreSQL 17.10
  against a `durable_maintenance_commands`-shaped table, with no
  `questpie.durable_kernel` setting. An unguarded `INSERT` failed as it should,
  proving the guards were live; then `ADD COLUMN reason text` succeeded, and so
  did `ADD COLUMN protocol_version integer NOT NULL DEFAULT 5` — the variant
  that historically rewrote the table and is the one this note did not name.

  **The rejection-CHECK step was measured too, because it is the migration's
  other DDL and a different operation.** Widening
  `durable_command_rejection_known` means `DROP CONSTRAINT` then `ADD
CONSTRAINT`, and the second validates every existing row rather than only
  touching the catalog. Against 50,000 rows seeded through the kernel path on
  the same guarded table, with no `questpie.durable_kernel` setting: an
  unguarded `INSERT` was refused first, then both statements succeeded.

  The resulting constraint was checked for being live rather than merely
  present, since a dropped-and-not-replaced constraint would also let the
  migration "pass": it admits `AUTHORITY_DENIED` and `REASON_INVALID`, still
  rejects an unknown code with a check-constraint violation, and appears exactly
  once in `pg_constraint`. So both DDL steps this migration needs are verified,
  not just the one this bullet originally named.

- **The catalog must be regenerated from a live PostgreSQL catalog.**
  `internal-protocol-v4-catalog.ts` is generated, not hand-written; v5 needs the
  same treatment or verification will fail against a hand-edited approximation.
- **Local databases must be dropped between iterations.** `ensure` refuses a
  same-version/different-checksum install, so any v5 SQL edit strands a local
  database until `DROP SCHEMA questpie_internal CASCADE`. CI databases are
  fresh and do not hit this. This cost BETA-08 real time.

## What v5 deliberately does not do

- No reason on `durable_cancellations`. It already has one, bounded the same
  way. Two reasons for one cancel command would be two sources of truth.
- No closed reason-code taxonomy. The accepted contract says _bounded_, which
  is a length constraint; a code list is authority no accepted document
  supplies. Decided in `maintenance-decisions.md` Q10.
- No reason in `durable_run_events`. The event stream carries a closed error
  code and no free text, and the maintenance reason is the first
  operator-authored free text to enter the durable record. Keeping it in one
  table keeps the nondisclosure surface one table wide, which
  `inspection-contract.md` relies on.
- No retention or pruning for the audit. BETA-08 dropped the retention block
  because nothing enforced it, and adding a reason column does not change that.
  Pinning retention here would repeat the failure that blocked BETA-08's first
  round.

## Judgment calls, recorded as such

**Nullable column.** Accepted authority requires a bounded reason per command;
it does not say what happens to records written before the requirement existed.
Choosing nullability over a fabricated default is mine. What would overturn it:
a decision that the v4 audit rows should not survive the upgrade at all, in
which case a migration that drops them makes `NOT NULL` honest — but destroying
audit history to satisfy a constraint is a much larger claim than this slice
should make.

**Auditing `REASON_INVALID` with a null reason.** The alternative is defensible
and simpler to implement. I chose completeness of the audit over simplicity
because an append-only audit with one silently-unrecorded rejection class is
a worse artifact than one with an explicit null. What would overturn it:
evidence that an unbounded-reason rejection is a client bug rather than an
operator action, in which case it belongs in the typed error path and not in
the operational record at all.

## The fourth upgrade consequence, which the mechanics section missed

Adding `REASON_INVALID` and `AUTHORITY_DENIED` touches **three** sites, not two.
The union (`packages/runtime/src/durable/postgres-maintenance.ts:20`) and the
`durable_command_rejection_known` CHECK
(`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:232`) are
the two this record already named. The third is
`maintenanceRejectionCodes` in the compiled durable-kernel contract
(`packages/compiler/src/reaction/durable-kernel.ts:111`), which today lists
exactly six.

That array feeds `durableKernelDigest` into `durable-kernel.json`, which the
runtime verifies semantically at startup
(`packages/runtime/src/application/artifact-files.ts:90`) and which is pinned by
exact equality in the compile-level test and in
`tests/goldens/beta01/generated-digests.json`.

**So this change moves a deployment-compatibility digest.** Six members becoming
eight is not only a schema and a type change; it changes the bytes that decide
whether a running instance considers a build compatible. That belongs in the
upgrade mechanics beside the protocol version bump, and an implementer working
only from the two sites named above would discover it as a failing golden rather
than as a planned step.

## The upgrade mechanism was tested, not read

The nullability argument turns on three mechanical claims. All three were driven
against PostgreSQL 17.10 with the same guard shape the protocol uses — a
statement-level `BEFORE UPDATE OR DELETE OR TRUNCATE` trigger raising `42501`.

| Claim                                             | Result                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ADD COLUMN` and `ADD CONSTRAINT` clear the guard | both returned `ALTER TABLE`                                                    |
| a backfill `UPDATE` is refused                    | `ERROR: append-only`                                                           |
| a `NOT NULL DEFAULT` is _mechanically_ available  | `ALTER TABLE` succeeded, and the pre-existing row read `reason = 'fabricated'` |

The first two confirm the upgrade path: the DDL this record specifies runs
against a guarded table, and the alternative that would let the column be
`NOT NULL` is genuinely blocked.

**The third is the one worth having.** The `DEFAULT` route is not impossible —
it works, and it fills historical rows. So this record rejects it on judgment
rather than on mechanism, and the probe shows exactly what that judgment is
protecting against: an append-only audit row now carrying a reason no operator
ever supplied, reading `fabricated`. Stating it as "impossible" would have been
wrong and would have collapsed the moment anyone tried it.

That distinction matters for how the decision survives review. A reviewer who
finds a rejected option is actually available treats the rejection as uninformed;
a reviewer who finds it available _and rejected for a stated reason_ has
something to agree or disagree with.
