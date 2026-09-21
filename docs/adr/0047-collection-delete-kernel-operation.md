# ADR-0047: Collection `delete` kernel operation

- Status: Proposed
- Date: 2026-09-21
- Owners: compiler, runtime
- Ticket: named-Mutation `ctx.data.<collection>.delete(...)` gap (Autopilot R1
  reference app; `taskRelation.removeBlocks` had to be modelled as a soft
  delete because no delete path existed)

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
Operation Set `delete` member has compiler-side *type* and *codec*
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
`create`/`update` is bounded reads against a *candidate* that does not exist
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
member) does not explain *why* the member is hidden — it reads as an
ordinary TypeScript "property does not exist" error. This ADR asks the
implementer to attach a dedicated diagnostic (grant-missing vs.
mapping-missing) analogous to `QP-COMPOSE-027`'s `missingIssueMapping`
rather than leaving the misleading default; sized as a follow-on to whichever
phase lands the type-visibility gate.

## Proposed phasing

1. **Compiler metadata** — `kernel.ts` gains a `delete` member
   (`kernelProgram(collection, policy, "delete")`, `keyFields` = primary key,
   no caller/trusted value fields, `outputCardinality: "optionalOne"`);
   `operation-write-resource.ts` widens its create/update filter to also
   materialize `delete` (its codec branch already exists at line 145).
2. **Runtime execution** — new `postgres-delete-program.ts` (compiler) +
   `deletePlan` (runtime linker, `postgres-program.ts`), wired into
   `collection.ts` member dispatch and `adapter-execution.ts`, with the
   FK-violation issue mapping and CAS/`expected` predicate.
3. **Proof** — unit tests mirroring `tests/unit/adr0030-compiler-provenance.test.ts`
   / `beta06-runtime-postgres-operation-program.test.ts` /
   `beta06-runtime-collection-operations.test.ts`; a PostgreSQL integration
   test (Collaboration fixture) for: success, Policy-denied neutrality,
   not-found, FK-refused, concurrent delete+update race, Live Query
   convergence, MCP/HTTP projection unchanged.
4. **Type-visibility diagnostic fix.**

Phase 1 has no runtime effect (nothing consumes a `delete` kernel program
yet) and is safe to land alone; phases 2–4 are one connected unit of work
and should not be split further, per ADR-0031's trusted-execution-parity
requirement (no partial delete path that "looks" wired but isn't gated by
Policy/lifecycle/issue-mapping the same way create/update are).

## Consequences

- Until phase 2 ships, `ctx.data.<collection>.delete` does not exist; the
  Autopilot R1 gap (`taskRelation.removeBlocks` soft-delete workaround)
  remains necessary.
- No Accepted ADR is contradicted; ADR-0030's Deferred list already named
  this gap. This ADR narrows "the complete get/list/create/update/delete
  replacement" to just the `delete` member for named Mutations, leaving
  generated Operation Set `delete`/`list` execution itself out of scope
  (they were never wired either, and nothing in the R1 report asked for
  them).

## Deferred decisions

- `afterWrite` for delete (cascading side-effect kernel writes).
- Generated Operation Set `delete`/`list` execution (unblocked by this ADR's
  phase 2 artifacts but not required by it).
- Bulk/filtered delete (`deleteMany`) — this ADR is key-addressed single-row
  only, matching `update`.
