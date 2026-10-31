# Design C: a transport-neutral operation catalog for v3

Research and proposal, 2026-10-22. **Recommendation:** register TypeScript query/command handlers independently of routes. Execute and watch are separate entry points; HTTP, typed clients, OpenAPI and MCP are adapters over the catalog. This creates a deep module: validation, authorization and execution concentrate at one seam; handlers retain CRUD.

## Evidence and scope

Pinned sources: v3 `origin/main` **a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b**; assigned worktree `t3/0410df6b` at **82fca046befe9cc487962ebdb49efa46e2d9ff09**; v4 `whol945/product-foundation` **b181bfeb9dd6f36c27c84f34330e0d0b122534fa**; Autopilot **f1467cf83f6f945a8aba4deca4905aa77c4bbf1c**. v4 has dirty files: its evidence below comes from `git show HEAD:<path>`, excluding those edits. Parent reports candidate `a40b44a62b276262acb0e3c53fc99afc940a4073`; it was not reviewed here. No dependency on unmerged PR418.

Read AGENTS.md, CLAUDE.md and CONTRIBUTING.md; applied research and codebase-design. No delegation, runtime changes or tests. Autopilot's requested navigation design is untracked evidence, not part of its SHA: `docs/design/nav-library-explore-2026-10-20/ARCHITECTURE.md`, SHA-256 `abd7a5c33a84a58c2c960c6b8035062c56ef190fe9438539330bb3e0963220c5`. Its §§6.0–6.4 describe PLAIN-only route reads, declared invalidation lanes and denied-state clearing; these are application design requirements, not framework guarantees.

**Observed v3:** JSON route execution already parses input/output and propagates request context, but standalone execution defaults to system access [1]. OpenAPI derives route schemas [2]; MCP can invoke JSON routes through that executor [3]; client route types preserve inferred output [4]. The catalog is therefore a new execution seam, not a reason to rebuild every adapter.

**Observed v4:** a normal query handler calls structural reads [5]; watch evaluation invokes the prepared query through root execution [6]. Its observation algebra includes misses, ranges, policy evidence and tenant partitions [7]. However, the inspected matching implementation conservatively matches collection identities [8]: token vocabulary alone does not prove fine-grained invalidation. HTTP documentation and MCP schemas derive from operation contracts [9,10]. Borrow these separations, not the compiler/runtime wholesale.

**Observed Autopilot:** Project detail reads projects, spaces, actors, sessions, runs and credential-related services [11]. Task transition's HTTP and MCP wrappers repeat schema/error work but intentionally differ in cancellation acknowledgement and principal resolution [12,13]. Those differences must survive migration.

## Proposed interface and examples

The following is illustrative, unimplemented code. Two constructors; no projection DSL. Discovery adds an `operations/` category using existing plugin declarations [14]. Stable operation IDs are independent of URLs. Mandatory output schemas provide a real wire contract rather than trying to extract runtime JSON Schema from TypeScript.

```ts
query({ name, input, output, handler, watch?, describe? });
command({ name, input, output, handler, transaction?, describe? });

app.execute<K extends OperationKey>(
  key: K, input: Input<K>, authority: InvocationAuthority,
): Promise<Output<K>>;
app.watch<K extends WatchableQueryKey>(
  key: K, input: Input<K>, authority: RefreshableAuthority,
): AsyncIterable<Snapshot<Output<K>>>;
```

`InvocationAuthority` is server-resolved identity/context, never client body data. Commands cannot be watched. `transaction` defaults to managed; `"handler"` lets an existing transactional domain retain ownership.

Concrete proposed Autopilot read, using actual collection/field names and bounded CRUD. It is a new summary contract, not a claim to reproduce all of Project detail [11]. `requireReadableProject` is a proposed extraction of its authorization into an application helper; it must preserve human/agent policy and bind `access` to the evaluation's database transaction.

