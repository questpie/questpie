# QUESTPIE production-backend closure decision map

- Status: frontier identified; no new implementation authority
- Objective: turn the released beta.1 tracer into a production-shaped backend
  that an application developer can run, understand, and extend
- Product boundary: Studio is excluded until it can perform privileged
  application administration; an artifact viewer is not a product
- Authority: Accepted ADRs, `SPEC.md`, and executable evidence remain fixed;
  this map records investigation order, not replacement authority

## #1: Which PostgreSQL driver does the Runtime own?

Blocked by: none
Type: Discuss

### Question

Should QUESTPIE keep Bun SQL, add `pg` beside it, or standardize on one driver?

### Answer

Use `pg` as the only database driver. Bun remains the supported runtime,
package manager, test runner, and build tool; it does not remain a second SQL
implementation. Do not publish a database-provider interface: PostgreSQL is
the only durable adapter, as fixed by ADR-0001.

The reason is capability and operational maturity, not a claim that `pg` wins
every microbenchmark. The Runtime needs pooled ordinary traffic, session-affine
migrations and `LISTEN`/`NOTIFY`, explicit connection budgets, reconnect, and
cancellation behind one deep PostgreSQL module. Two drivers would duplicate
decoding, errors, transactions, cancellation, tests, and failure semantics.

This decision would be reopened only by a representative production workload
showing material end-to-end harm, or a required PostgreSQL protocol capability
that `pg` cannot provide. A hello-world throughput benchmark is insufficient.

Current grounding: generated application code imports Bun SQL and constructs
one pool from `input.postgres.url`
(`packages/compiler/src/runtime/application.ts:196`, `:272`-`:293`); the public
generated input exposes only `{ url: string }`
(`packages/compiler/src/generate.ts:423`-`:427`); and Runtime PostgreSQL modules
accept Bun's `SQL` type directly
(`packages/runtime/src/relational/postgres.ts:1`-`:24`).

## #2: What connection topology is correct for one Runtime instance?

Blocked by: #1
Type: Research

### Question

Define the public configuration and per-instance connection budget for ordinary
queries, transactions, workers, migrations, maintenance, and realtime wakes.
Verify `pg`, PgBouncer transaction/session pooling, and managed PostgreSQL
behavior from primary sources. Decide whether `directConnectionUrl` is required
or may default to `connectionUrl`, and specify startup, shutdown, timeout,
cancellation, credential rotation, and failure behavior.

### Answer

Frontier. The leading public shape is:

```ts
postgres: {
	connectionUrl: string;
	directConnectionUrl: string;
}
```

`connectionUrl` serves bounded ordinary Runtime traffic through a pooler.
`directConnectionUrl` serves session-affine work such as migrations and a
dedicated `LISTEN` connection. The research must determine safe local fallback
and exact pool allocation before this becomes an interface.

## #3: What is the smallest deep PostgreSQL module?

Blocked by: #2
Type: Prototype

### Question

Prototype one internal module whose small interface owns pool lifecycle,
reserved sessions, transactions, parameterized execution, row decoding,
cancellation, server-side timeouts, migration locking, listener reconnect, and
diagnostics. Compare materially different interfaces and prove the deletion
test: removing the module must spread PostgreSQL complexity back across query,
mutation, live-query, durable, compiler migration, and generated application
callers.

### Answer

Fog. There will be one concrete PostgreSQL implementation, not an adapter
registry and not a public raw-client escape hatch.

## #4: How does realtime wake immediately without owning correctness?

Blocked by: #2, #3
Type: Prototype

### Question

Add a dedicated reconnecting `LISTEN` session that requests reconciliation on
possible progress while preserving the Change Ledger and PostgreSQL frontier as
the sole correctness authority. Prove notification loss, duplication,
coalescing, disconnect, reconnect, process crash, arbitrary-instance routing,
and periodic reconciliation fallback.

### Answer

Fog. ADR-0017 already fixes `NOTIFY` as a lossy hint only
(`docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md:47`-`:50`).
The current implementation has no database wake: it starts a reconciliation
scan and then polls every 10 seconds
(`packages/runtime/src/live-query/postgres-wake.ts:14`-`:25`, `:109`-`:124`).
The target is immediate normal-path UX without weakening crash recovery.

## #5: How is Bun SQL removed without semantic drift?

Blocked by: #3
Type: Prototype

### Question

Migrate compiler schema/Seed operations, generated application construction,
Runtime query/mutation/live-query/durable paths, scripts, and tests to the one
module. Preserve snapshot isolation, transaction pinning, nondisclosure,
BigInt/date/byte decoding, cancellation, duplicate recovery, migration
fingerprints, internal-protocol compatibility, and PostgreSQL 16/17/18 lanes.
Measure representative application and contention workloads before and after.

### Answer

Fog. Completion means no production or generated code imports Bun `SQL`; it
does not mean Bun disappears from the project.

## #6: What runnable backend proves the developer journey?

Blocked by: #4, #5
Type: Prototype

### Question

Build one small production-shaped application that a developer can migrate,
start, seed, call through direct and Fetch/client paths, mutate, watch in real
time, restart, and run a Reaction against a disposable PostgreSQL database.
Include scripts and failure diagnostics, not only test helpers.

### Answer

Fog. This is the usability checkpoint before adding breadth: a developer must
be able to learn QUESTPIE by running a backend, not by reading generated files.

## #7: Which accepted backend seams are still absent?

Blocked by: #6
Type: Research

### Question

Re-derive the implementation status of Action, Route, Job, Workflow,
Collection Operation Sets, OpenAPI, MCP, and skills against their Accepted
contracts. Separate missing runtime behavior from generated-but-unusable
surface, then order the smallest vertical slices needed for a useful backend.

### Answer

Fog. OpenAPI, MCP, and skills must remain compiler projections over canonical
App Contract members and the same Operation/Execution/Policy path, never
parallel handlers or authority (`docs/adr/0018-freeze-file-search-and-contract-projections.md:60`-`:70`).

## #8: Which authoring and documentation DX earns a focused pass?

Blocked by: #6, #7
Type: Discuss

### Question

Audit dot-access ergonomics such as `query.messages.page`, go-to-definition from
generated members to authored Origins, the actual built-in CRUD surface,
fenced-code compilation in guides, end-to-end documentation, and framework
skills. Decide each item from a working application rather than isolated type
prettiness.

### Answer

Fog. Bracket access may remain as a stable fallback; dot access and navigation
are valuable only if generated declarations preserve exact names, types, and
Origins without an editor-specific authority path.

## #9: What production evidence closes the backend pass?

Blocked by: #4, #5, #6, #7
Type: Research

### Question

Define and run connection-budget, pool exhaustion, slow-query cancellation,
rolling deployment, notification loss, worker contention, migration isolation,
managed PostgreSQL, load, and soak evidence. Record explicit latency and
resource budgets and make every zero-result checker prove a positive control.

### Answer

Fog. Studio remains outside this closure under ADR-0024; it returns only as a
separate system-privileged administration vertical
(`docs/adr/0024-descope-minimal-studio-from-beta-one.md:34`-`:40`).
