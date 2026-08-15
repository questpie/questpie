# BETA-04 initial implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `33662605105d7a80ade94d430dbf3f838964ff69`
- Reviewed head: `f2c1f7be06deaf6ebca9e934c64be0a290034172`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

````text
VERDICT: BLOCKED

## Blocking findings

### B1. The compiled page statement cannot use the index this slice's migration adds, and materializes the full authorized set before the caller filter, order, and limit

`packages/compiler/src/relational/postgres/index.ts` emits:

```sql
WITH "qp_authorized" AS MATERIALIZED (
  SELECT "qp_row".* FROM "collaboration"."messages" AS "qp_row" WHERE <policy exists chain>
), "qp_page" AS MATERIALIZED (
  SELECT ... FROM "qp_authorized" AS "qp_row"
  WHERE ("qp_row"."channel_id" = $5::uuid) AND <seek>
  ORDER BY pg_catalog.date_trunc('milliseconds', "qp_row"."created_at") DESC NULLS LAST, "qp_row"."id" DESC NULLS LAST
  LIMIT ($9::integer + 1)
) ...
```

(exact text pinned in `tests/unit/__snapshots__/beta04-postgres-query-lowering.test.ts.snap`).

Two independent properties make the new index dead:

- `channel_id` is not part of `qp_authorized`'s predicate, and `AS MATERIALIZED` forces PostgreSQL to fully evaluate that CTE. The caller filter, order, cursor boundary and `LIMIT first + 1` all run over an already-materialized result set, so `qp_ix_messages_page` (`fixtures/collaboration/src/messages.ts`, `.../000002_authorize-message-pages/up.sql`) can never be reached.
- `fieldValueSql` in `packages/compiler/src/relational/postgres/model.ts` wraps every timestamp in `pg_catalog.date_trunc('milliseconds', ...)`, including projection, `ORDER BY` and the seek predicate. The committed index is on the raw `created_at` column, and the foundational Index surface is B-tree-only with no expression indexes, so no declarable index can serve this ordering.

Net effect: rows *returned* are bounded by `first + 1`, but rows *scanned and materialized* are unbounded in the number of Policy-visible Messages across all channels. The fixture boundary in `docs/v4/implementation/beta04/design-context.md` names a "stable Message page Index" as an explicit deliverable, and QUEUE.json budgets "bounded rows and first+1"; neither is supported by the emitted plan.

Required evidence or repair: either (a) supply real `EXPLAIN (ANALYZE, BUFFERS)` evidence from `tests/integration/postgres/beta04-policy-query.test.ts` proving an index path and a bounded scan for the compiled statement, or (b) change the lowering so the caller filter and order can reach the base relation (drop `AS MATERIALIZED`, or intersect Policy scope inline rather than through a materialized CTE) and remove or justify the inert index, or (c) remove the index from migration 000002 and state the unindexed scan as an explicit accepted absence. Today the migration commits a destructive-classified `addIndex` step with no proof it is ever used.

### B2. The required PostgreSQL microbenchmark manifest measures a mocked adapter, not PostgreSQL

`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json` names BETA-04's performance evidence as "Policy/Query PostgreSQL microbenchmark manifest". The delivered scenario `quality/performance/beta04-policy-query.json` runs `tests/performance/beta04-policy-query.test.ts`, which constructs an in-memory fake:

```ts
const sql = { async reserve() { return { ... unsafe(statement) { ... return rows; } }; } } as unknown as SQL;
```

The recorded `bindExecute100Ms: 9.269` in `quality/baselines/beta04-policy-query.json` therefore measures only binding, cursor encoding and row decoding. The derived budget (100 ms) is internally consistent with its stated multiplier, but it is structurally incapable of detecting any regression in the compiled SQL — including B1. The acceptance manifest cites CI job 95024347500 as "selected-PR Stable quick microbenchmarks: PASS"; that gate is real but does not measure what the slice claims to own.

Required repair: run the microbenchmark against a real PostgreSQL target (the repo already provisions PG 16/17/18 in the same CI run), record plan-time/exec-time and scanned-row evidence in the manifest, or rename the scenario and its QUEUE evidence entry so it no longer claims PostgreSQL measurement — and add a separate PostgreSQL manifest.

### B3. Accepted authority is amended by the implementation slice without corresponding proof or review evidence

