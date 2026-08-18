# BETA-09: internal protocol v5, the maintenance reason

Specifies the one schema change BETA-09 owns. `maintenance-decisions.md`
decided that every maintenance command carries a bounded reason recorded in the
append-only audit; this record fixes the exact shape, the upgrade mechanics, and
the two edges the schema forces.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state. It writes no production code.

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
4. Release the advisory lock and assert the backend pid, as v4 does.

Three consequences worth stating before the implementing slice hits them:

- **DDL is not blocked by the guards.** Both the kernel guard and the
  append-only guard are DML-scoped — `BEFORE INSERT OR UPDATE OR DELETE`
  (`internal-protocol-v4-sql.ts:290`) and `BEFORE UPDATE OR DELETE OR TRUNCATE`
  (`:302`). `ALTER TABLE ... ADD COLUMN` passes both. No guard needs relaxing,
  and any change that _did_ require relaxing one should be treated as a signal
  that the change is wrong.
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
