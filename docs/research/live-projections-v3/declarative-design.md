# Design B: named declarative projections for v3

2026-10-22. **Proposal, not implemented.** Make a typed projection graph the authoring seam; compile snapshot routes, typed clients, OpenAPI and MCP from it. Commands attach to the named projection but retain domain transaction ownership. This differs from route-centric design: the read definition describes data relationships, not a handler. It also differs from an operation catalog: its central abstraction is an executable relational graph.

## Evidence and scope

Sources are pinned: **V3** = `a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b` (`origin/main`, 3.38.0); **V4** = `b181bfeb9dd6f36c27c84f34330e0d0b122534fa`; **AP** = Autopilot `f1467cf83f6f945a8aba4deca4905aa77c4bbf1c`. V4 was read through Git because its checkout is dirty. This worktree started at `82fca046befe9cc487962ebdb49efa46e2d9ff09`; production capability claims use V3, excluding PR418 changes. Parent reports realtime candidate `a40b44a62b276262acb0e3c53fc99afc940a4073`; it was not reviewed here.

**Observed:** v3 already supports route output schemas [1], route-derived MCP tools invoking `executeJsonRoute` [2], and OpenAPI generation [3]. Missing output schemas produce generic object documentation. Therefore “one definition, several transports” partly exists; live derived reads and complete result contracts are the missing leverage.

V3 has bounded `findRows` [4], target-authorized relation aggregates [5], shared refresh computation [6], relation/access-WHERE dependency discovery and transactional change capture [7]. Its snapshot executor accepts collection/global CRUD topics, not arbitrary projection graphs [8]. Codegen categories are plugin-driven [20]. Reuse these modules; do not rebuild transport infrastructure.

V4's support-desk query declares nested team/assignee selection [9]; SQL lowering applies related policies using lateral joins [10]. Its dependency vocabulary is richer, but the inspected runtime matcher compares **collection identity only** [11]. Precise incremental maintenance is a proposal here, not demonstrated v4 capability.

Autopilot already batches status bands and secondary lookups [12], [13]. The eight-request versus one-request timing is a source comment, not a measurement reproduced here. Its assignment route/tool repeat schemas and translation [14], [15], although their shared command already owns invariants [16]. The untracked navigation architecture calls for one read/command/live pattern and plan budgets [18]; treat it as design input, not shipped behavior.

## Proposed interface

Two authoring concepts: `projection(name, definition)` and `.command(name, definition)`. Names and collection references resolve from registered maps. New plugin discovery under `projections/` compiles ordinary v3 route definitions; no parallel hand-maintained route implementation.

The following is **proposed syntax**, not available imports. `Expr<T>` is a typed AST node. `build` constructs `Expr<z.output<Output>>`; it cannot return an asynchronous handler. Structural dependencies must be covered by `depends`; authorization resources contribute their own explicit dependency closure.

```ts
projection<I extends z.ZodType, O extends z.ZodType>(name: string, def: {
	input: I;
	output: O;
	authority: AuthorityResource<z.output<I>>;
	depends: DependencyDeclaration;
	build: (q: TypedGraph, input: InputExpressions<I>, scope: ScopeExpressions)
		=> Expr<z.output<O>>;
	publish: TransportMetadata;
}): NamedProjection<I, O>;
```

Concrete Autopilot example: a bounded root-task summary across tasks, actors and projects, with direct-child progress. This is deliberately a small new read, **not parity with the full branch list**: ancestors, tags, properties and status badges remain migration work.

```ts
const input = z.object({ companyId: z.string(), spaceId: z.string() });
const named = z.object({ id: z.string(), name: z.string() });
const output = z.object({
	rows: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			version: z.number().int(),
			assignee: named.nullable(),
			project: named.nullable(),
			children: z.object({ total: z.number().int(), done: z.number().int() }),
		}),
	),
});

export const taskSummary = projection("tasks.summary", {
	input,
	output,
	authority: taskReadScope, // verifies Company + Space; fresh caller identity
	depends: ({ d }) => [d.tasks, d.actors, d.projects],
	build: (q, input, scope) => {
		const tasks = q.page(q.collections.tasks, {
			where: {
				company: scope.companyId,
				space: scope.spaceId,
				parentTask: null,
				archivedAt: null,
			},
			orderBy: [{ hierarchyPosition: "asc" }, { id: "asc" }],
			first: 40,
		});
		return q.object({
			rows: q.map(tasks.rows, (task) =>
				q.object({
					id: task.id,
					title: task.title,
					version: task.version,
					assignee: q.related(task.assigneeActor, { id: true, name: true }),
					project: q.related(task.project, { id: true, name: true }),
					children: q.aggregate(q.collections.tasks, {
						where: {
							parentTask: task.id,
							company: scope.companyId,
							space: scope.spaceId,
							archivedAt: null,
						},
						total: q.count(),
						done: q.countWhere({ status: "done" }),
					}),
				}),
			),
		});
	},
	publish: { http: "/tasks/summary", mcp: "autopilot.task.summary" },
}).command("assign", {
	input: commandEnvelopeSchema
		.extend({
			taskId: z.string().min(1).max(128),
			expectedVersion: expectedVersionSchema,
			assigneeActorId: z.string().min(1).max(128).nullable(),
		})
		.strict(),
	output: assignmentReceiptSchema,
	errors: workErrors, // one domain-error mapping shared by transports
	execute: ({ input, ctx }) =>
		ctx.services.workDomain.assignTask({
			...input,
			userId: ctx.commandPrincipal,
			requesterRunId: ctx.admittedRequesterRunId,
		}),
	publish: { http: "/tasks/assign", mcp: "autopilot.task.assign" },
});
```

