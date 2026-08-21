# ContextBootstrap static PostgreSQL projection

- Status: selected design; prototype implementation only, with no production
  implementation or public-surface authority
- Re-derived against: `feat/v4-beta-12` at
  `fd9a07ee025353377b8b47d2f6e24879f4cc35bf`
- Scope: replace Runtime-authored ContextBootstrap SQL with compiler-owned
  static statements executed through `PostgresDatabase`
- Public surface: unchanged `ContextBootstrap.get(Collection, { key, select })`

## Boundary

Accepted Context Resolution receives only Principal, decoded input, and a
bounded read-only exact-key bootstrap lookup with explicit selection. It cannot
expose raw SQL, a database, writes, Services, Queue, or System Authority
(`docs/adr/0010-freeze-trusted-context-and-relational-policy.md:25`-`:34`;
`CONTEXT.md:370`-`:380`). This design changes the private PostgreSQL realization
of that lookup. It does not change Policy, make Context an authorization cache,
add a database escape hatch, or widen the currently executable bootstrap codec
and top-level Field set.

The present adapter projects Schema at Runtime, constructs a `SELECT` from the
runtime `lookup.select` keys, and sends that text through Bun SQL
(`packages/runtime/src/relational/bootstrap.ts:334`-`:389`). It validates and
decodes the returned row only after that helper has completed its transaction
(`:390`-`:408`). Generated application code constructs this adapter from the
embedded Schema Projection and the generated Bun SQL owner
(`packages/compiler/src/runtime/application.ts:292`-`:301`). The useful public
job is correct, but SQL ownership and decoding sit on the wrong side of the
PB-05 PostgreSQL seam.

PB-05 still has one indivisible ownership rule: the generated application must
eventually construct exactly one `RuntimePostgres`, and every ordinary database
phase must share its one bounded Pool. This slice must not add a `pg` Pool next
to the Bun SQL Pool. It may add compiler artifacts, linkers, and compatibility
callers while generated production construction remains on Bun; the ownership
flip happens once after Context, Query, Mutation, realtime, Durable, and
readiness callers can all use the one module
(`generated-runtime-operational-profile.md:9`-`:17`, `:124`-`:135`).

## Selected statement shape

The compiler lowers one static statement per eligible Collection. Primary-key
parameters come first. Every currently selectable top-level scalar Field then
owns one boolean selection parameter and a paired selected/value result:

```sql
SELECT
  $4::pg_catalog.boolean AS "qp_selected_0",
  CASE
    WHEN $4::pg_catalog.boolean THEN "role"
    ELSE NULL::pg_catalog.text
  END AS "qp_value_0",
  $5::pg_catalog.boolean AS "qp_selected_1",
  CASE
    WHEN $5::pg_catalog.boolean THEN "status"
    ELSE NULL::pg_catalog.text
  END AS "qp_value_1"
FROM "collaboration"."memberships"
WHERE "company_id" = $1::pg_catalog.uuid
  AND "principal_id" = $2::pg_catalog.uuid
  AND "scope_key" = $3::pg_catalog.text
LIMIT 1
```

The exact aliases, order, casts, identifiers, and complete SQL bytes belong to
the compiler artifact. Runtime never quotes an identifier, interpolates a
selected Field, reconstructs this template, or accepts authored SQL.

For an unselected Field, the PostgreSQL driver receives the strict pair
`false, null`; the stored value does not cross the PostgreSQL-to-Runtime
boundary. For a selected Field it receives `true, value`, including
`true, null` for a selected nullable Field. The boolean makes selected-null and
unselected distinguishable while the statement decoder is still inside the
transaction.

This is a disclosure-boundary guarantee, not a physical-storage claim.
PostgreSQL may access the containing row tuple while evaluating the fixed
statement. QUESTPIE guarantees that an unselected value is not returned to the
driver or placed in the decoded bootstrap result. If a later requirement says
that static SQL must not even reference an unselected column, this design is
overturned in favor of the per-Field alternative below.