```ts
export const projectWork = query({
	name: "projects.work",
	input: z.object({ projectId: z.string() }).strict(),
	output: projectWorkSchema, // declared once: project, openCount, tasks[]
	watch: { dependencies: "capture" },
	handler: async ({ input, ctx }) => {
		const { project, access } = await requireReadableProject(
			ctx,
			input.projectId,
		);
		const where = {
			company: project.company,
			space: project.space,
			project: project.id,
			archivedAt: null,
		};
		const [page, openCount] = await Promise.all([
			ctx.collections.tasks.find(
				{
					where,
					orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
					limit: 20,
				},
				access,
			),
			ctx.collections.tasks.count(
				{
					where: { ...where, status: { notIn: ["done", "cancelled"] } },
				},
				access,
			),
		]);
		const ids = [
			...new Set(
				page.docs.flatMap((t) => (t.assigneeActor ? [t.assigneeActor] : [])),
			),
		];
		const actors = ids.length
			? await ctx.collections.actors.find(
					{
						where: { company: project.company, id: { in: ids } },
						limit: ids.length,
					},
					access,
				)
			: { docs: [] };
		return shapeProjectWork(project, page.docs, actors.docs, openCount);
	},
});
```

`shapeProjectWork` is a pure application formatter. Counting and displayed rows remain separate facts. This avoids per-task actor queries; the helper must enforce task/actor disclosure as well as project access.

One proposed command delegates the actual state machine to existing domain code:

```ts
export const transitionTask = command({
	name: "tasks.transition",
	input: transitionInput,
	output: transitionReceipt,
	transaction: "handler",
	handler: ({ input, ctx }) =>
		ctx.services.workDomain.transitionTask({
			...input,
			userId: ctx.commandPrincipal,
			requesterRunId: ctx.requesterRunId,
		}),
});

http.expose(transitionTask, { method: "POST", path: "/tasks/transition" });
mcp.expose(transitionTask, {
	name: "autopilot.task.transition",
	scope: taskWrite,
});
await client.operations.tasks.transition.execute(input);
await app.execute("tasks.transition", input, authority);
```

These bindings refer to one definition; they do not redefine handlers or schemas. HTTP bindings feed OpenAPI. The query similarly gets `.execute()` and `.watch()` on the client; MCP calls execute only. Existing incompatible input shapes require explicit compatibility adapters: MCP's impact hash normalization remains visible, while domain execution and error classification move into the operation. Do not expose system-only operations automatically. Derive MCP read-only hints from kind; idempotency hints require an actual receipt contract.

## Hidden implementation and hard tradeoffs

**Dependencies:** start with explicit conservative collection/global declarations; the example's `"capture"` is the next slice. Capture at CRUD execution through ALS, including nested services, relations and access/context reads—not merely wrappers around `ctx.collections`. v3 exposes the app collection objects directly [15]. Record attempted reads before results: an empty task page must still react to inserts. Replace dependencies atomically after successful reevaluation; keep old plus provisional dependencies during evaluation. Raw SQL/external reads need explicit dependencies or are one-shot only. Time-dependent reads require scheduled refresh; capture cannot infer time. Broad collection capture is safe but expensive; row/predicate inference comes only after missed-insert/order-change proofs.

**ACL and isolation:** reconstruct session, principal, organization scope and policy on every evaluation and before delivery; never reuse a captured permission list. v3 has a fresh-adapter-context hook [16], but operation watch needs a transport-neutral authority refresher. Authentication expiry and membership revocation must invalidate even without business-row changes. Partition caches by operation/version, normalized input, principal, tenant, locale, stage and authority generation; start with no cross-principal sharing. A denial clears the live result and terminates; an unavailable authority provider emits no old result. Tenant filters optimize routing, never authorize it. System access in application helpers remains explicit, tightly scoped and audited.

