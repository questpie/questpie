# BETA-02 replacement implementation review 3

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `391138c062e3f8591d13013b7bdd8e2b2881bf0e`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

````text
VERDICT: BLOCKED

## Blockers

### B1 — Three migration renderer branches have no frozen golden bytes; two are never executed at all

`packages/compiler/src/schema/migration-renderer.ts`

`docs/v4/schema-lifecycle.md` §5/§6 is explicit: "Golden vectors freeze every branch's SQL bytes, quoting, statement order, and step separator" and "This order plus the v1 renderer golden vectors is the complete SQL byte authority." The issue budget repeats it as "migration golden bytes stable."

Coverage in this head:

- Frozen via the committed fixture `up.sql`: `createApplicationSchema`, `createCollection`, `addConstraint`, `addRelation`, `addIndex`.
- Frozen via `tests/unit/beta02-migration-plan.test.ts` snapshots: `renameCollection`, `renameField`, `renameConstraint`, `renameIndex`, `dropCollection`, `dropField`, `dropConstraint`, `dropRelation`, `dropIndex`.
- **`addField`** — executed once on live PostgreSQL (`cancellation_probe`, `partial_probe`) but never byte-frozen.
- **`alterField`** — never rendered anywhere. `tests/unit/beta02-migration-classification.test.ts` produces `alterField` *plan steps* but never calls `createCommittedMigration`, so no SQL is ever generated, and no PostgreSQL test reaches it.
- **`renameRelationConstraint`** — never rendered. The rename tests use a companies-only projection with no relations, and the collaboration rename test renames a Field.

`alterField` is reachable from ordinary authorable evolutions (add a literal default, drop/change a default, required↔nullable with backfill, `integer`→`bigint`, numeric precision/scale), so this is live product SQL with zero verification. It also contains hand-rolled string surgery (`renderPostgresDefault(literal).slice(8)`) and a `USING` cast built by splitting on `" COLLATE "`.

That branch additionally has a defect: it decides "the storage type changed" from the **semantic** `FieldTypeV1`, which embeds `minLength`/`maxLength`/`minimum`/`maximum`:

```ts
if (canonicalBytes(baseField.type) !== canonicalBytes(field.type))
  statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ...`);
