# LIVE queries and shared operation definitions in v3

Research and delivery proposal, 2026-10-22. Runtime changes are not implemented.
The separate PostgreSQL experiment below ran successfully. QUESTPIE v3 remains
the production target; v4 is a source of useful contracts, not a prerequisite.

**Target confirmed by the owner:** maintain one product operation/tool set for
both API callers and agents: identical input, structured result, errors and
product access rules. The authenticated actor may be Human or Agent; actor type
and provenance arrive through verified context. They do not select a second
implementation or a second transport-specific business contract.

**Recommendation:** use one operation contract behind the existing route registry,
with mechanically derived HTTP/MCP carriers. For reads that promise bounded query counts,
add a planned projection path early: row policies, field decisions, relations
and aggregates belong to one bounded execution plan. Ordinary handler-based
queries remain compatible, but cannot promise to prevent arbitrary per-row I/O.
Use the existing executor/CRUD machinery; do not import the v4 compiler wholesale.

The owner's follow-up specifically requires eliminating duplicated commands and
making accidental relation/access N+1 difficult by construction. That makes the
small planned-read module part of the first delivery, not a deferred optimization.
See [why custom MCP tools exist](./autopilot-mcp-findings.md) and
[query/access do’s and don’ts](./query-guidelines.md).

## What the three designs establish

[A: route-centric](./route-centric-research.md) evolves the authoring model already
used in v3. The small public surface hides validation, transaction ownership,
fresh context and watch scheduling. Its strongest advantage is locality:
OpenAPI/MCP already consume these definitions. Its limitation is that arbitrary
JavaScript does not expose a complete dependency graph automatically.

[B: declarative graph](./declarative-design.md) makes the projection itself a
typed relational plan. That gives execution room to batch related lookups,
lower authorized aggregates and check structural dependencies. It also creates
an AST, planner and type system alongside existing CRUD. A 40-row task summary
is a good experiment for this design. Deliver a bounded subset early for the
strict projection path, with proof of SQL and policy parity. A full relational
language and optimizer are separate work; batch relations, authorized aggregates
and policy expressions over existing CRUD are the first required capabilities.

[C: operation catalog](./operation-catalog-design.md) makes execute/watch
independent of URLs and keeps ordinary CRUD handlers. This best expresses the
transport-neutral contract and avoids treating an HTTP method as proof that a
handler is read-only. Its extra registry, discovery category and migration
surface are costs without an immediate new consumer: current routes already
project into MCP/OpenAPI. Borrow its execution separation inside design A.

All three independently found the same missing behavior: coherent multi-read
snapshots, dependency and authority refresh for arbitrary derived reads, and
careful transaction ownership. The inspected v4 invalidation matcher remains
collection-based. Rich dependency tokens do not prove differential query
maintenance. Source SHAs and immutable citations are in each design note.

## Proposed authoring contract

Illustrative syntax, **not callable v3 API**:

```ts
export default route()
	.post()
	.query({
		live: { collections: ["tasks", "agentRuns", "actors", "memberships"] },
	})
	.schema(projectWorkInput)
	.outputSchema(projectWorkOutput)
	.access(authenticatedPrincipal)
	.meta({ title: "Project work", mcp: { expose: true } })
	.handler(({ input, services }) => services.projects.readWork(input));

export default route()
	.post()
	.command({ transaction: "handler" })
	.schema(taskTransitionInput)
	.outputSchema(taskTransitionReceipt)
	.access(authenticatedPrincipal)
	.meta({ title: "Transition task", mcp: { expose: true } })
	.handler(({ input, services }) => services.workDomain.transitionTask(input));

await client.routes.projects.work.post(input); // one-shot projection
for await (const state of client.routes.projects.work.post.watch(input, {
	signal,
})) {
	// Replace the displayed projection with the validated authorized snapshot.
}
```

The names above are illustrative. The handler must receive server-resolved
actor/principal/provenance through its context; a tenant ID or actor ID in the
request does not establish access. Product checks run through one shared policy
and executor for both Human and Agent. Actor-specific permissions are evaluated
by that policy, not by duplicate HTTP and MCP handlers.

New semantic definitions require explicit access and output schemas. Keep wire
input distinct from parsed Zod output in the client types. Existing unclassified
routes retain their behavior. Query handlers run read-only; commands cannot be
watched. MCP exposure stays explicit and adds its own scope restrictions.
Derive read-only hints from semantic kind; do not invent idempotency hints.

The strict read variant produces a synchronous declarative plan rather than an
async per-row handler. The planner can therefore collect relation keys and
policy dependencies before issuing SQL. Opaque callback policies require a
batch/evaluation stage or are rejected for this mode; there is no silent slower
fallback. Query count is bounded by plan stages and explicit key chunks, with
SQL/row budgets checked at representative cardinalities. An ordinary route can
still execute arbitrary code and does not receive that guarantee.

For new managed commands, validate output before committing writes and durable
queue intent. The explicit `transaction: "handler"` compatibility mode preserves
existing domain ownership and cannot promise rollback after a post-commit output
error. Autopilot's receipt-race recovery occurs after rollback, and assignment
dispatch occurs after commit; a blanket outer transaction would break those
contracts. Adapt them separately. Actions with external effects deserve a clear
non-transactional contract, but are not needed to ship the first query/command
slice. A proposed `.action()` can be discussed before that use case is migrated;
it would promise neither database rollback of external work nor automatic retry.

## LIVE execution and performance