The compiler must reject a plan that exceeds PostgreSQL's parameter or target
list bounds before emitting it. The prototype preserves the adapter's current
top-level codec boundary: UUID, binary Text, Boolean, Integer, and Timestamp
are executable; nested and unsupported Fields remain rejected. The current
boundary is visible in the private codec projection and rejection
(`packages/runtime/src/relational/bootstrap.ts:8`-`:22`, `:106`-`:125`,
`:302`-`:311`). Supporting further scalar or nested shapes is a separate
contract, not a side effect of the driver migration.

## Compiler artifact

The compiler emits mandatory `postgres-context-bootstrap-plans.json`:

```ts
type PostgresContextBootstrapPlansV1 = Readonly<{
	format: "questpie.postgres-context-bootstrap-plans";
	version: 1;
	digest: string;
	plans: readonly PostgresContextBootstrapPlanV1[];
}>;

type PostgresContextBootstrapPlanV1 = Readonly<{
	format: "questpie.postgres-context-bootstrap-plan";
	version: 1;
	digest: string;
	collection: string;
	sql: string;
	key: readonly Readonly<{
		field: string;
		key: string;
		codec: BootstrapScalarCodecV1;
		nullable: false;
		postgresType: string;
		position: number;
	}>[];
	fields: readonly Readonly<{
		field: string;
		key: string;
		codec: BootstrapScalarCodecV1;
		nullable: boolean;
		selectionPosition: number;
		selectedColumn: string;
		valueColumn: string;
	}>[];
}>;
```

Plans are unique and sorted by Collection identity. Key descriptors preserve
the exact primary-key order. Field descriptors are unique and sorted by
logical key. Field identity, logical key, codec, nullability, PostgreSQL type,
and physical SQL must agree with the compiler's Schema Projection. The
compiler emits the artifact for all Collections at build time because the
Context resolver is executable application code and may choose a Collection or
selection through ordinary control flow.

Artifact creation belongs beside the other generated compiler artifacts. The
current compiler already owns `schema-projection.json` and the generated
artifact inventory (`packages/compiler/src/artifacts.ts:388`-`:408`) and lowers
static PostgreSQL Query and Collection-operation plans before constructing the
Runtime Build (`:421`-`:471`, `:510`-`:525`). ContextBootstrap follows that
pattern; it does not become a Runtime SQL generator.

Use semantic digest domains
`questpie-postgres-context-bootstrap-plan-v1` and
`questpie-postgres-context-bootstrap-plans-v1`. The generated server bundle
embeds the expected envelope digest. The Runtime Build gains the explicit
`postgresContextBootstrapPlansDigest` beside
`postgresQueryPlansDigest`; the latter currently lives at
`packages/compiler/src/runtime/index.ts:441`-`:446`. Ordinary Runtime Build
inventory verification already rejects missing, surplus, or byte-changed files
(`packages/runtime/src/application/artifact-files.ts:10`-`:27`); the new field
also receives semantic verification. The embedded expected digest prevents a
forged but internally self-consistent replacement from silently becoming SQL
authority.

## Runtime linker and execution contract

The private linker is:

```ts
linkPostgresContextBootstrapPlans({
  artifact,
  schemaProjection,
  expectedDigest,
}): LinkedPostgresContextBootstrapPlans
```

It returns immutable plans plus `get(collectionIdentity)`. Each linked plan
contains its verified metadata and one
`PostgresStatement<BootstrapLookup, BootstrapRow | null>`. This mirrors the
existing Query linker, which validates artifact identities, placeholders, and
result aliases before creating a branded static statement
(`packages/runtime/src/relational/postgres-database.ts:45`-`:129`,
`:132`-`:181`).

The Context linker additionally cross-checks every Collection, primary-key
Field, selected Field, codec, nullability, physical name, cast, placeholder,
and result alias against the embedded compiler Schema Projection. It validates
the expected semantic digest; it does not derive SQL from that Schema. A
missing, surplus, duplicate, unsupported, or reordered plan is terminal during
Runtime readiness, before Context Resolution.

`PostgresStatement.parameters` validates the exact primary-key object, requires
at least one selected Field, requires every selection value to be `true`,
decodes key values through the pinned codec, and emits one boolean for every
plan Field. `PostgresStatement.decode` owns the complete database result:

- `SELECT` with zero rows becomes `null`;
- exactly one row with the exact `2 * fields.length` width is required for a
  hit;