```

A change that alters a text/integer/bigint bound *and* a default in the same migration therefore emits a spurious `ALTER COLUMN … TYPE` against an unchanged physical type, forcing an unnecessary rewrite. Bounds are lowered to check Constraints, not to the column type; the comparison must be against `PostgreSqlFieldTypeV1` (the physical projection), not the semantic type. The pure-bounds case is saved only incidentally, because `classifyValidatorBounds` returns `effect: "none"`.

Required repair: add frozen golden vectors for `addField`, `alterField` (each ordered statement group in the accepted sequence: drop default, type change, set default, literal backfill, nullability) and `renameRelationConstraint`; execute at least the `alterField` and `renameRelationConstraint` paths against PostgreSQL 17 with a post-apply fingerprint assertion; and compare physical types rather than semantic types when deciding whether to emit the type statement.

### B2 — An Accepted public authoring API was narrowed and the Accepted authority document was edited in place, with no ADR revision or supersession record

`docs/v4/schema-lifecycle.md`, `apps/docs/content/docs/v4/schema-lifecycle.mdx`, `packages/questpie/src/check-expression.ts`

The diff rewrites the accepted authoring example from

```ts
validWindow: constraint.check(({ fields }) => fields.endsAt.greaterThan(fields.startsAt)),
```

to a hoisted `appointmentFields` const plus `constraint.check<typeof appointmentFields>(...)`. That is a permanent public ergonomics decision — every author writing a check Constraint must now restructure the Definition and pass an explicit type argument — made inside an implementation ticket by editing an ADR-0006-accepted document.

The repository's own rule (`docs/v4/data-model-and-query-grammar.md` §2) is that no agent silently changes an API already accepted by ADR-0006/ADR-0007/that workbench, and that a change records the superseded API, compatibility effect, artifact-byte effect, and migration effect. ADR-0022 is the standing precedent that authoring-spelling/ergonomics decisions of this class are ADR-owned (`defineKind` vs `define.*`). Nothing here records the supersession.

I accept that the original example is not inferable as written — `constraint.check` is constructed before `defineCollection` sees the sibling fields — so the correction itself is defensible. The defect is that it is unrecorded.

Required repair: record the change as authority (ADR revision or an explicit supersession-audit entry naming the superseded signature, the compatibility effect, and the unchanged artifact bytes), or preserve the accepted call shape through a mechanism that keeps inference (for example a constraints callback receiving already-inferred fields), and project the outcome into the public docs.

### B3 — `nullable` is silently optional on every `field.*` constructor, contradicting the accepted contract

`packages/questpie/src/index.ts`, `fixtures/collaboration/src/*.ts`

The accepted Field table in `docs/v4/schema-lifecycle.md` §2 lists `nullable` as a **required** option for every column constructor, and every documented example — including the unchanged public MDX projection — passes it explicitly. The implementation defaults it:

```ts
const { nullable = false, default: defaultValue = null, postgres, ...scalarOptions } = options;
```

and the fixtures now author `field.uuid()`, `field.text({ maxLength: 120 })`. An author who omits `nullable` silently gets `NOT NULL` instead of a diagnostic, and the resulting Schema Projection, migration classification, and generated `insert`/`row` types all follow that implicit choice. Note that `value.*` correctly keeps `nullable` required, so the two grammars now disagree with each other as well as with the docs.

Required repair: either require `nullable` on `field.*` to match accepted authority, or record the relaxation as a public API change in the authority document and its projection (and reconcile it with `value.*`).

## Non-blocking observations

- Seed values for `field.object`/`field.array`/`field.json` are never exercised against live PostgreSQL. `tests/unit/beta02-json-fields.test.ts` only asserts artifact bytes; the PostgreSQL JSONB rows in `beta02-migration-restart.test.ts` are inserted with raw SQL. The `JSON.stringify(value.value)` → `jsonb` parameter binding in `packages/compiler/src/seed/postgres/apply.ts` is unproven.
- `classifyNumericStorage` returns `safe` for a precision widening, but `destructiveDeltaSteps` hardcodes `scansData: true, rewritesTable: true, reversibleWithoutData: false` for every `alterField` step. A `safe` step that claims a table rewrite is contradictory operational metadata.
- Genesis classifies `addConstraint` on a brand-new empty table as `guarded` while `addIndex` on the same new table is `safe`. This is why the collaboration Genesis plan is `guarded` rather than `safe`. Conservative, but internally inconsistent.
- `fieldRemainder` in `migration-classification.ts` allowlists by omission: any future Schema Projection Field member that is not explicitly stripped falls into the blocked bucket. That fails closed, which is right, but it will produce an opaque `blocked` rather than a named diagnostic when the projection grows.
- `expected-fingerprint.ts` implements `and`/`or`/`not`/`isNull`/`isNotNull` renderings that are unreachable from the current authoring surface and untested. Their parenthesization is unlikely to match `pg_get_constraintdef` deparse if the check grammar is later widened.
- `projectDataRelations` does not reject two inverse `toMany` members pointing at the same owning `toOne`. Harmless today; worth a diagnostic before the Query vertical consumes the Data Contract.
- `.oxfmtrc.json` adds a bare `**/seeds/**` ignore. It is intended for committed Seed artifacts but will also silently exclude any future source directory named `seeds`; scoping it to `**/questpie/seeds/**` would be tighter.
- `HANDOFF.md` in this head still records the #301 verification state and does not carry BETA-02 evidence. Expected if HANDOFF is updated on acceptance, but worth confirming before merge.
````
