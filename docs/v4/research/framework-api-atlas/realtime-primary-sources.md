# Realtime primary-source research: observed Live Query and PostgreSQL Change Ledger

- Status: research evidence; no acceptance authority
- Date: 2026-08-12
- Scope: semantics that constrain QUESTPIE v4 Live Query, Change Ledger,
  reconnect, authorization refresh, and fanout
- Sources: PostgreSQL, Convex, and Electric first-party documentation and
  source-owned technical material only

This report answers a bounded question: what can QUESTPIE safely promise when
a normal read-only Query is watched, its reads are observed at runtime, and
PostgreSQL remains the visible source of truth? It does not select a transport
or import another product's architecture wholesale.

## Executive conclusion

The credible first contract is:

1. `watch` executes the same Policy-aware Query as an ordinary call in one
   PostgreSQL snapshot.
2. The Runtime observes every supported read that actually executes, including
   Policy, tenant, Relation, and Context-resolution evidence reads, and replaces
   the complete dependency set after every successful recomputation.
3. A database trigger writes a durable Change Ledger fact in the same business
   transaction. `NOTIFY` carries only a coarse wake hint.
4. Reconciliation reads durable state after startup, reconnect, duplicate wake,
   or detected gap. Correctness never depends on delivery of every notification.
5. Every recomputation constructs fresh authorization context and re-runs
   Policy. An old allow decision is not authority for the next result.
6. Client resume tokens are opaque and versioned. An expired, incompatible, or
   unverifiable token causes a fresh authorized snapshot, not guessed replay.
7. Independent watched Queries converge independently in the first contract.
   Atomic cross-Query publication is a separate, materially stronger feature.
8. A ledger `bigserial` value is not, by itself, a safe committed high-water
   mark. QUESTPIE must prove a commit-safe reconciler before it documents a
   monotonic cursor.

Items 1-7 fit the current product direction. Item 8 is the key implementation
trap exposed by the sources and must become an executable proof gate.

## 1. PostgreSQL `LISTEN`/`NOTIFY` is a wake mechanism, not a log

### Observed facts

- `NOTIFY` is explicitly described as simple interprocess communication;
  PostgreSQL recommends storing structured data in tables and using a
  notification to tell listeners to inspect it. Notifications execute inside
  transaction semantics and are delivered only after commit. Identical
  channel/payload notifications in one transaction are folded into one, and
  the default payload must be under 8000 bytes.
  [PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html)
- The notification queue is finite. A long-running transaction in a listening
  session can prevent queue cleanup, and a full queue makes a transaction that
  calls `NOTIFY` fail at commit.
  [PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html)
