# BETA-07 implementation context

- Status: implementation decision record for issue #294
- Base: `c193e7e5c566852e571944c5f360c98be7240770`
- Authority: ADR-0012, ADR-0014, ADR-0017, ADR-0021,
  `docs/v4/live-query-and-change-ledger.md`, and
  `docs/v4/multi-instance-and-optional-acceleration.md`

## Bounded outcome

BETA-07 makes the existing network Query `messages.page` watchable. The same
generated method keeps its one-shot call and adds `.watch(input, callback,
options?)`. A watch delivers complete validated `initial`, `update`, or
`reset` results. It never publishes patches, Change Ledger facts, Policy
evidence, or resume-token bytes to application code.

The tracer starts one authorized Message page watch, commits a Message, loses
the wake and crashes the owning Runtime before it can refresh, then reconnects
through a fresh Runtime. PostgreSQL reconciliation must discover the committed
fact without the hint, create a fresh root Execution, re-resolve Context and
current Policy, and deliver the complete new page exactly once. Membership
revocation publishes no subsequent result.

This slice does not add Channel, WebSocket, Redis or another broker,
cross-Query atomic convergence, Reaction execution, Studio, raw-SQL read
watchability, partitioned reactive Collections, non-B-tree authoring, or RLS.

## Public seam

Only compiler-proven watchable Queries receive the accepted generated shape:

```ts
interface WatchableQueryMethod<Input, Output> {
	(input: Input, options?: OperationCallOptions): Promise<Output>;
	watch(
		input: Input,
		callback: (result: Output, delivery: QueryDelivery) => void,
		options?: WatchOptions,
	): () => void;
}
```

`WatchOptions` contains cancellation and state/error callbacks, not a resume
token. The generated client owns the opaque token and acknowledgement. An
unsupported raw read remains callable once and receives no `.watch` member.

## Compiler-owned projections

BETA-07 materializes the seven accepted P4 v1 contracts without redefining
their meaning:

- `questpie.query-watchability`;
- `questpie.live-query-dependency-algebra`;
- `questpie.change-ledger`;
- `questpie.change-reconciliation`;
- `questpie.live-query-resume`;
- `questpie.change-capture-boundary`; and
- `questpie.live-query-limits`.

The watchability projection binds `query:messages.page`, its existing exact
input/output contract, compiler-declared observation slots, and Runtime-observed
reads. Runtime Build inventories their exact bytes and binds Change Ledger,
resume, and a sibling realtime-wire digest. Operation Wire v2 and Mutation
semantics stay byte-compatible.

The Message page observation plan can record only reads reached by the actual
execution: the Membership Context bootstrap key, Tenant partition, Message
range/order/cursor/`first + 1` sentinel, Channels/Spaces/Companies/Memberships
Policy evidence, and the author Membership Relation endpoint or miss.
`messageEvents` is not a Query dependency. Conservative Collection-level
matching is allowed where an exact key is unavailable, but false negatives are
not.

A successful complete recomputation atomically replaces its prior observed
plan. Failure, cancellation, or revocation preserves the last successful plan
and publishes no partial or unauthorized result.

## PostgreSQL ownership

The immutable internal protocol v2 remains unchanged. BETA-07 adds an
advisory-lock-protected protocol v3 upgrade. Fresh bootstrap and v2 upgrade
converge to one exact catalog. Protocol v3 owns application-qualified Change
Ledger facts, reconciliation consumers and their exclusive `xid8` horizons,
processed effects, successful dependency/result generations, retained resume
state, acknowledgements, and expiry metadata.

Compiler-owned row and truncate triggers are installed only by reviewed
application migration `000004_watch-message-query`. Runtime readiness never
silently applies an application migration. The trigger function may live under
`questpie_internal`, but each application-table trigger and its arguments are
derived from the compiled capture projection and are fingerprinted exactly.
The ordinary Schema Projection must continue to reject every unmanaged trigger.

Supported capture includes framework and raw DML, managed external writers,
foreign-key cascades, `COPY`, `ON CONFLICT`, PostgreSQL 16-compatible `MERGE`,
and `TRUNCATE`. Rollback and zero-row statements append nothing. For one
transaction and Collection, the seventeenth row fact replaces the row set with
one conservative Collection fact. A fact owns a UUID identity, full `xid8`,
Collection identity, `insert|update|delete|truncate`, bounded canonical old/new
keys or the conservative marker, and transaction time.

