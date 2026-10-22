# Route queries and LIVE projections

The owner accepted this direction on 2026-10-22 after three independent designs
and an Opus adversarial comparison. This records the delivery contract and the
explicitly deferred work below; the new methods are not available in QUESTPIE
3.39.0.

## One operation definition

Keep `route()` and its existing registry. HTTP, the typed client, OpenAPI and MCP
derive from the same input, output, public errors, product policy and executor.
Verified Human or Agent identity and credential restrictions arrive through
context; neither selects another business handler. There is no new operation
registry, codegen category or MCP-to-HTTP loopback.

There is one logical operation catalog for every actor. Authentication adapters
verify credentials and produce context; product policy decides what that actor
may do. A delegated credential can further narrow that authority to a run,
tenant or capability, for any actor type. Such grants never widen product
access. The framework must not select business handlers, schemas or built-in
product permissions through human/agent branches. Catalog filtering follows
exposure, product-independent credential eligibility and declared policy.
Different credential entry points do not require duplicate operation definitions.

Add one semantic capability:

```ts
export default route()
	.post()
	.schema(workInput)
	.outputSchema(workOutput)
	.access(({ input, principal }) => mayReadWork(principal, input))
	.query({
		live: {
			data: ({ companyId }) => ({ tasks: { company: companyId } }),
			authority: ({ companyId }) => ({ memberships: { company: companyId } }),
			maxAgeMs: 30_000,
		},
	})
	.meta({ mcp: { expose: true, name: "work.read" } })
	.handler(({ input, collections }) => readWork(input, collections));

await client.routes.work.post(input);
for await (const state of client.routes.work.post.watch(input, { signal })) {
	// Replace the displayed authorized projection.
}

queries.routes.work.post.query(input, { realtime: true });
```

Names in the example are illustrative. A tenant argument narrows a query; it
does not establish authority. Query definitions require input/output schemas
and explicit access. Access receives parsed input and real path parameters.
MCP discovery checks exposure and credential eligibility; invocation evaluates
product access in the shared executor. Query semantics determine the read-only
annotation. Client wire input and parsed handler input retain their distinct
Zod types; neither transformations nor output validation run twice.

A delegated handoff verifies credential eligibility and input before it invokes
execution. Product access is evaluated once at execution, inside the appropriate
query snapshot or domain operation. A handoff that asks for approval can therefore
approve a request that product policy later denies. Approval is not authorization;
keeping the policy at execution avoids treating a pre-approval verdict as current
permission or holding a database transaction while approval is pending. This is an
intentional tradeoff for opaque delegation and approval integrations.

Ordinary routes retain their behavior and transaction ownership. Do not add a
managed `.command()` in this release. Autopilot recovers concurrent receipts
after rollback and dispatches assignment after commit; an outer transaction
would change those contracts. Its shared domain executor remains authoritative.

## Consistent reads with efficient CRUD

Each query evaluation uses one bounded read-only repeatable-read transaction.
Database-backed context facts, access, handler reads and output validation use
that transaction. Scoped services are fresh for the evaluation. No omitted
context silently grants system authority. Invalid server output is a server
error; a database write in a query is rejected.

Improve the existing CRUD path rather than adding a second planner:

- Bounded relation hydration uses batched target reads without a target count.
- To-many `with.limit` applies per parent, after target access, in one batched
  target query for the page's parents. Many-to-many still reads junction rows
  separately; very large link sets need later parameter and plan optimization.
- `batchRead` evaluates field decisions once per batch; row visibility remains
  a SQL access predicate applied before pagination, totals and cursors.
- Caller relation filters apply target read access. Trusted server policy
  predicates remain distinct, so enforcing caller visibility cannot recurse
  through or weaken the policy that grants access.

Access rules may depend on the operation input. Do not memoize a permission
verdict merely by collection, or reuse it across evaluations or principals.
An evaluation-scoped service may acquire shared authority facts once.

Batch per-row database work explicitly. This release does not reject CRUD I/O
from field rules, output hooks or `afterRead`; a deterministic row-phase guard
is deferred. Arbitrary handler JavaScript cannot receive a universal no-N+1
guarantee. Cardinality tests at 10/50/100 roots assert batch policy statement
growth; PostgreSQL plans and returned/scanned work remain follow-up measurements.
A production statement cap is not an optimizer and is not part of this interface.

## LIVE execution

Only explicitly declared `.query({ live })` routes are watchable. The query
factory owns `{ realtime }`; a live arm is never invalidated or patched through
`setQueryData`. HTTP-only exposure remains possible, including Autopilot's
Library opening read. MCP content reads still follow its `library.pull` policy.

