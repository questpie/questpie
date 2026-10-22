# Query and access rules for bounded projections

Guidance and proposed strict projection contract, 2026-10-22. The current v3
CRUD supports arbitrary callbacks; the stricter planned projection mode below
is a proposal, not an existing guarantee.

**Target:** SQL count grows with the declared plan stages and bounded key chunks,
not one database round trip per output row. One huge SQL statement is not the
goal: it can multiply rows, repeat expensive predicates or scan an unbounded
child relation. Measure queries, rows, buffers, execution time and retained bytes.

## Access belongs in the plan

V3 collection access already returns a `Where` that is merged into the read.
Use that path for representable row visibility, including relation predicates;
the [access compilation tests](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/questpie/test/collection/access-where-compilation.test.ts)
exercise relation-backed access. V3's
[field access evaluation](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/questpie/src/server/collection/crud/shared/access-control.ts)
is per document and accepts async callbacks. An async boolean callback that has
already executed queries is opaque; the framework cannot reliably reconstruct
an equivalent SQL predicate by observing its result.

For strict planned projections, support three explicit policy forms:

- **Row predicate:** compile trusted policy expressions into the root/relation
  SQL with `WHERE`, `EXISTS` or an authorized join. Include tenant and actor facts
  as parameters. Compose policy predicates before limits and aggregates.
- **Evaluation facts:** resolve shared membership/role/context facts once for the
  evaluation, in its context and snapshot, then reuse pure decisions. Cache a
  compiled policy/plan freely; never share a permission verdict across unrelated
  principals or future evaluations.
- **Batch decision:** collect the candidate keys and ask an opaque policy for
  one bounded set of decisions. Apply field redaction before delivery. A policy
  affecting row visibility or counts must participate before pagination/counting,
  not filter an already paginated page and report a misleading total.

No per-row I/O callback fallback in the strict path. A plan that cannot express
the required policy must fail admission or explicitly use the ordinary handler
path without the strict performance guarantee. Do not silently bypass policy to
obtain a faster query. Arbitrary application JavaScript can still create N+1;
the enforceable promise is about the supported projection surface.

## Do

- Bound the root page, nested cardinality, selected fields and result bytes. Use
  a stable tie-breaker in ordering. Explain the worst allowed expansion.
- Declare relations in the read plan, or use existing `.find({ with: ... })`
  rather than issuing a related `findOne` for every row. Current
  [belongs-to](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/questpie/src/server/collection/crud/relation-resolvers/belongs-to.ts)
  and [has-many](https://github.com/questpie/questpie/blob/a40b44a62b276262acb0e3c53fc99afc940a4073/packages/questpie/src/server/collection/crud/relation-resolvers/has-many.ts)
  resolution collect keys and read them in batches.
- Deduplicate sibling relation keys, group compatible lookups by target/policy/
  projection/snapshot, then reconstruct the output. Different authorization
  scopes must not be joined into one unsafe loader cache.
- Use data-only reads when only rows are needed; ask for counts explicitly.
  Relations do not need a pagination count merely to hydrate an assignee.
- Compute authorized counts/aggregates in SQL. Unreadable children must not
  contribute. Preserve target field access and hook semantics; reject an
  unsupported aggregate instead of reading protected stored values directly.
- Plan per-parent top-K with a partitioned/window query or bounded lateral
  strategy. Test the meaning of a nested limit; a global `IN (...) LIMIT K` does
  not mean K children per parent.
- Keep derived formatting and `afterRead` transformations pure. Declare external
  enrichments as batched plan stages rather than hidden database reads.
- Inspect representative query plans and indexes for tenant + join/filter +
  ordering columns. Account for both selectivity and write cost.
- Test 10, 50 and 100 roots with shared and distinct related keys, denied targets,
  nested relations and empty ranges. Record data SQL and access SQL separately.
  Assert the expected plan/chunk budget, not only a latency threshold.
- Reevaluate authority for each live recomputation and record its dependencies.
  A fresh projection snapshot is not by itself a revocation fence.

## Don't

- Do not use `rows.map(async row => findOne(...))`, even inside `Promise.all`,
  as a relation loader. Parallel requests still consume N round trips and can
  queue on the same snapshot connection.
- Do not fetch every row and filter visibility, calculate totals or page in
  JavaScript. It leaks aggregates or breaks pages and wastes work.
- Do not resolve an actor's entire organization graph for every field or row
  when one scoped predicate or evaluation-scoped fact set is sufficient.
- Do not keep request-scoped loader results or access decisions in a process-wide
  cache. Transaction, actor, tenant, locale, stage and projection shape matter.
- Do not use system access to populate relations faster. Relation targets and
  their fields still belong to their own authorization owner.
- Do not promise one SQL query for every projection. A small set of bounded
  batched queries may be cheaper and easier to authorize than a Cartesian join.
- Do not silently fall back from the planned path to arbitrary callback reads.
  Unsupported behavior must be visible to the author and performance tooling.

The [completed PostgreSQL experiment](./access-batching-experiment.md) compares
manual relation fetches, current `with` loading, per-row access SQL and fresh
batched facts. At 100 roots it measured 102, 4, 104 and 5 SQL statements,
respectively, while preserving disclosure across all 36 evaluations. Its scope
is query-growth evidence for one relation and policy, not production throughput
or proof for arbitrary nested projections.