- every selected marker is a strict boolean;
- `false` requires a paired `null` and omits the Field;
- `true` decodes its paired value through the exact pinned codec and enforces
  nullability;
- the final selected result is frozen before the transaction callback returns.

This ordering is not optional. `PostgresDatabase` invokes a branded
statement's parameter mapper and decoder while the transaction is active
(`packages/runtime/src/postgres/index.ts:231`-`:269`) and only attempts COMMIT
after the transaction callback returns (`:428`-`:444`). ContextBootstrap must
return that already-decoded object. It must not return raw rows or validate
database values after COMMIT.

The execution function is one repeatable-read, read-only transaction through
the shared `PostgresTransactionRunner`, matching the linked Query transaction
shape at `packages/runtime/src/relational/postgres-database.ts:184`-`:194`.
There is no retry in ContextBootstrap. A database failure fails Context before
Policy or a handler, preserving ADR-0010.

## Execution-scoped cancellation

The migration must correct one existing private seam rather than copying it.
The generated adapter currently captures only the application-level
`postgresController.signal`
(`packages/compiler/src/runtime/application.ts:293`-`:301`). During a root,
the execution engine passes the single application bootstrap directly to the
Context resolver and checks its root signal only after resolution
(`packages/runtime/src/execution/index.ts:243`-`:279`). Therefore aborting one
root does not currently cancel its blocked bootstrap statement.

Keep the public `ContextBootstrap` interface unchanged. Change the private
Runtime program seam to an execution-scoped factory:

```ts
type RuntimeContextBootstrapFactory = (signal: AbortSignal) => ContextBootstrap;
```

The root creates one bootstrap view from its own controller signal before it
calls `context.resolve`; the Live Query observation wrapper decorates that
same view. The view passes the signal as `PostgresControl.signal`. The
PostgresDatabase already combines caller, deadline, and shutdown cancellation
at transaction admission (`packages/runtime/src/postgres/index.ts:306`-`:325`)
and owns backend cancellation, rollback, or connection destruction. Do not use
mutable closure state, AsyncLocalStorage, a public signal argument on
`bootstrap.get`, or a Pool per Execution.

Application shutdown remains the database owner's signal and shared close
deadline. Request cancellation remains the root's signal. Both reach the same
ordinary Pool; neither creates a second owner.

## Hostile proof matrix

Every negative instrument first proves a corresponding positive case can be
observed.

| Boundary                  | Required proof                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler determinism      | Compile in normal and reversed discovery order; prove identical artifact bytes and digests, unique sorted plans, exact primary-key order, and a known-positive CASE/flag marker in the real SQL.                                                                                                                                                                                                                 |
| Complete identity set     | Reject a missing plan, surplus valid plan, duplicate Collection, reordered plan, unknown Collection, and a self-consistent forged envelope whose outer digest was recomputed.                                                                                                                                                                                                                                    |
| Schema and codec identity | Reject a missing/reordered/nullable primary-key Field; logical or physical Field mismatch; UUID changed to Text; Timestamp timezone change; changed Text/Integer bounds; unsupported or nested selected Field; and altered PostgreSQL cast. Cross-check against the embedded Schema Projection, not only against another field in the same forged artifact.                                                      |
| SQL linkage               | Reject missing/surplus/gapped placeholders, duplicate placeholders with a missing position, changed selection parameter, duplicate or reordered result aliases, CASE/flag association mismatch, invalid physical identifiers, injected SQL suffixes, empty SQL, and a digest-valid artifact whose SQL differs from the server-embedded expected digest.                                                          |
| Nondisclosure             | Seed a unique sensitive value. With its flag false, prove the raw driver pair is exactly `false, null`, the secret bytes do not occur anywhere in the raw returned row, and the final record omits the Field. First run the known-positive true-flag case and prove the instrument observes the secret. Separately prove selected nullable null remains present.                                                 |
| Result decoding           | Prove zero rows returns null and one row returns the exact frozen selection. Reject non-SELECT, null or inconsistent row count, more than one row, wrong width, non-boolean markers, false with non-null value, true with invalid codec value, and true null for a nonnullable Field.                                                                                                                            |
| Decode before COMMIT      | A logging transaction proves statement decode precedes callback return and COMMIT. Every invalid-result case produces rollback and never COMMIT; no raw row escapes the transaction.                                                                                                                                                                                                                             |
| Cancellation              | A pre-aborted root performs no checkout. A lock-blocked lookup is observed through a known-positive `pg_stat_activity` control, then root abort triggers backend cancellation and rollback or connection destruction; Context and handler do not return, and the Pool is reusable. Abort after statement completion but before COMMIT also rolls back. Application close independently cancels an active lookup. |
| Generated product         | Runtime Build inventory and semantic digest include the artifact; the generated bundle embeds the expected digest; readiness links before resolving Context; generated production contains no schema-driven bootstrap `SELECT`, identifier quoting, raw-row decoder, or second Pool. Use a known-positive old dynamic marker before trusting the absence check.                                                  |
| PostgreSQL bounds         | Compile the largest admitted Collection and execute its lookup on PostgreSQL 17. Reject the first over-bound Collection at compile time; never defer a parameter/target-list failure to application startup.                                                                                                                                                                                                     |