Start with explicit conservative collection/global dependencies, including
policy resources. A wildcard is suitable for the correctness experiment, not a
production default for a busy SaaS. Later capture CRUD reads through the shared
execution context, including misses, relations, context resolution and access
checks. Opaque SQL, external services and clocks need declared invalidation or
one-shot execution. A query using lease deadlines needs a scheduled refresh even
when no database row changes.

Evaluate each projection in a bounded read-only repeatable-read transaction,
binding helper/service reads to that same database context. Subscribe before the
initial computation; latch changes during it and perform a trailing recompute.
Reuse committed realtime outbox reconciliation, with NOTIFY as a coalescible wake
hint. Ephemeral events cannot be the correctness source for derived persistent
state. Initially send complete replacement snapshots over the shared tab SSE.
No atomicity is promised between independent watches.

Refresh identity and access for each evaluation and bound idle reauthorization.
Clear protected client state on denial. Cancel or discard computations and queued
results from an invalidated authority epoch. Do not promise instantaneous or
linearizable revocation for arbitrary application policies: that stronger
contract requires identifying and fencing every authority writer. Reuse an
existing fence where the domain supplies that contract; fresh callbacks alone
do not close the read/send race. This must be specified and tested before a
production watch is advertised.

Default to no cross-principal result sharing. Bound active watches, concurrent
evaluations, result bytes and buffered state. Coalesce dirty work and serialize
each watch with one trailing rerun. Measure authority SQL separately from data
SQL, scanned rows, recomputations per write burst, connection occupancy, latency
and TypeScript instantiations. Batch domain lookups and aggregates before
introducing a new query compiler or another broker. The realtime throughput
work in PR418 is useful transport plumbing, not proof of projection performance.

## What was actually tried

[The runnable PostgreSQL experiment](./prototype-findings.md) uses actual v3
route execution and CRUD, two collections and two tenants. It pauses the read
between collections while another transaction commits both updates.

- Ordinary execution returned task/run revisions **0/1**; a read-only
  repeatable-read wrapper returned **0/0**.
- Invalid output after ordinary route writes left **1/1** committed; validating
  inside a managed transaction rolled both records back to **0/0**.
- User-mode collection access still filtered the second tenant inside the wrapper.

A second [real-PostgreSQL experiment](./access-batching-experiment.md) measured
10/50/100 roots with identical disclosure across four strategies. At 100 roots,
manual related reads used **102 SQL**; built-in `with` used **4**; per-row SQL
field access used **104**; freshly acquired batched authority facts plus pure
field decisions used **5**. The batched paths stayed at 4/5 statements for all
three cardinalities. All 36 evaluations passed tenant/relation/field disclosure
and SQL-growth assertions. This is one belongs-to edge, not nested-plan or
production latency proof. It also exposes two implicit count queries in the
current relation path; data-only reads are a further separate optimization.

A third [HTTP/MCP adapter experiment](./operation-parity-experiment.md) ran one
JSON route through actual HTTP, Human MCP and Agent workload MCP. All 14 assertion
groups passed: the shared schemas, successful/replayed results, product policy,
input injection rejection and standard actor/workload context behave consistently.
Two known-gap assertions also passed: a thrown conflict is HTTP `409/CONFLICT`
but MCP `internal`, and a custom requester-run extension survives in its extension
bundle but is absent from flat handler arguments. These must be fixed once in the
framework projection/context path before claiming the owner's complete parity
contract. Do not replace duplicated handlers with duplicated error wrappers.
This fixture has an in-memory domain and controlled identity; it does not prove
Autopilot's database receipts, OAuth verification or a production migration.
Its imported-source type check remains incomplete.

This establishes that existing execution machinery can host these semantics;
it does not establish live invalidation, revocation fencing or throughput.
The fixture and [raw result](./prototype-results.json) are research artifacts,
not framework implementation or a production migration.

## Delivery slices and acceptance gates

1. **One contract, several projections.** Migrate one read and one domain command
   to a canonical schema/result/error definition using current route adapters.
   Compare HTTP, typed client and MCP structured results, refusals and actor
   provenance; snapshot OpenAPI from the same output schema. First close the
   reproduced native-error and flat-extension gaps in the shared framework path.
   Choose one canonical
   cancellation acknowledgement for all callers and preserve authenticated run
   provenance in context. Legacy envelopes are temporary migration shims with
   retirement gates, not the target architecture. Prefer deleting custom MCP
   handler files once their operation is projected correctly.
2. **Semantic and planned execution.** Add query/command capabilities,
   explicit transaction ownership and a bounded read plan including access,
   relations and aggregates. Start with row predicates plus evaluation/batch
   policies; check that 10/50/100 roots do not introduce per-row SQL. Add client
   type contracts and promote the
   snapshot/rollback experiment into meaningful framework integration tests.
   Prove invalid output rollback and Autopilot duplicate-receipt recovery.
3. **One derived live route.** Explicit dependencies, full snapshots, shared SSE,
   dirty-generation scheduling, fresh authority and reconnect reset. Force a
   commit during initial read, insert into an empty result, revoke during a
   blocked computation, roll back a mutation and drop a wake. The watch must
   converge without exposing another tenant or old-authority data under its
   documented revocation contract.
4. **Measured Autopilot adoption.** Bound working-runs candidate scans and add
   clock/authority dependencies. Replace its invalidation/refetch plumbing.
   Compare 50/250/1000-user workloads with the existing baseline before enabling
   narrower dependency routing, computation sharing or a declarative graph.

Each slice gets an independent reviewable PR and current-head validation.
The current research draft does not authorize merging an unimplemented API or
quietly changing existing route transaction behavior.