- `docs/v4/context-and-policy.md` is an Accepted contract whose header pins `Authority: ADR-0010 and proof head 5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` and whose "Accepted proof" section states it "passed one fresh focused Opus-medium acceptance review" with a fixed digest table. This diff inserts a new normative section defining `PolicyCursorScopeV1`, its canonical bytes, and the digest domain `questpie-policy-cursor-scope-v1\0`, while leaving the authority line, the proof head, and every digest in the table unchanged. The page now asserts proof coverage it does not have.
- `docs/adr/0008-...md` gains "Revision: Policy-aware cursor scope" and `docs/adr/0010-...md` gains "Revision: default attachment diagnostics" in the same commit that implements and depends on them. The acceptance manifest cites `d03358b7` and `5fbd9058` as the authority heads for those ADRs — heads at which these revisions do not exist. The ADR-0010 revision further asserts QP-POLICY-001/002 are "the accepted P2 proof spellings", which is not verifiable from the supplied packet.
- `docs/v4/prototypes/implementation-collapse-p16/QUEUE.json` flips `BETA-04.agentReady` from `false` to `true` in the same commit as the implementation.

`AGENTS.md` states that Accepted ADRs and public documentation define v4 behavior, and the slice's own `design-context.md` acknowledges "this slice cannot invent those codes" for unregistered diagnostics. Required repair: land the ADR-0008 / ADR-0010 revisions and the `context-and-policy.md` amendment as a separately accepted authority change with its own review record, and update the P2 page's authority head and proof-digest table to cover the new normative content — or cite the existing acceptance record for them.

## Non-blocking observations

1. **Declared-but-unimplemented `ctx.data.run`.** `packages/compiler/src/generate.ts` emits per-query `run(plan, input)` into `GeneratedData`, but nothing in `packages/runtime` supplies it; the integration test builds its own `run` inside `project`. A consumer typechecks and fails at call time. Consistent with the BETA-03 precedent for `renderData`, but worth stating as an explicit absence.

2. **Nested Field paths are derived incorrectly in two generated-contract helpers.** `fieldPath()` in `packages/compiler/src/relational/generated-contract.ts` and `fieldByIdentity()` in `packages/compiler/src/generate.ts` both split the identity tail on `/`, producing `["address", "field:city"]` for `collection:customers/field:address/field:city`. The PostgreSQL lowerer (`rootFieldResult`) compares the schema `path` array correctly, so the two disagree. Latent only because this slice uses flat Fields.

3. **Compile-time 2,048-byte cursor envelope proof is absent.** ADR-0008's revision requires the compiler to reject a template whose maximum envelope cannot fit including `policyScopeDigest`. Only runtime enforcement exists (`packages/runtime/src/relational/cursor.ts`), and an over-long encode raises a bare `TypeError` at execute time rather than a registered diagnostic.

4. **`QP-DATA-007` / `QP-DATA-008` are not enforced as diagnostics.** The unique-suffix check is a raw `throw new Error("QP-DATA no unique cursor constraint")` inside `relationalDiscoverySource`; order-field-selected is enforced only incidentally by `orderTerms()` in the runtime via `TypeError`. Similarly `relationJoin` and `queryFilterSql` throw bare `TypeError`s for unsupported nested output and Relation filters.

5. **Diagnostic classification depends on stderr substring matching.** `packages/compiler/src/discovery.ts` maps child failures by `child.stderr.toString().includes("QP-DATA-005")` etc. Authored source containing those literals can misclassify a failure.

6. **`tests/integration/postgres/beta04-policy-query.test.ts` mutates shared fixture rows without restore-on-failure.** The revocation/role-change test sets `role='member'` then `status='revoked'` and only restores at the end of the test body; a mid-test failure leaves later tests (cursor tamper, cancellation reuse) reading an empty authorized set.

7. **`IS NOT DISTINCT FROM` on non-nullable Policy correlations.** Every evidence correlation in `policyExpressionSql` uses `IS NOT DISTINCT FROM` even where both sides are `NOT NULL`. This is not a btree-indexable operator in PostgreSQL and compounds B1.

8. **`packages/compiler/src/schema/migration-dependencies.ts`** (214 new lines) extends accepted BETA-02 migration planning from within BETA-04. The change is motivated by this slice's membership primary-key replacement and is covered by `beta04-collaboration-schema.test.ts`, and the committed genesis bytes remain byte-identical — but it is ownership drift into a prior slice's module and should be called out in the manifest.
````