The integration proof must use the real `PostgresDatabase` and PostgreSQL 17.
Fake transaction tests establish exact ordering and hostile decoder behavior;
they do not replace lock, cancellation, rollback, or Pool-reuse evidence.

## Alternatives

### Per-selection-shape statements

This gives the smallest SQL result for each actual selection and the simplest
decoder, but the compiler cannot soundly enumerate the shapes. A Context
resolver is arbitrary bundled TypeScript: it may branch, call a helper, or
compute a selection. Sound enumeration requires either a new public declaration
of allowed bootstrap footprints or a semantic analyzer for executable code.
Neither belongs in this private PB-05 driver migration.

### One statement per Field

An existence probe plus one static statement for every selected Field avoids
even mentioning an unselected column in SQL and can keep all decoding inside
one repeatable-read transaction. It costs one plus the selection size in
database round trips, repeats primary-key work, and makes once-per-root Context
Resolution scale with selected Field count. It is the fallback if the owner
requires the stronger SQL-reference boundary.

### Select every Field, then filter

Rejected. Sensitive values cross into the driver, selected-null becomes easy
to confuse with omitted, and final codec/nullability validation tends to move
after COMMIT. A smaller implementation is not worth weakening the accepted
explicit-selection boundary.

### Runtime SQL lowering

Rejected. Moving quoting and CASE construction into a new Runtime helper would
retain two authorities: compiler Schema meaning and Runtime SQL construction.
The artifact must contain the final statement bytes.

## Sequence and authority

This is the best next tracer before the Mutation and Durable caller migrations
because it is the smallest remaining dynamic SQL authority, executes before
every ordinary operation, handles sensitive selected data, and exercises the
artifact-to-Runtime-Build-to-linker-to-`PostgresStatement` path that later
callers reuse. It is not a dependency that prevents separate Mutation or
Durable prototype work in parallel.

The record authorizes only a focused disposable prototype and hostile proof.
It does not authorize the generated production ownership flip, a public API
change, a new diagnostic registry entry, or promotion of PB-05 timeout values.
Production projection requires the complete one-Pool migration, the operational
measurements in the generated Runtime profile, full repository verification,
and the repository acceptance protocol.

## Overturn conditions

Reopen the selected shape if any of these is demonstrated:

- an accepted requirement forbids even a static SQL reference to an unselected
  column, selecting the per-Field alternative despite its round trips;
- representative Context schemas exceed the CASE plan's proven PostgreSQL
  parameter or target-list bound;
- a sound compiler-owned call-site proof can enumerate every possible
  selection without a public declaration, making per-shape statements smaller
  without losing completeness;
- measured Context Resolution shows the paired projection causes material
  application-tail harm and the per-Field or declared-shape alternative wins
  the same hostile matrix;
- `PostgresStatement` gains an immutable execution-local decode context that
  distinguishes selected-null without paired result markers while preserving
  decode-before-COMMIT; or
- a real application needs a currently unsupported bootstrap codec or nested
  selection, which must first receive its own accepted contract instead of
  silently widening this migration.

Do not overturn the compiler-owned static SQL boundary or the one-Pool rule to
make the migration smaller.