The managed writer role can change reactive business tables through installed
capture but cannot read or mutate internal state, disable triggers, change
replication role, or acquire superuser/replication authority. Partitioned
reactive Collections fail closed. Trigger drift fails readiness.

## Commit-safe reconciliation

`LISTEN`/`NOTIFY` is only a lossy wake. Startup orders listener establishment
and commit, durable reconciliation, then hint consumption. Duplicate,
coalesced, reordered, delayed, or absent hints never create or skip authority.

Each consumer persists an exclusive `xid8` visibility horizon. In one pinned
transaction, reconciliation locks the consumer, selects unprocessed visible
facts satisfying `prior <= transaction_id < pg_snapshot_xmin(snapshot)`,
records their effects, and advances the horizon atomically. It never advances
by maximum fact identity, local sequence, timestamp, or trigger XID. A failed
recomputation cannot strand an advanced frontier without durable retry work.

Retention removes facts only below the minimum acknowledged consumer horizon.
A lagging live consumer prevents premature pruning. Sequence wrap is explicitly
non-authoritative; PostgreSQL full transaction identity remains the frontier.

## Realtime carrier and resume

BETA-07 freezes a sibling `questpie.realtime-wire` v1 artifact. It uses one
bounded multiplexed SSE downstream per immutable client scope and Fetch/POST
upstream commands. The closed upstream command kinds are `open`, `ack`, and
`close`; the downstream frame kinds are `ready`, `delivery`, `failure`, and
`closed`. A delivery contains the binding and Query identities, complete
validated result, delivery kind, optional reset reason, and an opaque token
consumed only by the generated client.

The token is authenticated and binds application deployment, authority
partition, normalized Query and input identity, realtime/wire version, and
retained generation. Tamper, binding mismatch, eviction, and expiry create a
fresh authorized reset without an oracle. The client acknowledges only after
accepting the complete result. Connection and buffer state is disposable;
retained correctness remains PostgreSQL-owned and requires no affinity.

Resume signing material is deployment input, not a generated fixture secret or
public application capability. BETA-07 supports current deployment-local
resume only; persistent offline resume remains absent.

## Limits and lifecycle

The accepted defaults are enforced: 64 active watches per Principal, 256
dependency tokens per plan, 1,048,576 result bytes, 2,097,152 buffered bytes
per client, 1,024 fanout per batch, 30,000 ms unreconciled lag, 128 retained
tokens per Principal, and 86,400,000 ms retained age.

Hot invalidations coalesce to the latest complete result. Slow consumers reset
or disconnect before an unbounded buffer forms. Runtime readiness remains false
until durable startup reconciliation completes. Drain refuses new watches,
finishes bounded work, then closes active SSE bodies with a retryable reset
before disposing PostgreSQL listener and application resources.

## First tracer and evidence

The first RED is `tests/integration/beta07-live-query.test.ts`: “reconciles a
committed Message after lost wake and Runtime crash with fresh Context
authority.” It must cross the real collaboration compilation, generated client,
SSE/POST carrier, accepted Message Query and Mutation, PostgreSQL capture, and a
second Runtime. Deterministic latches surround commit, wake consumption, and
restart; no timing sleep is evidence.

Focused evidence then adds compiler artifact/type negatives, exact internal-v3
catalog and migration bytes, dependency replacement/failure tests, the full
PostgreSQL 16/17/18 capture/frontier matrix, resume tamper/reset, retention,
2,050-watch fanout batches `[1024, 1024, 2]`, all accepted limits, and an honest
PG17 selected-PR invalidation microbenchmark.

## Explicit absences

No provider registry, `LedgerStore`, broker SPI, second Query/SQL/canonical
kernel, public resume-token input, raw ledger access, application-authored
trigger SQL, hidden migration apply, Channel, WebSocket, Redis, cross-Query
atomicity, durable Reaction worker, Studio, RLS, or generic realtime Definition
enters BETA-07.