- `LISTEN` registration is session-local and disappears when the session ends.
  PostgreSQL also documents a race during initial subscription and prescribes
  this order: commit `LISTEN`, inspect durable database state in a new
  transaction, then rely on later notifications. The initial inspection may
  overlap the first notifications.
  [PostgreSQL `LISTEN`](https://www.postgresql.org/docs/current/sql-listen.html)

### QUESTPIE implications

- A notification payload must never be the only copy of a change. It should be
  a bounded hint such as `{ ledgerShard, observedHead }`, and consumers must
  tolerate duplicate, coalesced, delayed, and overlapping hints.
- Runtime startup and listener reconnect must use the PostgreSQL-prescribed
  shape: establish the listener, then reconcile durable state, then process
  wakes. Reconciliation and wake handling must be idempotent.
- A listener must not sit in a long transaction. Queue occupancy belongs in
  health/Studio diagnostics because a stuck listener can turn a realtime issue
  into failed business commits.
- Per-row `NOTIFY` is the wrong fanout primitive. One transaction- or shard-level
  wake can cover many ledger rows; the durable ledger supplies the detail.

## 2. Trigger capture can cover normal PostgreSQL writers, with explicit limits

### Observed facts

- Triggers run in the same transaction as the modifying statement; if the
  statement or trigger fails, both effects roll back. PostgreSQL supports
  `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` trigger events.
  [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html)
- `AFTER` transition tables expose the complete old/new row sets modified by a
  statement. PostgreSQL's own PL/pgSQL documentation notes that transition-table
  auditing can be significantly faster than a per-row trigger for bulk changes,
  but separate trigger declarations are needed for different event types.
  [PostgreSQL `CREATE TRIGGER`](https://www.postgresql.org/docs/current/sql-createtrigger.html),
  [PL/pgSQL trigger examples](https://www.postgresql.org/docs/current/plpgsql-trigger.html)
- Foreign-key cascade actions are ordinary `UPDATE` or `DELETE` operations on
  the referencing table and fire its triggers. `COPY FROM` also fires destination
  table triggers and check constraints.
  [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html),
  [PostgreSQL `COPY`](https://www.postgresql.org/docs/current/sql-copy.html)
- Partitioning has non-obvious behavior. Row-level triggers created on a
  partitioned table are cloned to its partitions. A row-moving `UPDATE` can
  become a `DELETE` plus `INSERT` for row triggers, while statement-trigger
  behavior follows the explicitly targeted parent.
  [PostgreSQL `CREATE TRIGGER`](https://www.postgresql.org/docs/current/sql-createtrigger.html),
  [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html)
- Triggers can be disabled. The `session_replication_role=replica` setting also
  suppresses normally enabled triggers; PostgreSQL warns that it even disables
  foreign-key checks. Triggers marked `ENABLE ALWAYS` behave differently, but
  privileged roles can still alter or drop trigger machinery.
  [PostgreSQL client connection defaults](https://www.postgresql.org/docs/current/runtime-config-client.html),
  [PostgreSQL `ALTER TABLE`](https://www.postgresql.org/docs/current/sql-altertable.html)

### QUESTPIE implications

- Installed `AFTER` triggers are a credible leading mechanism for the first
  Change Ledger tracer. They can capture framework Mutations, ordinary raw SQL,
  `COPY FROM`, foreign-key cascades, and external writers that use the managed
  application schema and normal write roles.
- The contract must include `TRUNCATE`; an `INSERT`/`UPDATE`/`DELETE`-only trigger
  set has an obvious bypass.
- The migration compiler must generate and fingerprint trigger functions,
  trigger attachments, their enable mode, partition attachments, and grants.
  Drift verification must fail if this capture surface changes.
- “External PostgreSQL writer” cannot mean an unrestricted superuser. A role
  that can disable/drop triggers, change `session_replication_role`, or write to
  an uninstrumented table is outside the realtime guarantee. This boundary must
  be stated in deployment docs and verified with database roles.
- Batch capture should be prototyped with statement-level transition tables,
  while partition row movement, `MERGE`, `ON CONFLICT`, zero-row statements, and
  `TRUNCATE` receive separate golden cases. The captured fact should describe
  semantic row/key/range invalidation, not blindly serialize complete rows.

## 3. Logical decoding is the commit-ordered alternative, not a free default

### Observed facts

- Logical decoding extracts persistent table changes from WAL. Concurrent
  transactions are decoded in commit order, aborted transactions are omitted,
  and the commit callback receives a commit LSN.
  [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding.html),
  [logical decoding output callbacks](https://www.postgresql.org/docs/current/logicaldecoding-output-plugin.html)
- Old row values for `UPDATE` and `DELETE` depend on replica identity. A
  publication needs a usable replica identity for those operations; `FULL` is a
  fallback with potential efficiency costs.
  [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding.html),
  [logical replication publication](https://www.postgresql.org/docs/current/logical-replication-publication.html)
- Replication slots persist independently of connections, but their position is
  persisted at checkpoints. A crash can replay recent changes, so the consumer
  must be idempotent. A slot retains WAL/catalog resources even while no
  consumer is connected and can cause severe storage or wraparound pressure.
  [PostgreSQL logical decoding concepts](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)
- Logical replication requires `wal_level=logical`, configured slot and sender
  capacity, and operational handling for lag, invalidated/lost slots, and
  failover. PostgreSQL exposes `restart_lsn`, `confirmed_flush_lsn`, WAL status,
  and safe remaining WAL size for monitoring.
  [PostgreSQL logical replication configuration](https://www.postgresql.org/docs/current/logical-replication-config.html),
  [`pg_replication_slots`](https://www.postgresql.org/docs/current/view-pg-replication-slots.html)

### QUESTPIE implications

- Logical decoding has the strongest native answer for commit-ordered capture
  and an LSN checkpoint. It also captures normal SQL writers without requiring
  every caller to write an outbox row.
- It is not automatically a better beta-one default. It adds provider feature
  checks, replication credentials, slot lifecycle, WAL-retention backpressure,
  failover configuration, duplicate handling, and replica-identity requirements.
- The design should retain a narrow internal capture seam so trigger-ledger
  ingestion and a future logical-decoding ingestor can normalize into the same
  durable change facts. That seam is internal; it is not a public provider SPI.
- If logical decoding is selected later, one shared ingestion slot should feed
  the server-side dependency index. A slot per browser subscriber is ruled out
  by slot ownership, resource retention, and fanout concerns.

## 4. A `bigserial` ledger id is not a commit-safe cursor

### Observed facts

- PostgreSQL sequences allocate values atomically without waiting for the
  surrounding transaction to commit. `nextval` is never rolled back, and
  exclusive locking is required for a transactional gapless counter.
  [PostgreSQL `CREATE SEQUENCE`](https://www.postgresql.org/docs/current/sql-createsequence.html)
- PostgreSQL snapshots explicitly contain transactions that were in progress at
  snapshot time. A lower transaction/sequence value can therefore be invisible
  while a concurrently allocated higher value is already committed and visible.
  [PostgreSQL transaction snapshot information](https://www.postgresql.org/docs/current/functions-info.html)
- Logical decoding avoids that ambiguity because it exposes committed
  transactions in commit order and supplies commit LSNs.
  [logical decoding output callbacks](https://www.postgresql.org/docs/current/logicaldecoding-output-plugin.html)

### Failure example

This is an inference from those PostgreSQL guarantees:

1. transaction A inserts ledger id `40` and remains open;
2. transaction B inserts ledger id `41` and commits;
3. a consumer sees `41` and stores `cursor=41`;
4. A commits;
5. `WHERE id > 41` can never discover the newly visible row `40`.

Gaps alone are harmless; allocation order differing from commit/visibility order
is the bug. The same problem applies to a trigger-time timestamp or XID when it
is treated as a simple committed high-water mark.

### Required design consequence

The trigger-ledger prototype must choose and prove one of these families:

- a reconciler that discovers durable unprocessed identities without advancing
  a naïve `max(id)` frontier, then appends/assigns a separate commit-safe
  processed order;
- a visibility-aware algorithm whose frontier cannot cross an in-progress
  transaction (and which remains correct across crash, XID wrap, and retention);
- commit serialization before id assignment, accepting and measuring the write
  bottleneck; or
- WAL/logical-decoding commit order.

Until one passes concurrency and crash tests, public `cursor` must be opaque and
must not be documented as the ledger primary key or as a PostgreSQL LSN.

## 5. Actual-read dependency capture is the correct abstraction

### Observed facts from Convex

- Convex documents that a query's database reads occur at one logical timestamp
  and that subscribed results update when underlying data changes.
  [Convex Queries](https://docs.convex.dev/functions/query-functions),
  [Convex Realtime](https://docs.convex.dev/realtime)
- Its first-party architecture description is more precise: query execution
  builds a read set of index/range reads; a subscription manager walks the
  transaction log, detects overlap, reruns affected functions, and replaces the
  subscription's read set after rerun. It aggregates subscriptions so the log is
  not scanned separately for every client.
  [How Convex Works](https://stack.convex.dev/how-convex-works)
- Convex requires Query determinism because a subscription is precise only when
  the return value is determined by arguments and observed database reads.
  External fetch is therefore unavailable to Queries.
  [How Convex Works](https://stack.convex.dev/how-convex-works),
  [Convex runtimes](https://docs.convex.dev/functions/runtimes)
- Convex bounds read work and the number of database ranges a function can
  observe; pagination offers explicit maximum rows/bytes read.
  [Convex error handling](https://docs.convex.dev/functions/error-handling/),
  [Convex pagination options](https://docs.convex.dev/api/interfaces/server.PaginationOptions)

### QUESTPIE implications

- Static handler call sites are insufficient. Conditional branches, helper
  functions, nested Query calls, Relations, pagination boundaries, and Policy
  predicates make the dependency set an execution result.
- A dependency is not merely “row ids returned.” Correct tokens include point
  keys, unique lookups, index/range predicates, conservative table tokens, and
  pagination boundary/order dependencies. Otherwise an inserted row that was
  not present in the old result cannot invalidate it.
- Supported `ctx.data` reads must report normalized dependency tokens to an
  execution-scoped observer. Nested Query reads join the parent's observation
  scope. Failed/aborted recomputations must not replace the last good plan.
- A successful recomputation atomically replaces, rather than unions with, the
  old dependency set. Unioning forever creates unbounded false-positive fanout.
- Time, randomness, environment values, Files, Search, and external requests are
  not implicitly reactive. A watched Query must reject them, pin a stable value
  in its input/context identity, or use a named observable source with explicit
  invalidation semantics.
- Raw SQL reads cannot be inferred from arbitrary SQL execution. They need an
  explicit conservative dependency token; without it the same Query may execute
  once but is ineligible for `watch`.

## 6. Policy, Context, and revocation are dependencies and authority fences

### Source-grounded constraint

Observed-read systems rerun only when a logged write overlaps a recorded read.
Convex also notes that time does not itself invalidate a Query because it is not
a database dependency.
[Convex best practices](https://docs.convex.dev/understanding/best-practices)

Therefore an authorization fact that can change must be represented in one of
three explicit ways: an observed database read, a subscription-identity change,
or a named invalidation source. Otherwise revocation can remain invisible.

### QUESTPIE implications

- Membership, role, tenant, and ownership rows read by Policy or Context
  Resolution must join the same observed dependency set as business reads.
- Context Resolution that reads PostgreSQL should run in the Query's snapshot
  where possible. If credential/session resolution happens outside that
  snapshot, its immutable authority fingerprint and refresh/invalidation source
  must be part of subscription identity.
- Recompute must build a fresh Execution, re-resolve refreshable context, and
  re-run admission, row, Relation, and output-Field Policy. Retaining the
  original resolved context for the life of a socket fails revocation.
- Principal, Tenant, Authority, locale, and other result-affecting context form
  a cache/subscription partition. Two callers may share computation only when
  this authority fingerprint and all Query/code/input identities match. Results
  or dependency plans must never be shared across a broader authority boundary.
- Token expiry/logout, tenant switch, server-side role revocation, Policy
  deployment, and context-resolver deployment are all explicit reauthorization
  events. The outcome may be a new authorized result, nondisclosing empty/not-
  found result, typed authorization error, or subscription termination according
  to the Operation contract; it must never be continued delivery under stale
  authority.

## 7. Reconnect requires an opaque checkpoint and a reset path

### Observed facts from Electric

- Electric's current HTTP sync API exposes a shape handle and continuation
  offset, performs an initial snapshot, signals `up-to-date`, and then continues
  from the offset in long-poll or SSE live mode. It has an explicit
  `must-refetch` control message when retained state can no longer support
  continuation.
  [Electric HTTP API](https://electric-sql.com/docs/api/http)
- Its subset snapshot protocol carries PostgreSQL snapshot metadata so a client
  can tell which subsequent changes are already represented by the snapshot.
  [Electric HTTP API](https://electric-sql.com/docs/api/http)
- Electric documents request coalescing as a fanout technique for identical
  live requests at a cache/CDN layer.
  [Electric HTTP API](https://electric-sql.com/docs/api/http)

### QUESTPIE implications

- The client-visible resume token should be opaque, authenticated, and bounded
  to at least deployment/application digest, Query identity/version, normalized
  input, authority fingerprint, and server-side checkpoint generation.
- Reconnect sends the last acknowledged token. The server either continues from
  retained compatible state or emits `reset` and recomputes a fresh authorized
  snapshot. Reset is a correctness feature, not an exceptional corruption case.
- Client acknowledgement and server production position are different. The
  server must bound unacknowledged results/bytes and cannot retain a checkpoint
  forever for a disconnected client.
- The protocol should transfer Query results, not expose Change Ledger rows.
  Ledger replay is internal invalidation/recovery; after a long disconnect, a
  fresh Query result is normally smaller and safer than replaying every change.
- Duplicate wakes, duplicate ledger facts, reconnect overlap, and a repeated
  recomputation result must be harmless. A result hash/version may suppress
  redundant payload delivery, but it cannot replace authorization recheck.

## 8. Consistency of multiple watched Queries must be stated honestly

### Observed facts

- Convex promises that all active client subscriptions update to the same
  logical database snapshot.
  [Convex Realtime](https://docs.convex.dev/realtime),
  [Convex overview](https://docs.convex.dev/understanding/overview)
- PostgreSQL can give multiple sessions exactly the same database view by
  exporting and importing a snapshot, but the exporting transaction must remain
  open while importers attach. Within one `REPEATABLE READ` transaction, all
  statements naturally use the same snapshot.
  [PostgreSQL snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html),
  [PostgreSQL `SET TRANSACTION`](https://www.postgresql.org/docs/current/sql-set-transaction.html)

### QUESTPIE implications

- Running each dirty Query independently gives each result a valid PostgreSQL
  snapshot, but it does not guarantee that four client-visible Query results
  represent one shared point. A commit can occur between recomputations.
- To promise atomic cross-Query state, the Runtime would need a batch frontier,
  execute affected Queries against one retained/exported snapshot, and make the
  client apply the batch atomically. This adds scheduling, snapshot lifetime,
  slow-query, partial-error, transport, and backpressure costs.
- The KISS first contract is independent convergence: each result is internally
  snapshot-consistent and authorized, but related watched Queries may advance
  at different times. Developer docs should recommend one composite Query when
  the UI requires one atomic view of four Collections.
- The protocol may carry a server checkpoint on every result for diagnostics
  and later batching, but equal-looking cursors must not imply a cross-Query
  guarantee until the batching proof exists.

## 9. Deployment changes are subscription invalidations

### Observed evidence

- Convex invalidates all subscriptions when environment variables change
  because environment is accessible to Queries but is not part of their normal
  cache key.
  [Convex deployment API](https://docs.convex.dev/deployment-api/update-environment-variables)
- Convex advises that public functions remain backward compatible because old
  clients can remain live after a backend deployment.
  [Convex production deployment guidance](https://docs.convex.dev/production/overview)

### QUESTPIE implications

- A subscription plan is valid only for the exact Compiled Manifest, Query
  executable, Policy, Context Resolution, schema projection, and serializer
  versions under which it was computed.
- A deployment must invalidate/recompute affected subscriptions or force a
  versioned reset. It must not keep an old dependency plan while running new
  code.
- Generated clients and runtime should negotiate operation wire versions. An
  output-incompatible deployment returns a typed version/reset outcome rather
  than decoding new bytes as the old result type.
- Additive, backward-compatible operation evolution can preserve the endpoint,
  but it still needs fresh dependency observation under the new executable.
- Studio must show the code/manifest digest for the current result and why a
  deployment caused recomputation or reset.

## 10. Backpressure and fanout need product-visible budgets

Convex makes query/range limits and deployment concurrency explicit, and its
subscription manager aggregates read sets rather than scanning a log per client.
Electric shows that identical live requests can be coalesced at a delivery
layer. These are evidence for bounded shared work, not numbers QUESTPIE should
copy.
[Convex limits](https://docs.convex.dev/production/state/limits),
[How Convex Works](https://stack.convex.dev/how-convex-works),
[Electric HTTP API](https://electric-sql.com/docs/api/http)

The first QUESTPIE runtime must define and expose at least:

| Budget                                                 | Required failure or degradation behavior                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Query duration, rows, and bytes read                   | fail the execution with a typed budget diagnostic                                     |
| Dependency token count and normalized range complexity | fail `watch` or conservatively widen only within a documented cap                     |
| Active subscriptions per session and Principal         | reject new watches with a retryable/resource-limit outcome                            |
| Equivalent subscription groups                         | share only across identical Query/input/version/authority identities                  |
| Dirty recomputation queue                              | coalesce repeated invalidations; never run the same version concurrently without need |
| Recompute rate and CPU                                 | debounce/coalesce within a documented latency bound; surface sustained lag            |
| Result bytes and outbound buffered bytes               | reset or disconnect a slow client before unbounded memory growth                      |
| Retained resume checkpoints and age                    | expire to a fresh authorized snapshot                                                 |
| Change Ledger rows/bytes and oldest unreconciled age   | alert, apply backpressure, and never prune past an unreconciled consumer              |
| Wake queue occupancy                                   | report PostgreSQL notification queue usage and reconnect state                        |
| Fanout per change/dependency                           | cap or conservatively schedule in batches with visible lag                            |

“Latest wins” is safe only for pending recomputation work: after changes
`c1..c20`, one Query rerun against a snapshot newer than all twenty may replace
twenty redundant reruns. It is not permission to advance a durable ledger
checkpoint past a change the reconciler has not safely accounted for.

## 11. Candidate internal model for the focused design pass

This is a synthesis for prototyping, not an accepted API.

```text
PostgreSQL transaction
  business rows + trigger-produced change facts
                |
                | commit atomically
                v
durable Change Ledger ---- reconciliation scan ---- dependency index
                |                                  |
                +---- coarse NOTIFY wake --------->+---- mark watched Query dirty
                                                         |
                                                         v
fresh Execution + one snapshot + actual-read observation
  Context Resolution -> Policy -> Query -> output Policy
                                                         |
                                                         v
replace dependency plan + publish versioned result/checkpoint
```

Required separations:

- Change fact identity is not automatically a commit cursor.
- Wake position is not durable reconciliation position.
- Server reconciliation position is not client acknowledgement position.
- A dependency plan is not authorization.
- A cached result is not shareable without an exact authority partition.
- A transport sequence is not a PostgreSQL transaction/LSN guarantee.

## 12. Proof matrix that should gate the contract

### Dependency capture

1. A branch reads Collection A only for one input and A+B for another; each
   successful recomputation replaces the plan exactly.
2. A point miss and an empty range still invalidate when a matching row is
   inserted.
3. Relation, membership, tenant, Policy, and Context-resolution reads appear in
   the plan even when their rows are not returned.
4. Pagination invalidates on boundary insert/delete/update without gaps or
   duplicate result rows.
5. Nested Query reads join the outer plan; a failed nested Query does not
   publish a partial replacement plan.
6. Raw SQL with a declared conservative token works; raw SQL without one runs
   once but `watch` fails at compile/start with a precise diagnostic.

### Ledger and wake correctness

7. Crash after business+ledger commit and before `NOTIFY` delivery still causes
   recomputation after restart.
8. Duplicate and coalesced notifications do not duplicate visible effects.
9. `LISTEN` setup race is covered by listen-then-reconcile ordering.
10. Concurrent transactions allocate ledger ids out of commit order; the
    reconciler processes both. A naïve `max(id)` implementation must fail this
    fixture.
11. Rollback leaves no visible ledger fact; a sequence gap does not stall the
    reconciler.
12. Raw SQL, `COPY FROM`, `MERGE`, `ON CONFLICT`, foreign-key cascade, partition
    row movement, and `TRUNCATE` all hit their documented capture path.
13. A role that disables capture is rejected by the supported-role conformance
    check; trigger drift fails schema verification.

### Authorization and context

14. Membership/role revocation while connected causes fresh Context/Policy
    evaluation before the next payload and cannot leak the old result.
15. Logout, token expiry/refresh failure, Tenant switch, and Principal change
    partition or terminate the subscription deterministically.
16. Two Principals watching identical Query/input values never share a result or
    plan across a different authority fingerprint.
17. Policy-only and Context-resolver-only deployments invalidate the old plan.

### Reconnect, deployment, and clients

18. Disconnect before acknowledgement, reconnect after acknowledgement,
    duplicated result, expired token, pruned checkpoint, and server restart all
    either resume safely or produce an explicit fresh snapshot reset.
19. Old generated client versus additive server deploy continues within the
    declared wire contract; incompatible output returns a version diagnostic.
20. Four independent watched Queries may advance independently and all converge;
    one composite Query returns an atomic multi-Collection snapshot.

### Bounds and operations

21. Dependency, execution, active-subscription, fanout, result-byte,
    unacknowledged-byte, ledger-retention, and per-Principal limits fail or
    degrade exactly as documented.
22. A hot change coalesces dirty recomputations without advancing reconciliation
    beyond unseen committed work.
23. Slow clients are reset/disconnected before server memory becomes unbounded.
24. Studio can explain current Query version, authority partition, dependency
    count, last ledger/wake/recompute positions, lag, reset reason, and budget
    failure without exposing sensitive values.

## 13. Decisions this research does not close

The focused realtime design still must choose:

- the trigger-ledger reconciler's commit-safe ordering/discovery algorithm;
- exact dependency-token algebra and invalidation matching;
- whether first-version trigger facts are row-, key-, range-, or relation-level;
- public `watch`/generated-client syntax and result/reset/error shape;
- Context Resolution refresh rules for credentials and non-database facts;
- checkpoint retention and acknowledgement protocol;
- whether a later release earns cross-Query atomic publication;
- exact limits and provider conformance matrix; and
- the threshold at which logical decoding becomes required or preferred.

No public realtime contract should be accepted until the out-of-order commit
fixture, revocation fixture, reconnect/reset fixture, and slow-client fixture are
executable.
