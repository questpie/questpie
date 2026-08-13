# QUESTPIE v4 conformance matrix

## Fixtures

`collaboration` is Company → Space → Channel → Membership → Message with
private-channel membership, publishing, File metadata, Search, inbound Route,
watched feed, Reaction, Workflow, and external Action. It catches relational
Policy, fanout, causation, and multi-instance errors.

`archive` is Institution → Record plus ResearchPermit, Embargo, and immutable
Provenance. Access can be public, embargo-time-dependent, or permit-specific;
Records are append-oriented and cross-institution research reads are valid.
This catches accidental tenant equality, membership-only authority, mutable
CRUD, and collaboration-ontology assumptions.

These are conformance fixtures, not starter templates or public domain models.

## Matrix

| Cell               | Owner                                   | Fixtures      | Surfaces                                                  | Hostile invariant                                                                                                                        | Lane            | Required artifact                                         |
| ------------------ | --------------------------------------- | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| definitions        | compiler                                | both          | build, explain                                            | collision, relocation, Package isolation, stale generated output                                                                         | full            | canonical Manifest/App Contract/Origin golden             |
| scalar-and-exports | compiler                                | both          | app, package, client                                      | negative imports, invalid kernel projection, no ambient registry                                                                         | full            | declarations, completion/hover transcript, instantiations |
| migrations         | migration and Seed engine               | both          | CLI, Runtime readiness, Studio                            | tamper, drift, lost apply response, concurrent apply, Seed dependency/order/replay, restart                                              | postgres        | plan, checksum, Migration/Seed receipts and drift golden  |
| context            | Execution                               | both          | direct, network, recompute, worker, Studio                | bootstrap failure, mutable evidence, cancellation, no ambient System                                                                     | postgres        | Context resolution trace                                  |
| policy             | relational planner                      | both          | direct, network, recompute, worker, Studio                | denied/missing parity, lock recheck, cycles, page sentinel, no RLS claim                                                                 | postgres        | SQL/Policy explain and nondisclosure results              |
| query              | Query snapshot                          | both          | direct, network, Studio                                   | four-Collection consistency, cancellation, bounds, field omission                                                                        | postgres        | result/error parity golden                                |
| mutation           | Mutation transaction                    | both          | direct, duplicate network, Studio                         | concurrent update, changed-input identity conflict, pre/post-commit loss                                                                 | postgres        | transaction/call receipt history                          |
| lifecycle          | codecs and Mutation/Query phases        | both          | direct, network                                           | supplied forbidden Field, normalization order, failed commit, projection                                                                 | full            | phase-order golden                                        |
| live-query         | Change Ledger and Query recompute       | collaboration | network SSE, recompute, Studio                            | empty range, miss, role revoke, wake loss, retention wrap/reset                                                                          | load            | dependency/frontier/frame history                         |
| durable            | Durable Run kernel                      | collaboration | Mutation dispatch, Job, Reaction, Workflow worker, Studio | crash, retry, lease fencing, nondeterminism, version retirement                                                                          | load            | run/attempt/lease/checkpoint history                      |
| service-route-auth | Service graph and Fetch kernel          | both          | raw Route, direct Route, app.fetch                        | stream EOF cleanup, resolver failure, cancellation, Package isolation                                                                    | postgres        | lifetime and parity trace                                 |
| ha                 | PostgreSQL authority                    | collaboration | ten app instances, concurrent workers, rolling builds     | arbitrary routing, crash, stale claim, no leader/affinity                                                                                | load            | instance/claim/frontier transcript                        |
| accelerators       | Runtime capability bindings             | collaboration | cache, wake broker, Channel carrier                       | loss, stale/corrupt bytes, duplicate/dropped hints, carrier reset                                                                        | load            | fallback-equivalence report                               |
| channel            | compiler, Policy, and PostgreSQL        | both          | direct publish, network SSE/POST, worker, Studio          | codec failure, denied publish/subscribe, changed-payload conflict, subject collision, order, bounded replay/gap, authority reset, limits | load            | event/frame/Policy history                                |
| files              | metadata Collection and byte capability | both          | Operation, Route/SDK, cleanup Job                         | pending nondisclosure, checksum, abort, orphan, missing byte                                                                             | postgres        | lifecycle/recovery parity report                          |
| search             | Search projection and source planner    | both          | Operation, worker, Studio                                 | forged denied candidate, revocation, totals/facets/cursor universe                                                                       | postgres        | checkpoint and authorized-result golden                   |
| projections        | compiler                                | both          | OpenAPI, MCP, skills, explain                             | unsupported Origin, stale/collision, negative Package import                                                                             | full            | byte-stable projection bundle                             |
| envelope           | Execution Envelope                      | both          | direct, network, recompute, worker, Studio                | secret/raw payload exclusion, causation joins, explicit bounds                                                                           | full            | canonical event schema and join report                    |
| managed-postgres   | application contract                    | both          | selected managed target                                   | version/collation/transaction/notification differences                                                                                   | release         | provider conformance report, never provider SPI           |
| performance        | owning implementation slice             | both          | compiler, editor, Runtime, worker                         | budget overflow is explicit; GitHub noise is non-strict                                                                                  | micro/load/soak | versioned measurements and slice budget owner             |

## Required cross-products

- Every semantic Operation cell runs through direct, network, and Studio; worker
  and recompute add only capability-scoped roots, never alternate semantics.
- Both fixtures compile with exact generated declarations and negative imports.
- Local PostgreSQL is blocking. One selected managed PostgreSQL target is a
  release-evidence gate for the connected tracer, not the fast PR path.
- The ten-instance scenario combines arbitrary roots, overlapping worker
  claims, wake loss, crash after commit, and an old/new executable rollout.
- Optional cache, broker, Channel carrier, and byte storage can change latency
  or delivery carrier only. Their absence or loss cannot change Context,
  Policy, disclosure, ledger, durable history, or authority.
- The fixed public Index remains B-tree-only. No conformance row asserts RLS.
- `channelCarrier` is transport only. The distinct Channel Resource row owns
  codecs, Policy, subject, PostgreSQL order/replay, invalidation, and limits.
- Archive runs every semantic and portability cell, including Channel, while
  collaboration alone carries the connected Live Query/durable/HA/load story.
  This avoids duplicating the expensive connected tracer but still tests
  non-tenant authority at compiler, Policy, Operation, Route, File, Search,
  projection, managed-PostgreSQL, and performance boundaries.
- Action authoring remains a later focused vertical. The collaboration fixture
  reserves its external-effect job and uses the accepted effect identity and
  durable seam; #14 does not claim an Action interface.

## Scheduling and budgets

Correctness tests prove exact outcomes. Microbenchmarks isolate deterministic
kernels. Load tests exercise throughput/fanout/ten-instance contention and
rolling deployment. Soak/chaos tests exercise leak, retention, crash, and
recovery over time. Only stable quick microbenchmarks may run on selected PRs.
GitHub-hosted measurements report small changes and block only a clear repeated
regression. Stable tagged runners own strict release budgets.

The repository owns harness and schemas. Each implementation slice owns its exact threshold after measuring the red fixture; no global guessed latency or
throughput number is authority.

## V3 behavioral evidence routing

Reuse v3 access fail-closed, Field access, relation, transaction lock/nesting,
migration, realtime capture/reconciliation, queue lease/retry/idempotency,
runtime compatibility, client wire, file, and Search tests as hostile job
evidence. Rewrite them around accepted v4 ownership. Do not port the v3 test
tree, serial 45-minute loop, Module/plugin merge, Queue adapters, realtime
provider matrix, Admin backend, or hook catalogue.
