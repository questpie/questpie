# ADR-0047: Collection `delete` kernel operation

- Status: Accepted (owner, 2026-09-22)
- Date: 2026-09-21
- Owners: compiler, runtime
- Ticket: named-Mutation `ctx.data.<collection>.delete(...)` gap (Autopilot R1
  reference app; `taskRelation.removeBlocks` had to be modelled as a soft
  delete because no delete path existed)
- Implementation: built on this branch per the Decision below, except the
  FK/constraint-issue-mapping item explicitly deferred as an Accepted-ADR
  conflict (see "Consequences"). A 2026-09-22 Opus security review (F1-F7)
  found and this branch fixed a real admission-gate bypass (F1/F2: delete
  ran no `validate` and bypassed issue-mapping coverage regardless of
  Policy), added proof for transaction-abort (F3), tenancy (F4), Live
  Query subscription convergence, and concurrency at N=50 randomized
  trials per race with observed interleaving. See
  `docs/v4/implementation/collection-delete-kernel.md` for the shared-vs-new
  code split, every gate result, and what remains open (the type-
  visibility diagnostic fix, an operation discriminator in the authored
  lifecycle grammar). Left Proposed, not flipped to Accepted, by
  instruction.

## Context

ADR-0030 gives the generated Collection write kernel two members,
`create` and `update`, addressed through `ctx.data.<collection>` inside a
named Mutation. ADR-0030's Deferred decisions list "the complete
always-generated get/list/create/update/delete replacement" as future work.
ADR-0011 names `delete` as a selectable member of the generated Operation
Set (`packages/compiler/src/mutation/operation-set-contract.ts` already
types `CollectionOperationMember` as `"create" | "delete" | "get" | "list" |
"update"`), and `operation-write-resource.ts` already branches on
`program.member === "get" || program.member === "delete"` when it builds the
`{ key }` input codec for those two members.

This task set out to give the kernel a `delete` member that reuses the
Operation Set delete's existing PostgreSQL statement builder, mirroring how
`kernel.ts` already adapts `create`/`update` from the Operation Set.

**Verified discovery that changes the scope of this decision.** The
Operation Set `delete` member has compiler-side _type_ and _codec_
scaffolding, but no executable statement path exists anywhere in the
codebase:

- `packages/runtime/src/mutation/postgres-program.ts:595` — the plan linker
  accepts only `new Set(["create", "get", "update"])`; any Operation whose
  `member` is `"delete"` (or `"list"`) is rejected with "has no executable
  Collection Operation plan".
- There is no `postgres-delete-program.ts` (compiler or runtime) alongside
  the existing `postgres-create.ts` / `postgres-update-program.ts`.
- `packages/runtime/src/mutation/collection.ts:305,347-349` only ever
  populates `members.create`, `members.update`, `members.get`.
- A repo-wide search for `DELETE FROM` in `packages/compiler/src/mutation/*`
  and `packages/runtime/src/mutation/*` returns nothing.

So "reuse the Operation Set delete's PostgreSQL statement builder" is not
possible today — it does not exist. Building it is not a small adapter, it
is a new peer of the ~3,500 lines of compiled-plan/digest-verified
infrastructure that `create` and `update` already have
(`postgres-create.ts`, `postgres.ts`, `postgres-shared.ts`,
`postgres-update-program.ts`, `collection.ts`, `collection-lifecycle-check.ts`,
`adapter-execution.ts`, plus ~4,300 lines of matching unit tests in
`tests/unit/adr0030-*`, `tests/unit/beta06-*`). One thing is already true
"for free": the change-ledger trigger in
`packages/compiler/src/schema/postgres/internal-protocol-v3.ts` fires on
`TG_OP IN ('UPDATE', 'DELETE')` at the table level, so Live Query
convergence after a delete needs no new trigger — only a delete statement
that actually issues `DELETE FROM <table> WHERE <key> AND <policy filter>`.

Because implementing this safely (trusted-execution parity with
`create`/`update`, digest-verified linker, FK-issue mapping, CAS,
lock-then-validate lifecycle, MCP/HTTP projection, and the full test/gate
suite the task demands) is comparable in size to the `create`+`update`
kernel work that produced ADR-0030/0031 combined, this ADR is filed
**Proposed** rather than implemented in the same pass, so an owner can
confirm the phased sequencing below before the runtime work is built and to
avoid landing a partial, silently-incomplete delete path.

## Decision (proposed)

### API shape

`ctx.data.<collection>.delete({ key, expected? })` inside a named Mutation's
`validate` phase, returning `Row | null`. This mirrors `update`'s existing
`{ key, expected?, patch }` shape minus `patch`: `key` addresses the row via
the Collection's primary key (`primaryKeyFields`, already computed in
`kernel.ts`), `expected` carries the same optional CAS/expected-version
fields `update` already supports. `null` is the same neutral
not-found-or-denied result `update` already returns for a missing or
Policy-rejected row — never a distinguishable authorization error, for the
same anti-enumeration reason ADR-0030/0031 give `update`.

### Lifecycle phases (ADR-0031)