**Snapshots/invalidation:** one evaluation needs a short read-only repeatable-read transaction across authorization and all CRUD/service reads. Existing watermark capture before a collection read does not establish that multi-read snapshot [17]. Register invalidation before evaluating, latch changes during evaluation and rerun before claiming freshness; this must account for already-running transactions, reconnects and missed hints. Reuse durable realtime log/reconciliation, not ephemeral channels. Existing backend invalidation hints are content-free/coalescible [18]; they are a conservative wake source, not proof of dependency-specific changes. Emit full replacement snapshots first; opaque watch revisions are not database transaction IDs. No cross-operation atomicity promise.

**Rollback/effects:** managed commands validate output inside their transaction, commit CRUD plus durable queue intent, then deliver results. v3 already reuses ambient transactions and delays after-commit callbacks [19]. After-commit callbacks are not a durable outbox. Preserve Autopilot's receipt-before-preflight ordering and transactional audit/receipt logic [20]; wrapping it blindly could change replay/concurrency behavior. With `transaction: "handler"`, post-commit output failure is explicitly a committed-but-unavailable result, never a rollback claim. Never automatically retry an unknown-outcome command. Defer a distinct action kind until external-effect identity/cancellation semantics are required.

**Performance:** coalesce dirty watches, serialize reevaluations with a trailing rerun, cap active watches/result bytes/concurrency and disconnect slow consumers. Reuse transport multiplexing; do not allocate one polling timer per watch. Measure SQL count, fanout and retained state. Full snapshots favor implementation depth over incremental patch complexity; broad invalidation and repeatable-read connection occupancy are the principal costs.

## Delivery and decisive experiment

1. Add catalog execute plus HTTP/MCP adapters for one operation; prove identical normalized result/error and authorized principal across transports. Keep routes/raw webhooks intact. No watch yet.
2. Add one explicit-dependency watch with replacement snapshots and fresh authority; prove rollback, reconnect, revocation and tenant isolation before widening adoption.
3. Add dynamic CRUD capture, then optimize only measured fanout. Keep explicit declarations for opaque reads.

The smallest decisive experiment is `projects.work` plus `tasks.transition`, two tenants and two actors, using the existing Postgres fixture. Parent implements it later. Pause evaluation between count/page reads, concurrently commit a task update, and assert a coherent snapshot followed by the new snapshot. Insert into an initially empty result; revoke membership during an in-flight read; roll back a transition after its audit write; retry a committed command; reconnect after a missed hint. Fail the proposal if any stale authorized payload crosses revocation, tenant B changes tenant A's visible data, rollback emits committed state, or the three adapters require another business handler. Record baseline/changed SQL counts and reruns for a 100-write burst; no performance claim is established by this note.

## Primary citations

Tracked links pin revisions; untracked evidence is identified separately.

1. [v3 route execution](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/routes/execute.ts)
2. [v3 route OpenAPI](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/openapi/src/generator/routes.ts)
3. [v3 route MCP](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/mcp/src/server/route-tools.ts)
4. [v3 typed client](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/client/index.ts)
5. [v4 query handler](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/fixtures/collaboration/src/consumer.ts)
6. [v4 shared query/watch execution](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/application/index.ts)
7. [v4 observation algebra](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/live-query/program.ts)
8. [v4 actual dependency matcher](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/live-query/dependency-plan.ts)
9. [v4 HTTP/OpenAPI projection](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/compiler/src/http/operation-projection.ts)
10. [v4 MCP projection](https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/compiler/src/mcp/index.ts)
11. [Autopilot Project detail](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/routes/projects/detail.ts)
12. [Autopilot HTTP transition](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/routes/tasks/transition.ts)
13. [Autopilot MCP transition](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/task-transition.ts)
14. [v3 plugin categories](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/cli/codegen/index.ts)
15. [v3 context/service extraction](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/config/app-context.ts)
16. [v3 fresh context](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/adapters/utils/context.ts)
17. [v3 snapshots/watermarks](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/snapshot.ts)
18. [v3 invalidation and durable log](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/service.ts)
19. [v3 transactions](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/shared/transaction.ts)
20. [Autopilot command executor](https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/organization/command-context.ts)
