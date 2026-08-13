# Live Query and Change Ledger contract

- Status: Accepted
- Projection: verified by independent factual, prose, and example audits
- Date: 2026-08-13
- Scope: observed Query dependencies, complete Live Query delivery, Change
  Ledger capture, commit-safe reconciliation, resume/reset, and bounded clients
- Authority: ADR-0012 and proof head
  `05fc96f3d07c70beaf7f654d79d6cfb46f427f92`

## Boundary

This contract accepts P4 only. It does not implement a production compiler or
Runtime and does not accept durable Reaction/Job delivery, production
Runtime/Fetch framing, Studio protocol, atomic multi-Query publication, or
persistent offline resume.

The foundational proof at `d03358b7` and accepted P1–P3 heads `713485a6`,
`5fbd9058`, and `a09bf55f` remain fixed inputs. P4's aggregate runner asserts
all of their canonical digests and directly preserves the exact P2/P3
Membership key `(companyId, principalId, scopeKey)`.

## One Query, two generated uses

The exact generated Query method remains callable with P3's input, output, and
optional `OperationCallOptions`. A compiler-proven watchable Query also has:

```ts
method.watch(input, callback, options?): () => void;
```

The callback receives the same complete validated result as a one-shot call.
Delivery kind is `initial`, `update`, or `reset`. Reset reasons include changed
deployment, changed authority, and unavailable retained state. Resume tokens
are authenticated, opaque, and generated-client-managed; application code does
not supply, decode, compare, or persist them.

A Query with an unsupported raw read stays callable once but has no `.watch`.
There is no second realtime Definition or handler.

## Observed dependency plans

The compiler owns closed watchability and observation slots. A root execution
records only the supported reads its actual branch reaches:

- Collection points and ranges, including empty ranges;
- structural Query order, page boundary, and `first + 1` sentinel;
- Relation endpoints and misses;
- Tenant partitions;
- Context bootstrap points;
- relational Policy evidence;
- supported nested generated reads.

After a successful recomputation, the new plan atomically replaces the old
plan. It never accumulates a historical union. Failure, cancellation, or
revocation preserves the last successful dependency plan but publishes no
partial or unauthorized result.

Conservative matching may recompute too often, but cannot miss a potentially
overlapping committed change.

## Fresh authorization

Every initial evaluation and recomputation creates a fresh root Execution,
resolves the immutable Context, opens the Query snapshot, and evaluates current
Policy. An earlier connection or allow decision is not authority. Membership
revocation fails before another result is disclosed.

Equivalent watches may share work only when every result-affecting Query,
input, deployment, Context, Principal, Tenant, Authority, output, and Policy
dimension is equivalent. Sharing is an optimization, not an authorization
path.

## Transactional Change Ledger

Compiler-owned PostgreSQL triggers append bounded facts in the same transaction
as a reactive business write. Rollback and zero-row statements append nothing.
The seventeenth row fact for one transaction and Collection widens the proof
shape to one conservative Collection fact rather than growing without bound.

Supported capture includes ordinary and raw DML, framework-shaped writes,
foreign-key cascades, managed external writers, `COPY`, `ON CONFLICT`, `MERGE`,
and `TRUNCATE`. The P4 schema validator rejects partitioned reactive
Collections. Raw SQL reads without a closed dependency contract remain
one-shot only.

The managed writer role can modify business tables through installed capture.
It cannot read or mutate Change Ledger, consumer-frontier, or processed-fact
state; disable triggers; set replication role; or acquire superuser authority.
Superuser/replication bypass, dropped triggers, and uninstrumented tables are
explicit trusted deployment boundaries. Trigger fingerprint drift fails
conformance.

## Commit-safe reconciliation

`LISTEN`/`NOTIFY` only wakes reconciliation. Duplicate, coalesced, delayed, and
absent hints cannot create or skip durable work.

Each consumer persists an exclusive `xid8` PostgreSQL visibility horizon.
Reconciliation selects visible Change Ledger facts with transaction identity at
or above the prior horizon and below `pg_snapshot_xmin` of its new snapshot. It
records processed effects and advances the consumer horizon atomically.