Use the existing shared SSE topology and snapshot scheduling. Resolve declared
data and authority dependencies before initial computation. They include
authority read by the app context resolver, empty result ranges and missing
relations. Equality anchors reduce unrelated tenant wakes; they never grant
access. Uncaptured data dependencies reject watch admission. Clock and lease
dependencies require a bounded refresh age.

The durable outbox and reconciliation are the source of convergence. NOTIFY
is a coalescible wake hint. An initial read subscribes before computing and
latches changes into one trailing recomputation. Rollbacks produce no durable
change. Reconnect recomputes and replaces state. No new broker is needed.

Each evaluation refreshes identity and authority. An authority event observed
during computation invalidates its result before publication. Denial ends that
logical watch and clears protected client data. Other logical subscriptions
remain usable. There is no permission cache or cross-principal result sharing.

Revocation is bounded by the next drained authority event or configured maximum
age, including session expiry and authority outside change capture. This does
not promise linearizable revocation. A stronger fence would have to cover every
authority writer, not just rows in the realtime log. Measure the stale delivery
window before deciding whether that additional mechanism is needed.

Route snapshots use the same typed wire representation as one-shot reads, so
values such as dates keep their type on the same cache key. Bound active watches,
evaluation concurrency and duration, returned bytes and queued replacement
snapshots. Pool occupancy and work per routed write are follow-up measurements;
they do not block the usable API minor. Watch count alone is not a capacity result.

## Public contracts and budgets

The owner accepted a minor release with explicit compatibility exceptions on
2026-10-23. Keep the catalog ceiling and the new MCP error/schema envelopes;
publish their migration notes with the release. This is not a claim that every
existing call remains compatible. Authorization and transaction-lifetime fixes
remain part of the release.

The release notes must explain these upgrades:

- Keep the final catalog below 100,000 UTF-8 bytes and target 85,000 bytes.
- Read route product errors from canonical JSON text and `questpie/error`
  metadata; do not expect error `structuredContent` or internal diagnostics.
- Use each advertised input/output schema, including `{ input }` and `{ value }`
  wrappers where present, and represent Date input as an explicit JSON wire schema.
- Expect functional product access at invocation, even when a tool is listed.
- Follow the HTTP error and relation-read migration notes for changed public
  errors, authorized relation predicates and per-parent child bounds.

HTTP and MCP use one safe public error shape. Explicit product errors preserve
their code and permitted details. Production responses omit causes, stacks,
database constraint values and internal database context. Input validation and
server output validation are distinct failures. Verified context extensions
cannot replace reserved framework identity or service arguments.

The complete final Human MCP catalog must stay below 100,000 UTF-8 bytes;
Autopilot targets 85,000 bytes. Measure actual projected schemas and metadata,
fail explicitly on overflow, and identify large contributors. Do not silently
drop tools or output schemas. Consolidated operations retain one canonical
schema, including action discriminants, for every carrier.

## Required proof

- HTTP, Human MCP and Agent MCP agree on success, receipt replay, conflicts,
  denials, invalid input and verified provenance; unknown errors disclose no
  server details.
- Hidden relation predicates disclose neither values nor counts; trusted policy
  predicates and explicit system reads retain their intended behavior.
- Two parents each receive their own top-K authorized children.
- A commit between two reads produces one coherent snapshot. Query writes fail;
  existing command receipt recovery and post-commit behavior remain intact.
- Commit during bootstrap, insertion into an empty result, rollback, missed
  NOTIFY, reconnect, session expiry and revocation during computation converge
  without another principal's data or publication from an invalidated epoch.
- One-shot and LIVE results agree, including typed values. A write burst is
  coalesced.

## Deferred work

These were design proposals, not capabilities of this release:

- `_countWhere` for conditional authorized child counts in the grouped aggregate
  path, including row and field access proof.
- `_ancestors` as one bounded recursive query with cycle/depth handling and no
  disclosure beyond an unreadable ancestor, including its authorization proof.
- A row-phase CRUD I/O guard and broader removal of relation count queries.
- Production PostgreSQL plan, pool and load studies, reporting data SQL,
  authority SQL, statement growth, scanned work, compute count, stale-delivery
  windows and latency separately. These run after the usable API minor and
  inform subsequent tuning patches; no capacity claim follows from this RFC.

Autopilot adoption follows its coordinated chat, read and catalog changes by
merge, never rebase. Its FE-1 clause changes in the same commit as route-LIVE
usage. Existing product policy and delivery gates still apply.