`assignmentReceiptSchema` is declared once for the existing `{ taskId, version, replayed, dispatchOutcome }` receipt. The proposed normalized context derives principal/provenance server-side. Each command authorizes through its domain command on every invocation; transport scopes remain additional restrictions. MCP text formats the validated receipt; existing chain-refusal and assignee explanations [15] require explicit preservation before migrating that tool.

Generated calls: `client.projections.tasks.summary.read(input)`, `.watch(input)`, `.assign(input)`. HTTP/MCP snapshot calls invoke the same graph. OpenAPI describes those snapshot/command schemas; MCP tool calls do not implicitly acquire a persistent subscription. Live clients use the existing realtime carrier with a new named-projection topic.

## Hidden implementation and correctness

**Dependencies:** declarations are a conservative ceiling, verified against AST reads. Runtime observation may narrow point lookups, never erase empty ranges, missing relations, ordering or aggregate dependencies. Opaque authorization callbacks require declared resources; unsupported raw reads refuse live admission. Autopilot running badges need requests, sessions and assignment events as well as runs [13]; inventing a `runs.taskId` dependency would be wrong.

**Authority:** `taskReadScope` must cover actors, bindings, roles, memberships, spaces and subscription facts used by existing scope resolution [17]. Its `grantEpoch` digest identifies evaluated grants; it is not itself a revocation feed. Partition caches by deployment, Company, principal/token, grant epoch, locale/stage, normalized input and plan version. Default sharing stays within one principal. Every collection/relation retains row and field access. A hidden child contributes no count; an unreadable relation becomes null.

Revocation invalidates scope and graph together, fences in-flight output, discards queued frames and clears client data. Check the current authority generation at delivery. Expiration requires a deadline even without writes. Reuse authorization only within an evaluation; cross-refresh reuse requires complete dependency capture and a current generation. Otherwise reauthorize, accepting the cost. No instantaneous revocation guarantee without an ordering/fencing mechanism.

**Consistency:** evaluate authority and all graph reads on one short read-only repeatable-read transaction. Ordinary successive PostgreSQL read-committed statements can see different snapshots [19]. Subscribe before evaluation, retain the existing visibility frontier, and drain changes after it; a watermark alone does not make several reads atomic. Dirty events during computation force another pass. Replace result/dependencies together only after successful validation. Initially emit complete snapshots; no cross-query atomicity promise.

**Commands:** preserve CAS, idempotency and domain transactions. `assignTask` deliberately commits before dispatch [16]; wrapping its whole execution in a new transaction changes behavior. Failed transactions publish no invalidation; post-commit dispatch failure cannot undo assignment. Output validation after that commit cannot claim rollback. A later transaction-owned executor needs a separate domain refactor, not a transport convenience.

## Performance, tradeoffs and delivery

Lower `related` nodes to shared authorized lookups and child counts to grouped SQL. Merge identical nodes across status bands; union keys and batch bounded acquisitions. V3's finite-id `findRows` has projection restrictions [4]; select a supported ordinary read rather than bypassing them. Push down predicates/limits/aggregates only where hooks and field rules preserve semantics [5]; refuse unsupported aggregates. Never compute counts by fetching thousands of rows.

Start with collection-level invalidation, coalescing and compute-once delivery [6], [11]. Later narrow by proven old/new scope keys; unknown keys invalidate broadly. This minimizes duplicate work safely, but is not differential query maintenance. The depth is valuable only if graph planning hides SQL, batching and transport duplication. Costs are AST/type complexity, snapshot connection occupancy and explicit policy manifests; arbitrary JavaScript reads remain easier in current routes.

Delivery slices: (1) graph-to-snapshot route plus schema/client/OpenAPI/MCP reuse; (2) authorized batched lookup/aggregate execution; (3) conservative live admission with snapshot and revocation fencing; (4) measured selective invalidation. Each slice must stand alone; v4 and PR418 are not prerequisites.

**Smallest decisive experiment, proposed only:** one 40-task graph, two Companies, two viewers with different grants, shared assignees and children. Instrument SQL and authority-resolution counts. Reject the design if reads grow per row; target ≤4 data statements per evaluation, separate from measured authority reads. Force an assignment commit between graph stages: accept only a coherent old/new snapshot. Revoke access during a blocked computation: no old-authority frame may publish. Roll back a mutation: no changed result. Insert into an initially empty child range: count must refresh. All transports must return the same validated snapshot and one mutation receipt. No full Autopilot port or performance claim before this evidence.

## Primary references

Links pin inspected source bytes. Reference 18 is untracked local input, SHA-256 `abd7a5c33a84a58c2c960c6b8035062c56ef190fe9438539330bb3e0963220c5`. Read-only inspection; no runtime tests, prototype, commits or external writes.

[1]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/routes/route-builder.ts
[2]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/mcp/src/server/route-tools.ts
[3]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/openapi/src/generator/routes.ts
[4]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/crud-generator.ts
[5]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/shared/relation-aggregate.ts
[6]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts
[7]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/service.ts
[8]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/snapshot.ts
[9]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/fixtures/team-support-desk/src/tickets/queries.ts
[10]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/compiler/src/relational/postgres/selection.ts
[11]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/live-query/dependency-plan.ts
[12]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/routes/tasks/list-status-bands.ts
[13]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/work/task-branch-query.ts
[14]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/routes/tasks/assign.ts
[15]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/task-assign.ts
[16]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/work/task-assignment.ts
[17]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/actor-organization-scope.ts
[18]: /home/drepkovsky/code/autopilot/docs/design/nav-library-explore-2026-10-20/ARCHITECTURE.md
[19]: https://www.postgresql.org/docs/18/transaction-iso.html
[20]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/cli/codegen/index.ts