Only `validate` applies for v1. `validate` receives the locked current row
(read under `FOR UPDATE`, the same `keyedRowLock` step `get`/`update` already
perform) and no candidate — there is nothing to normalize, so `normalize`
does not apply. `check` and `afterWrite` are explicitly deferred (not
"invented new phases", simply not wired yet): `check`'s role in
`create`/`update` is bounded reads against a _candidate_ that does not exist
for delete, and `afterWrite` would receive a written row that, for a delete,
does not exist post-commit. A future ADR may add `afterWrite` for
delete-triggered cascading kernel writes once the base path ships; it is out
of scope here.

### Policy

`delete` is evaluated through the same relational Policy machinery as
`create`/`update`'s `candidatePolicy`/`candidatePolicyCheck` steps — no
second authorization path. Concretely this is a `DELETE FROM <table> WHERE
<key predicate> AND <policy filter> RETURNING *` in one statement (the same
"authorized-or-absent" idiom `postgres-update-program.ts` uses), so a
Policy-denied delete and a not-found delete are indistinguishable at the SQL
layer and both return zero rows / `null` — neutral by construction, not by a
separate check-then-report step.

### Relations / FK

The DB's own declared `ON DELETE` action decides cascade behavior — this ADR
adds no new cascade declaration surface. If the schema declares `ON DELETE
CASCADE`/`SET NULL` for a referencing Collection, PostgreSQL performs it. If
no cascade is declared and another row still references the deleted row, the
`DELETE` raises `23503` (`foreign_key_violation`); the delete statement must
catch that SQLSTATE and map it to a typed, declared Collection issue (e.g.
`referencedByOtherRows`) through the same issue-mapping seam ADR-0031 uses
for `create`/`update` constraint violations — never a raw PostgreSQL error
crossing into the Mutation. Inverse relations (ADR-0032) are unaffected:
they are read projections over live rows and already stop reflecting a row
once it is gone.

### Generated types

`delete` becomes visible on `ctx.data.<collection>` under the same two gates
`update` already has: (1) the Mutation's declared write capability/Policy
grants `delete` on that Collection, and (2) the Mutation's `issueMappings`
cover every reachable Collection issue delete can raise (today: the FK
issue). This task also surfaced that the existing "member does not exist on
ctx.data.<collection>" diagnostic (when a capability/mapping gate hides a
member) does not explain _why_ the member is hidden — it reads as an
ordinary TypeScript "property does not exist" error. This ADR asks the
implementer to attach a dedicated diagnostic (grant-missing vs.
mapping-missing) analogous to `QP-COMPOSE-027`'s `missingIssueMapping`
rather than leaving the misleading default; sized as a follow-on to whichever
phase lands the type-visibility gate.

## Phasing (built on this branch)

1. **Compiler metadata** — `kernel.ts` gained a `delete` member
   (`kernelProgram(collection, policy, "delete")`, `keyFields` = primary key,
   no caller/trusted value fields, `outputCardinality: "optionalOne"`).
   `operation-write-resource.ts` was left unchanged: it materializes the
   _Operation Set's_ network-exposed create/update Mutations, a separate,
   still-unbuilt feature this ADR does not extend to delete (see
   Deferred decisions).
2. **Runtime execution** — `packages/compiler/src/mutation/postgres-delete.ts`
   (SQL plan builder) + `packages/runtime/src/mutation/postgres-delete-program.ts`
   (digest-verified linker) + `packages/runtime/src/mutation/collection-delete.ts`
   (executor), wired into `collection.ts` member dispatch. No FK-violation
   issue mapping and no CAS/`expected` predicate were added — see
   Consequences for why.
3. **Proof** — `tests/unit/adr0047-collection-delete-kernel.test.ts` and
   `tests/integration/postgres/adr0047-collection-delete-kernel.test.ts`
   cover success, Policy-denied neutrality, not-found, and FK-refused.
   Concurrent delete+update race and Live Query subscription convergence
   were not covered by a dedicated test (see the implementation doc).
4. **Type-visibility diagnostic fix** — not done; the misleading
   "property does not exist" diagnostic is unchanged (documented as a
   known follow-up in the implementation doc, not silently dropped).

## Consequences

- `ctx.data.<collection>.delete` now exists wherever a Collection's
  default Policy declares `operations.delete`; the Autopilot R1 gap
  (`taskRelation.removeBlocks` soft-delete workaround) can be revisited.
- No Accepted ADR is contradicted by the parts that shipped. ADR-0030's
  Deferred list already named this gap. This ADR narrows "the complete
  get/list/create/update/delete replacement" to just the `delete` member
  for named Mutations, leaving generated Operation Set `delete`/`list`
  execution itself out of scope (they were never wired either, and
  nothing in the R1 report asked for them).
- One part of the original brief was **not** implemented because it would
  have contradicted an Accepted ADR: mapping a `23503` foreign-key
  violation to a typed, declared Collection issue. ADR-0031 states
  "PostgreSQL constraints are not Collection issues," and ADR-0030 lists a
  typed `ConstraintViolation` under its own Deferred decisions — inventing
  one for delete only, without the same treatment for create/update's
  existing (equally unmapped) constraint violations, would have been an
  inconsistent, un-ratified special case. A `23503` on delete surfaces as
  the same sanitized failure any other constraint violation already does.