This frontier does not use maximum fact identity, sequence, timestamp, or
trigger XID. The proof allocates a lower fact/XID first, commits the higher one
first, holds the visibility horizon at the open lower transaction, and then
processes both facts after it commits. Sequence wrap from 3 to 1 does not change
the frontier.

Retention deletes facts only below the minimum acknowledged consumer horizon.
A lagging consumer therefore prevents premature pruning.

## Resume, reset, and limits

An internal resume token binds application deployment, authority partition,
normalized Query/input identity, wire version, and retained generation. HMAC
tamper, binding mismatch, eviction, and time expiry yield a fresh authorized
reset. A reset replaces client state with a complete Query result.

Accepted default limits are:

| Budget                        |       Default |
| ----------------------------- | ------------: |
| active watches per Principal  |            64 |
| dependency tokens per plan    |           256 |
| complete result bytes         |     1,048,576 |
| buffered bytes per client     |     2,097,152 |
| fanout per batch              |         1,024 |
| unreconciled ledger lag       |     30,000 ms |
| retained tokens per Principal |           128 |
| retained-token age            | 86,400,000 ms |

Hot invalidations coalesce to the latest complete result. A result over its cap
fails rather than truncating. A slow consumer resets or disconnects before an
unbounded buffer forms. Deployed values and the exact limit failure belong in
Runtime/Studio diagnostics in P6.

Independent Queries converge independently. When a screen needs one atomic
view, it defines and watches one composite Query.

## Accepted proof

Proof head `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` passed a replacement fresh
focused Opus-medium review after an earlier hostile review exposed and caused
repair of resume, signature, partition, fanout, managed-role, wake-recovery,
root, and retention gaps.

Canonical P4 digests:

| Artifact           | Digest                                                             |
| ------------------ | ------------------------------------------------------------------ |
| Watchability       | `f66d0d977e7d8e2c8db63ccd19878cf49f557517bec4d64a4e3614a0ac4412f1` |
| Dependency algebra | `ccb39ddbff40d44e72c114e3a6af00052bcf91ee5d2b69251932c0b57141b146` |
| Change Ledger      | `140fd7ffb43699f9b8b2e986446058acfa679d2d18a33214d559c4bcd0c849e7` |
| Reconciliation     | `0c8e66dc1f1ef404f815ebfde97268b326799ce5ba25459b3b8f0ecfcfe236e3` |
| Resume             | `1c7a0eb0a83ea78a447889351da9342cd90830e6deb3bc2c28abe397ec322095` |
| Capture boundary   | `4e0f30ca4727e72bfee8f1452b93a3b8d9e48fdbd787667b35a1294bab7d4cfc` |
| Limits             | `61528429a1fca9131f2458e60ab312c99f95b65a29c4e1ebb278e28612c0793b` |

TypeScript 5.9.2 measured 2,468 types, 3,136 instantiations, 24,116 KiB,
0.41 seconds cold, 0.40 seconds warm, 0.328 ms completion p95, 0.226 ms hover
p95, and 2,878 bytes of generated app/client declarations. The actual fanout
witness recomputed 2,050 watches in batches of 1,024, 1,024, and 2.

PostgreSQL 17.10 reported 13 B-tree indexes, no expressions or predicates,
zero RLS-enabled tables, and zero policies. The terminal capture matrix held 19
facts and 2,613 bytes, with at most 280 bytes per fact. These are proof-host
measurements, not production performance promises.

## Deferred seams

- P5: Transactional Dispatch acceptance, Reaction run-as, attempts, leases,
  fencing, retry/backoff, cancellation, retention, external-effect ambiguity,
  and the minimum Job vertical if its full matrix passes.
- P6: production Runtime/Fetch, generated wire frames, deployment lifecycle,
  Execution Envelope, client transport, and minimal Studio.
- Later: atomic multi-Query publication, persistent offline resume, typed
  Channels/event streams, raw/native SQL reads, partitioned reactive
  Collections, non-B-tree indexes, and broad RLS.

If Live Query SQL performance requires an expression, partial predicate,
operator class, native statement, raw SQL, generic `using`, or non-B-tree
access method, work stops at that named later seam.
