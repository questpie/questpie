# Live projections in v3: evolve the route

2026-10-22. Research and proposal A; no runtime changes. Recommendation: keep
`route()` as the authored operation and deepen its execution module. Add three
semantic selectors—query, command, action—with live as a query capability.
Retain v3 discovery, schemas, access, and transport projections. Do not import
v4's compiler, operation catalogue, or structural query language.

## Evidence and scope

Production-baseline evidence is local `origin/main` at
`a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b` (release #417), **not** the
unmerged PR418 line. This isolated branch, `t3/route-centric-live-projections`,
started at `82fca046befe9cc487962ebdb49efa46e2d9ff09`. All V3 references below
pin the production baseline. V4 references pin
`b181bfeb9dd6f36c27c84f34330e0d0b122534fa`, read through `git show` from
`/home/drepkovsky/code/questpie-functional-whol945`; its dirty changes are
excluded. Autopilot references pin `f1467cf83f6f945a8aba4deca4905aa77c4bbf1c`.

The untracked Autopilot design `docs/design/nav-library-explore-2026-10-20/ARCHITECTURE.md`
was read separately: SHA-256
`abd7a5c33a84a58c2c960c6b8035062c56ef190fe9438539330bb3e0963220c5`.
Its §6 specifies route reads as PLAIN, server-declared invalidation lanes,
and reconnect reconciliation; that is a design contract, not implemented
framework capability. Repo AGENTS/CLAUDE/CONTRIBUTING and the requested
research/codebase-design skills were read. Other checkouts remained read-only.

## Observed capabilities versus missing seams

| Existing machinery                                                                                                                                                         | Actual gap                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable route builder: input/output schemas, access, metadata, inferred result. [1]                                                                                      | No query/command distinction or watchability contract.                                                                                  |
| `executeJsonRouteInternal`: validation, context/ALS, access, handler, output validation. Undefined access allows; standalone context defaults to system. [2]               | New semantic operations need explicit context, read snapshots/command transactions, cancellation, and validation before command commit. |
| OpenAPI derives route schemas and metadata. [3]                                                                                                                            | Output schema is optional; GET routes currently receive a request-body description too. Exact transport projection still needs work.    |
| MCP already discovers `.meta({mcp:{expose:true}})` routes and calls `executeJsonRoute`, with MCP scope/workload checks. [4][15]                                            | Reuse it; normalize credentials and refusals rather than creating another handler system.                                               |
| TanStack routes expose `.query()` and `.mutation()`; both call the ordinary route client. [5]                                                                              | No live route arm, semantic capability filtering, or derived-result reducer.                                                            |
| Realtime has transactional outbox capture, invalidation subscription, and resource subscriptions. [6] Scheduler has authority-sensitive grouping and queued refreshes. [7] | These subscriptions target collection/global topics, not arbitrary route results and their dependency sets.                             |
| Managed transactions reuse ambient transactions; after-commit callbacks run only after success. [8]                                                                        | No route-level read-only, consistent multi-read contract; after-commit callbacks are not durable external delivery.                     |

V4 supplies useful semantics: complete-result watch delivery, fresh authorization,
dependency replacement and durable reconciliation, with no atomic publication
across independent watches. [9] Its observer records context, policy, relation,
miss and range tokens, but the current matcher only compares **collection
identity**. Rich tokens do not establish selective invalidation performance.
[10][16] Accepted consistent-snapshot/transaction guarantees [11] must also be
distinguished from execution-path proof; this research did not run that proof.

## Proposed interface

These are proposed additions, not currently callable v3 methods:

```ts
// Illustrative additions to RouteBuilder; existing schema/meta/access remain.
query(options?: {
  live?: { collections: "*" | readonly CollectionKey[] };
}): QueryRouteBuilder;
command(): CommandRouteBuilder;
action(): ActionRouteBuilder;

// Generated capabilities on existing route method leaves:
client.routes.home.workingRuns.post(input);       // same one-shot call
client.routes.home.workingRuns.post.watch(input, { signal }); // AsyncIterable<O>
q.routes.home.workingRuns.post.query(input, { realtime: true });
q.routes.tasks.transition.post.mutation();
```

Selectors are mutually exclusive and unavailable after `.raw()`. Query is a
read-only snapshot; command is one database transaction; action permits
external effects and promises no rollback or automatic retry. Live is available
only on opted-in queries. Existing unclassified routes keep their behavior.
New semantic definitions require explicit access and serializable output schema;
wire input versus parsed Zod output must remain distinct types.

Use the existing route registry and filename/method identity. No second
operation catalogue. OpenAPI, MCP, client types and watch admission consume
that definition; MCP exposure stays explicit. Metadata describes the operation
once. Adapter-specific envelopes remain adapter implementation.

### Autopilot examples

```ts
// home/working-runs.ts — proposed evolution of the current route
export default route()
	.post()
	.query({ live: { collections: "*" } })
	.schema(workingRunsInput)
	.outputSchema(workingRunsOutput)
	.access(admittedPrincipal)
	.meta({ title: "Working runs", mcp: { expose: true } })
	.handler(({ input, collections, organizationScope }) =>
		readWorkingRuns({ ...input, collections, organizationScope }),
	);

// tasks/transition.ts — after the shared domain's transaction adaptation
export default route()
	.post()
	.command()
	.schema(transitionInput)
	.outputSchema(transitionReceipt)
	.access(admittedPrincipal)
	.meta({ title: "Transition task", mcp: { expose: true } })
	.handler(({ input, services, principal }) =>
		services.workDomain.transitionTask({
			...input,
			userId: commandPrincipal(principal),
		}),
	);
```

Helper/schema names above are illustrative. The real working-runs projection
joins runs, requests, actors, spaces, attempts and input requests; helpers add
conversation authority and message-title dependencies. Its candidate scan is
unbounded despite a 20-row output page, and lease state uses `Date.now()`.
[12] Therefore wildcard invalidation is an honest correctness starting point,
not a production performance solution. Time expiry requires scheduled refresh
or persisted state transitions; database changes alone cannot keep it live.

The real HTTP/MCP transition pair repeats statuses, validation and error mapping,
but differs intentionally: MCP takes an acknowledged cancellation hash and derives
the rest, and resolves a connected principal/run. [13] Adopt one canonical
domain input, with thin compatibility adapters during migration. Never erase
those authorization facts or make principal/run identity caller input. Task list
HTTP and MCP also serve different pagination/projection jobs; one definition
does not mean merging every similarly named read.

## Hidden implementation and correctness

**Dependencies.** Start with explicit conservative collection sets, including
authorization dependencies; wildcard covers the first experiment. Later record
CRUD reads under ALS, including context resolution, empty results and branches.
Observation replaces the previous plan only after success. Inference over
arbitrary SQL, clocks or external calls is unsupported. This explicit v3 compromise
does **not** claim v4's compiler-proven closed watchability. [9][10]

**Snapshot and invalidation.** Register before computing; mark dirty generations
during computation and perform a trailing recompute. Execute all projection
reads in one bounded read-only repeatable-read transaction with the same scoped
database, including service/helper reads. Reuse committed outbox reconciliation;
a notice is only a wake hint, and maximum sequence is not a commit frontier.
[6][9] Reconnect produces a fresh authorized reset initially. Send complete
results, not guessed row patches; coalesce and bound buffers.

**Authority and tenancy.** Every recompute refreshes credential/context facts,
then executes the same access/domain/field checks. Never reuse standalone
system defaults. Existing route access has no parsed-input argument, so tenant
authorization must remain in the shared domain or gain a deliberate typed seam.
[2] Partition caches by route/input, principal/session/token, tenant context,
locale and stage; isolate unrepresentable context. Existing grouping code is
useful evidence, not permission for cross-principal sharing. [7] Before delivery,
fence against committed authority changes; refusal clears protected client data
and terminates/resets the binding. Fresh evaluation alone leaves a read/send
race. Identify every revocation writer before claiming bounded revocation.

**Command and action.** Output validation, business writes and durable dispatch
must precede the command commit; rollback exposes neither writes nor an
authoritative update. Do not silently add a framework receipt system over
Autopilot's. Its executor catches unique-receipt races **after rollback** and
then rereads the winner. [14] Wrapping that catch inside a new outer transaction
breaks recovery. Adapt transaction ownership and move recovery outside the
outer rollback before migrating the transition example. Actions remain outside
that transaction; durable jobs/queue own required eventual external work.

## Delivery and falsification

1. **Projection reuse:** one existing JSON route exposed through current MCP,
   HTTP, typed client and OpenAPI; prove input/result/refusal parity. No realtime
   prerequisite and no new catalogue.
2. **Semantic execution:** mutually exclusive selectors, capability types, query
   snapshot and command rollback. Prove two reads cannot mix commits, bad output
   rolls back, and duplicate command recovery remains correct.
3. **Live derived result:** snapshot-only route watch over existing realtime
   transport, dirty-generation scheduling, reset on reconnect, bounded queues
   and revocation fencing. No PR418 dependency or row-delta algorithm.
4. **Autopilot cutover:** bound the working-runs scan, cover clock/authority
   dependencies, replace duplicated refresh plumbing; then narrow dependency
   sets or add observation based on measured fanout.

Suggested tiny falsifiable experiment, **not implemented here**: two tenant-scoped
collections (`tasks`, `runs`), one route returning task status plus active-run
count, and one command updating both. Use one generated client, HTTP/MCP calls
and one live consumer. Barrier the projection between reads while another
transaction commits: only old/old or new/new may appear. Roll back the command:
no changed result. Commit during initial read: trailing refresh must converge.
Revoke membership during delivery: no newly admitted protected frame. Drop the
wake: reconciliation/reset must converge. A second tenant must receive no data.
Failure of any case rejects the slice.

Measure computations per burst/subscriber, query count, scanned rows, payload and
buffer bytes, ledger lag and TypeScript instantiations. Start with isolated
subscribers; wildcard cost grows with unrelated writes. Snapshot replacement is
simple but expensive for large results. No performance or production-readiness
claim is made without those measurements.

Verification here: source/history inspection, immutable-source references and
`git diff --check`; no builds, runtime tests, migrations, commit, push or PR.

## Decisive primary references

All links are immutable repository source, not claims about latest upstream releases.

[1]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/routes/route-builder.ts
[2]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/routes/execute.ts#L155
[3]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/openapi/src/generator/routes.ts#L130
[4]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/mcp/src/server/route-tools.ts#L53
[5]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/tanstack-query/src/index.ts#L1244
[6]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/service.ts#L369
[7]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts#L171
[8]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/shared/transaction.ts#L315
[9]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/docs/adr/0012-freeze-live-query-and-change-ledger.md
[10]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/live-query/dependency-plan.ts
[11]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md
[12]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/home/working-runs.ts
[13]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/mcp-tools/task-transition.ts
[14]: https://github.com/questpie/autopilot/blob/f1467cf83f6f945a8aba4deca4905aa77c4bbf1c/apps/operator-web/src/questpie/server/domain/organization/command-context.ts#L632
[15]: https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/mcp/src/server/catalog.ts#L326
[16]: https://github.com/questpie/questpie/blob/b181bfeb9dd6f36c27c84f34330e0d0b122534fa/packages/runtime/src/live-query/observation.ts