- **F3 — an FK-refused delete is a normal outcome, not an edge case, for
  any Collection left at the default `onDelete: "restrict"`, and it dooms
  the whole enclosing Mutation transaction.** Savepoints are
  `"notAvailable"` (ADR-0011), so a `23503` mid-Mutation rolls back
  everything the Mutation wrote so far and makes every later `ctx.data`
  call in that same Mutation fail too — proven by
  `tests/integration/postgres/adr0047-f3-transaction-abort.test.ts`.
  **Authoring guidance:** a Mutation that deletes a row with dependents
  should check for them first — a `Query`/`list` read over the
  referencing Collection before calling `.delete` — inside the same
  Mutation, rather than relying on the FK violation as a control-flow
  signal; the violation is an un-typed, sanitized failure, not a
  recoverable declared error.
- **F4 — Policy-only authorization holds under a realistic tenant-scoped
  delete Policy**, not just the reference fixture's boolean-flag Policy:
  cross-tenant delete-by-key returns neutral `null`, leaves the row in
  place, and records no change-ledger fact for it, proven by
  `tests/integration/postgres/adr0047-f4-tenancy.test.ts`. One asymmetry
  is intentional and matches `update`, not a delete-specific regression:
  the `lock` statement (`SELECT ... FOR UPDATE`) carries only the key
  predicate, no Policy predicate — any authenticated caller can take a
  `FOR UPDATE` lock on any row by primary key for the duration of the
  transaction, the same as `update`'s lock already does. The Policy check
  only gates the `currentValidation` read and the final `DELETE`.
- **F5 — delete then create with the same key resets write-once Fields
  and creation provenance.** `packages/compiler/src/schema/postgres/
internal-protocol-v3.ts`'s database-owned-value trigger pattern
  (`IF TG_OP = 'INSERT' THEN NEW.created_at := transaction_timestamp()
ELSE NEW.created_at := OLD.created_at END IF`) only carries a
  create-time value forward across an `UPDATE`; a fresh `INSERT` after a
  `DELETE` has no `OLD` row, so `created_at` and any other
  `immutable`/server-owned creation-time Field gets a brand new value —
  the new row is not recognized as "the same logical entity" across the
  delete+recreate boundary. A Collection that needs a stronger identity
  guarantee across that boundary (a truly immutable creation timestamp,
  an audit trail that must not restart) **should not grant `delete`** on
  its default Policy. See the separate Proposed ADR-0048 (database-level
  append-only Collections), which forbids delete entirely for Collections
  that opt in — that is the mechanism for Collections needing this
  guarantee, not a delete-side workaround. Concretely, after the two
  branches were integrated (2026-09-22): `defineCollection({ appendOnly:
true })` makes `projectCollectionMutationKernels`
  (`packages/compiler/src/mutation/kernel.ts`) refuse to emit this ADR's
  `delete` kernel for that Collection at compose time — a Policy declaring
  a `delete` operation on an append-only Collection is the same
  `QP-COMPOSE-013 structuralTypeError` diagnostic ADR-0048 already uses for
  the `update` kernel and for an authored Operation Set `delete` member
  (`packages/compiler/src/mutation/operation-set.ts`). `compileApplication`
  throws before any delete-capable SQL is generated; there is no runtime
  fallback path. See
  `tests/unit/adr0047-adr0048-delete-append-only-refusal.test.ts` and
  `tests/integration/postgres/adr0047-adr0048-delete-append-only-refusal.test.ts`.

## Deferred decisions

- `afterWrite`/`check` for delete (cascading side-effect kernel writes;
  `validate` is the only phase interpreted for delete — see F1/F2 above).
- A true "operation" discriminator in the authored lifecycle grammar, so a
  shared `validate` can branch explicitly on create/update/delete instead
  of relying on authors writing `current`-only checks and an
  unconditional `candidate.*` read failing safe (dooming the transaction)
  rather than being rejected at compile time.
- Generated Operation Set `delete`/`list` execution (unblocked by this
  ADR's runtime-execution artifacts but not required by it).
- Typed `ConstraintViolation` issue mapping (would need its own ADR
  extending ADR-0030/0031's Deferred item for all three write members, not
  a delete-only carve-out).
- CAS/`expected` on delete.
- Type-visibility diagnostic fix (the misleading "property does not
  exist" TypeScript error when `.delete` is hidden by the issue-mapping
  gate).

Resolved since the first pass (see
`docs/v4/implementation/collection-delete-kernel.md` for full detail):
Live Query subscription convergence is proven end to end
(`tests/integration/postgres/adr0047-live-query-delete.test.ts`), and
concurrency is proven at N=50 randomized trials per race with
`pg_stat_activity`-observed interleaving and reported win distributions
(`tests/integration/postgres/adr0047-concurrent-delete.test.ts`).

- Bulk/filtered delete (`deleteMany`) — this ADR is key-addressed single-row
  only, matching `update`.
