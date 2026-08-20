# QUESTPIE v4 beta.1 build specification

- Status: candidate implementation authority for atlas #16
- Release: `4.0.0-beta.1`
- Scope source: ADR-0008 through ADR-0024
- Queue source: [`prototypes/implementation-collapse-p16/QUEUE.json`](./prototypes/implementation-collapse-p16/QUEUE.json)

## Buildable outcome

From a fresh checkout, an application author can use Bun to compile the
collaboration fixture, review and apply a PostgreSQL migration, start one
immutable Runtime Build, call and watch a Policy-protected Message Query,
publish through an idempotent Mutation, recover its committed Reaction after a
crash, restart or roll ten compatible instances, and reproduce the result on
one selected managed PostgreSQL target.
The archive fixture must pass the same kernels without a collaboration or
mutable-CRUD assumption.

## Repository and package graph

The first issue creates these explicit workspaces. Names below are build
boundaries, not new public authoring concepts.

```text
packages/questpie/       public `questpie` structural exports and shared types
packages/compiler/       private compiler, codegen, migration planner and CLI
packages/runtime/        private Runtime, PostgreSQL, worker and wire kernels
packages/testkit/        private fixtures, goldens and hostile harness helpers
fixtures/collaboration/  Company/Space/Channel/Membership/Message tracer
fixtures/archive/        Institution/Record/ResearchPermit/Embargo/Provenance
tests/{unit,type,integration,hostile,load,soak}/
```

Only `questpie` is a stable handwritten application import. Generated
`#questpie/app`, isolated `#questpie/package`, and `#questpie/client` aliases are
application outputs. Internal packages may split later only when dependency or
publication evidence earns it; they cannot introduce another scalar,
relational, durable, Fetch, authority, or artifact kernel.

## Artifact spine

One compilation owns Build Input, Package Inventory, normalized Definitions,
Owner/Origin, Compiled Manifest, Schema/Data/Policy/Operation/Service/ledger/
durable projections, Runtime Build inventory, generated app/package/client
declarations, and explanation joins. `.questpie/generated/` is replace-on-
success derived output. Committed migrations are reviewed source; PostgreSQL
receipts, Change Ledger facts, durable state, and Execution events are durable
truth. CLI joins canonical facts and never maintains a second manifest.

The implementation order is the topological order in `QUEUE.json`. Every issue
must begin with its named red test and run the seconds-long changed lane while
iterating. A slice adds its own performance manifest when behavior first
exists. Ordinary PRs run correctness; selected PRs may run stable quick micro
cases; ten-instance/fanout/worker/rolling/optional-loss load runs nightly or
manually; soak/chaos is manual. GitHub timing reports small changes and blocks
only clear repeated regression. Tagged stable runners own strict release
budgets.

## Fixed beta.1 absences

Beta.1 has no Action authoring, raw Route or credential Auth integration,
generic Job/Workflow client, Channel, File byte API, Search, OpenAPI/MCP/skill
bundle, Studio, optional cache/broker/carrier, split Runtime roles,
provider matrix, non-B-tree public Index, or RLS claim. Their compatible seams
remain those in ADR-0021; an issue may not expose a placeholder public API for
an absent capability.

## Completion gate

All twelve queue issues are closed in order; both conformance fixtures pass;
exact declarations, negative imports, Package isolation, relocation and no
ambient registry pass on canonical TypeScript; local PostgreSQL 17 and the
selected managed target agree; crash, response loss, retry/fencing, rolling
compatibility and optional-infrastructure absence pass; `bun run quality:full`
and stable-runner `bun run quality:release` pass. Public docs describe only the
implemented beta.1 surface.
