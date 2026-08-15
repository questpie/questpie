# BETA-02 replacement implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `dca711f06ca4b3cc58adbc7b2e56799cabd4839a`
- Invocation: fresh, stateless, no tools
- Verdict: `PASS`

## Raw findings

```text
VERDICT: PASS

I reviewed `dca711f0` against issue #289, ADR-0002/0006/0008/0021/0022, `docs/v4/schema-lifecycle.md`, `docs/v4/data-model-and-query-grammar.md`, and `docs/v4/implementation-gates.md` (Gates 0, 1, 2, 3, 4, 4A, 8C, 9, 10).

## What I verified

**Artifacts and identity.** Physical-name derivation matches the accepted algorithm (`oauth2Clients`/`apiURL`/`urlValue` casing rules, `__` Collection joins, `_` Field joins, 63-byte hash suffix, `qp_pk/uq/ck/fk/ix` prefixes). Relation-namespace collisions are reserved globally for tables, PK/unique constraints, and authored Indexes, while check/FK names are reserved per table — this matches PostgreSQL's actual namespaces. Reserved and malformed schema names, and unknown `postgres.physicalNames` keys, fail closed with the registered codes.

**Migration lifecycle.** The six-file contract, checksum domain, Genesis base, linear sequence allocation, `stalePlan` re-derivation, exact-digest destructive acknowledgement, rename mapping (never inferred, one-to-one, child rename cascades emitted explicitly), and step ordering (kind rank plus replacement dependency edges) all follow §5–§6. `up.sql` goldens are frozen, contain no `CONCURRENTLY`/RLS, and the semantic-rename case correctly renders zero statements while still producing a receipt.

**Apply protocol.** Session-affinity double probe, bootstrap-then-application lock order, per-migration transaction with in-transaction fingerprint plus receipt, post-commit re-verification, partial-failure reporting with applied/failed/remaining and exit 4 vs 5, and `alreadyApplied` on response loss are all present and covered by real PostgreSQL tests. Backend-PID pinning around every transaction boundary and cooperative cancellation via `pg_cancel_backend` are correct, and the abort/lock-timeout tests prove no DDL or receipt survives.

**Fingerprint independence.** The catalog reader now derives state from `pg_catalog` in one repeatable-read snapshot without consulting the desired Projection, and closes the previously reported false negatives: FK actions/MATCH/column-specific SET NULL, external-namespace FK targets, `INCLUDE`/`NULLS NOT DISTINCT`/invalid backing indexes, replica identity, inheritance and partition parentage in both directions, overloaded routine identity with `prokind`, and PG18 `conenforced`/`conperiod`/named NOT NULL constraints. The 16/17/18 matrix is genuine conformance evidence rather than a provider matrix, and `minimumMajor` is projected from configuration rather than a constant.

**Seeds.** Immutable three-file artifact, canonical scalar codecs (including rejection of `Date`), tagged open JSON distinct from SQL `NULL`, iterative canonical writer surviving 20,000-deep values with cycle and negative-zero rejection, lone-surrogate rejection in keys and values, RFC 8785 UTF-16 key order without array-index hoisting, cardinality and conflict diagnostics, attempt-event sequencing (`started`/`succeeded`/`failed`/`interrupted`/`alreadyApplied`/`blocked`), and the application-lock share with migration apply are all correct and tested against PostgreSQL.

**API and TypeScript.** `relation.toOne({ target: <Definition> })` plus two-argument `relationRef(collection, relation)` now match the accepted contract exactly; inverse `toMany` reaches only the Data Contract Projection and provably leaves Schema Projection bytes unchanged. Explicit `nullable`, exact option objects, segment-tuple paths (never dotted strings), embedded `value.*` isolation, and tagged `TaggedJsonValue` are enforced in both types and the compiler. The `constraint.check<typeof fields>` supersession is recorded in ADR-0008, the workbench audit, and the public page, with the correct claim that artifact bytes and migrations are unaffected. No ORM identity, broad `string`, `any`, or ambient registry enters public declarations; the check builder's Proxy never crosses the structural-evaluation boundary.

**Hostile matrix and budgets.** All seven named hostile cases plus the added binding, Genesis, snapshot-concurrency, and closed-catalog cases have executable evidence. Budgets (changed loop 2690 ms ≤ 5000, plan create 6.85 ms ≤ 1000, golden bytes pinned at 25528) pass with a recorded baseline manifest.

## Non-blocking observations

1. **Dead production code.** `schema/postgres/expected-fingerprint.ts` exports `postgresIdentifierQuoter`, `expectedConstraintDefinition`, `expectedIndexDefinition` and the private `renderFingerprintExpression` they depend on; `schema/postgres-catalog.ts` exports `physicalType` and `expectedDefault`. Nothing imports them now that comparison is AST-based. Roughly 150 lines of superseded definition-string rendering that a future reader could mistake for the live comparison path — delete or justify.

2. **Empty-Collection application versus Genesis.** `expectedComparable` derives `applicationSchemaExists` from `collections.length > 0`, so an application that legitimately drops every Collection would compare as schema-absent. This faithfully implements `schema-lifecycle.md` §6 (which defines the empty-collections projection as Genesis and requires schema absence), and your own planner test already exercises the empty applied head, so the contract, not the code, carries the ambiguity. Worth a one-line note in the workbench before a later slice hits it.

3. **Authored check grammar is narrower than the artifact grammar.** Only `greaterThan` over two compatible ordered Fields is authorable, while `CheckExpressionV1` and the renderer support the full closed union (the extra operators are reachable only through generated bound invariants). This is forward-compatible and inside Gate 0's smallest-surface rule, but `apps/docs/.../schema-lifecycle.mdx` does not state the limit, so an author discovers it only as a missing method.

4. **JSON-backed Seed values have no PostgreSQL evidence.** `field.object`/`array`/`json` Seed values are proven at the artifact layer only; `executeSeedStep`'s `JSON.stringify` → `jsonb` parameter binding is never exercised against a live database because the collaboration fixture has no JSON Fields. Cheap to close with one probe collection in `beta02-migration-restart`.

5. **Slice ownership of quality tooling.** `scripts/code-architecture.ts`, `quality/code-architecture.json`, the `quality:full` wiring, and the CI 16/17/18 matrix are repository-foundation concerns owned by ticket #22. They are small, documented in the router skill, and the matrix is a direct repair from the first BLOCKED round, but they widen BETA-02 beyond its stated artifacts.

6. **Minor hygiene.** `compareAscii` sorts UTF-16 code units, not ASCII, and is now load-bearing for RFC 8785 ordering — the name understates the contract. `schema/projection.ts:schemaError` and `schema/postgres/shared.ts:fail` are the same helper under two names. `.oxfmtrc` now ignores `**/seeds/**` globally rather than the artifact directory specifically.

7. **Demoability.** The issue's "CLI explain goldens" are delivered as explanation producers plus snapshots. If no `questpie` binary is wired yet, "independently demoable through its stated fixture" currently means "demoable through the test suite"; confirm the CLI entrypoint lands with its owning issue.
```
