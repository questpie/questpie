# V3 realtime, durable jobs, and workflows audit

> Evidence-only atlas for the QUESTPIE v4 design. This page does not define a
> v4 contract. It audits the repository at commit `11617485` (`v3.26.1`) and
> separates product jobs worth preserving from mechanisms that should not be
> copied unchanged.

## Scope and method

The audit covers Live Query, the Change Ledger, Channels, Queue/Job dispatch,
Workflows, and their operator surfaces. All source citations use the stable
form `11617485:path:Lx-Ly`; line numbers refer to the file as it existed at that
commit. Claims of absence are bounded to the audited first-party source, tests,
and documentation rather than treated as proof about every possible adapter.

The relevant history is not one feature drop. Typed Channels and realtime v2
landed in `018dfb5b`; relational access dependencies were repaired in
`42429a65`; commit-order correctness in `7c43d129`; transactional Queue dispatch
in `a5edc05e`; secret dispatch hardening in `2a1023b4`; resolved Channel
authority invalidation in `e1620ea5`; and the Workflow package originated in
`652f6b79`. The late fixes are important evidence: the desired product behavior
is often stronger than the first mechanism that attempted it.

## Executive finding

V3 is valuable prior art, not a v4 blueprint. Its best ideas are developer
outcomes: a read can become live without a second query language; change capture
is transaction-owned; broker wakes are disposable hints over durable state;
Channels have typed events and explicit authorization; Jobs have typed payloads,
stable logical dispatch identity, and transactional enqueue; Workflows expose a
small step API with persisted history.

The unsafe inheritance points are equally concrete. Live Query observes a
closed CRUD topic grammar rather than an arbitrary Query handler. Framework CRUD
writes call change capture, but raw SQL, database cascades, and external writers
have no demonstrated automatic capture. A live subscription rechecks access
using its original request context rather than resolving fresh identity. Queue
and Workflow execution discard the initiating Principal/Tenant/Authority and run
in system mode. Queue behavior varies by adapter and has no portable dispatched
Job cancellation or dead-letter management surface. Workflow retry metadata is
recorded but `step.run` does not retry; effect completion and step persistence
are separated by a crash window; code version is not stored; and a lost lease
does not stop the still-running handler.

## Live Query and Change Ledger

### Developer API and observable contract

- `client.collections.posts.live(findInput, callback)` returns an unsubscribe
  function, emits the current snapshot immediately, and preserves the ordinary
  `find()` result shape. V3 also says every recomputation runs under the
  subscriber's session
  (`11617485:apps/docs/content/docs/client/realtime.mdx:L13-L40`).
- `liveIter(input, { signal })` offers the same stream as an async iterator;
  refusal and terminal connection errors throw through the iterator
  (`11617485:apps/docs/content/docs/client/realtime.mdx:L99-L123`). TanStack Query
  opts the same generated query into streaming with `{ realtime: true }`, but
  only `find`, `count`, and Global `get` participate
  (`11617485:apps/docs/content/docs/client/realtime.mdx:L138-L164`).
- The supported query grammar is deliberately smaller than `find`: `where`,
  `with`, `limit`, `offset`, `orderBy`, and `locale`; projections, search,
  grouping, stages, and soft-delete controls are excluded
  (`11617485:apps/docs/content/docs/client/realtime.mdx:L54-L68`). The raw seam
  exposes manually constructed `find`, `count`, and `get` topics, but its result
  generic is unchecked
  (`11617485:apps/docs/content/docs/client/realtime/raw-api.mdx:L18-L72`).
- Reconnect is automatic and sends the last observed sequence
  (`11617485:apps/docs/content/docs/client/realtime.mdx:L99-L103`).
  `awaitMutation()`/`awaitTxId()` waits until open topics reach a mutation's
  transaction, but with no open topic the promise can remain pending
  (`11617485:apps/docs/content/docs/client/realtime/raw-api.mdx:L133-L155`).

This is strong client DX, but the observed unit is a framework-defined CRUD
topic, not a semantic Query handler. V4 cannot infer that arbitrary server logic
has the same dependency and replay model merely because the returned type looks
like a collection result.

### Dependency capture

V3 derives dependencies structurally from a topic's requested `with` graph and
its access-merged `where`; it unions collection names and registers listeners by
resource (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1034-L1068`,
`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1098-L1116`).
It does not observe actual reads performed during an arbitrary handler. A change
to a relation or access dependency therefore wakes every topic registered for
that collection, with no predicate guard
(`11617485:apps/docs/content/docs/infrastructure/realtime/scaling.mdx:L171-L179`).
The documented 100,000-subscriber case shows this becomes a bounded backlog,
not a correctness failure, but still forces every candidate to recompute
(`11617485:apps/docs/content/docs/infrastructure/realtime/scaling.mdx:L181-L202`).

### Change capture, wake, and recovery

The durable core is sound:

- A framework CRUD operation appends a resource/operation/id projection through
  `appendRealtimeChange`
  (`11617485:packages/questpie/src/server/collection/crud/shared/realtime.ts:L24-L54`).
  `appendChange` uses the ambient transaction when present, otherwise creates
  one (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L359-L418`).
- The outbox stores a sequence, PostgreSQL transaction id, resource identity,
  operation, record id, routing payload, and settlement timestamp
  (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/collection.ts:L50-L76`).
- A broker publication carries only a notice that the outbox may have advanced
  (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L421-L440`).
  The public broker contract explicitly permits loss, duplication, delay,
  reorder, and coalescing because periodic durable reconciliation supplies
  correctness (`11617485:apps/docs/content/docs/infrastructure/realtime.mdx:L164-L184`).

The commit-order repair is also worth retaining as knowledge. Sequence numbers
are allocated before commit and can invert against transaction order, so the
drain uses a composite `(txid, seq)` cursor below PostgreSQL's snapshot `xmin`
(`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1271-L1338`).
The integration test constructs the inversion and proves both changes are
delivered (`11617485:packages/questpie/test/integration/realtime-drain-cursor-postgres.test.ts:L122-L188`),
while separate cases cover same-transaction ordering, rollback holes, and
resume state (`11617485:packages/questpie/test/integration/realtime-drain-cursor-postgres.test.ts:L190-L256`).

The prior global-head-row solution must not return. V3 records measured capture
throughput falling from 57 to 44 to 35 writes/s at 4, 8, and 16 writers, versus
115 to 145 to 267 without the lock, plus long-transaction starvation and
deadlock risk
(`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L369-L385`).
The final test suite explicitly proves concurrent capture no longer serializes
on that row
(`11617485:packages/questpie/test/integration/realtime-drain-cursor-postgres.test.ts:L481-L510`).

The recovery contract is convergence, not historical result replay. A resuming
client is called current only when the server can prove no later visible
transaction exists; otherwise the topic performs one authoritative recompute
(`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1208-L1251`).
A booting node adopts the newest settled head rather than replaying the retained
log (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1340-L1379`).
Poll reconciliation and a short settlement retry heal missed wakes and changes
held behind an older open transaction
(`11617485:packages/questpie/src/server/modules/core/integrated/realtime/service.ts:L1474-L1569`).
Retention tests prove a stale client receives a reset and an unsettled row is not
pruned early
(`11617485:packages/questpie/test/integration/realtime-drain-cursor-postgres.test.ts:L343-L439`).

Two boundaries are not supplied by v3:

1. Capture is invoked by framework CRUD. The audited mechanism does not show a
   database trigger or logical-decoding path for raw SQL, cascades, another
   service, or manual table writes. Those changes can bypass the ledger.
2. Independent live topics converge independently. Neither the public API nor
   the transport promises one atomic visible transition across four Query
   results even when one database transaction changed all four.

Snapshot delivery should remain the correctness baseline. Native deltas require
a two-phase fleet rollout because an older sequence-only reader can skip rows
created by the newer lock-free writer
(`11617485:apps/docs/content/docs/client/realtime/deltas.mdx:L28-L68`).

### Authorization refresh and context isolation

The scheduler re-evaluates the access rule before each authoritative compute
(`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:L477-L523`,
`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:L2138-L2173`).
That protects relation-backed membership changes when their collection is a
captured dependency. It does **not** mean the Principal or resolved execution
context is refreshed. Both SSE and shared-provider sessions install a
`resolvePrincipal` closure that returns the Principal captured at admission
(`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:L1497-L1501`,
`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:L1858-L1862`),
and the topic compute closes over the initial `baseContext`
(`11617485:packages/questpie/src/server/adapters/routes/realtime.ts:L2077-L2094`).
Credential revocation, changed claims, or a changed Context resolver can
therefore remain stale until reconnect unless an application dependency happens
to force the right denial.

V3's shared-compute history exposes why context identity must be first-class.
Omitting context extensions from the sharing key leaked one workspace's rows to
another tab (`11617485:packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts:L56-L77`).
The repaired provider rebinding still depends on the manually assembled key
covering every value that can affect returned bytes
(`11617485:packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts:L274-L293`).

## Channels

### Developer API and guarantees

V3's Channel surface is coherent. One declaration provides typed event schemas,
typed route parameters, independent subscribe/publish authorization, and an
optional typed presence resolver
(`11617485:apps/docs/content/docs/client/channels.mdx:L10-L43`). A generated,
request-bound server handle validates params and payload, and `publish()` returns
`{ eventId }` for replay/deduplication
(`11617485:apps/docs/content/docs/client/channels.mdx:L72-L107`). The client uses
the same resolved handle for callback subscription, publish, async iteration,
readiness epochs, and presence
(`11617485:apps/docs/content/docs/client/channels.mdx:L159-L231`).

Delivery is durably ordered per resolved Channel, permits duplicate replay but
deduplicates client-side, reports an explicit gap past the bounded replay
horizon, and fails a slow consumer rather than silently dropping ordered events
(`11617485:apps/docs/content/docs/client/channels.mdx:L284-L299`). Reconnect on a
managed transport reauthorizes, drains from the last event id, buffers concurrent
live events, and then releases them in order
(`11617485:apps/docs/content/docs/client/channels.mdx:L249-L278`). The durable
ledger is explicitly delivery infrastructure, not queryable business history
(`11617485:apps/docs/content/docs/client/channels.mdx:L6-L8`).

Authority invalidation is a particularly useful job to preserve: the resolved
Channel plus validated params is the exact target, the subject identifies whose
binding must be checked, and an idempotency key advances a durable generation
before authorization is rerun with a fresh AppContext
(`11617485:apps/docs/content/docs/client/channels.mdx:L109-L143`). The contract is
honest about physical limits: SSE can cut one binding, Pusher/Soketi disconnects
all connections for the Principal, and a frame already accepted by the provider
can still arrive (`11617485:apps/docs/content/docs/client/channels.mdx:L133-L156`).

### Mechanisms not to inherit unchanged

- V3 splits Resource Identity: the filename defines the generated API key while
  the explicit builder string defines the durable wire name
  (`11617485:apps/docs/content/docs/client/channels.mdx:L46-L53`). V4's one
  compiler-owned Resource Identity should not recreate that split.
- Direct provider client events bypass framework authorization, schemas,
  ordering, replay, and rate limits
  (`11617485:apps/docs/content/docs/client/channels.mdx:L280-L281`). This is an
  escape hatch, not a safe core capability.
- Subscribe authorization normally runs only when a subscription opens; changing
  membership does not close it unless application code performs the explicit
  authority invalidation
  (`11617485:apps/docs/content/docs/client/channels/authorization.mdx:L80-L100`).
  The durable invalidation job is worth keeping, but correctness must not depend
  on developers remembering an unrelated root-level call.

## Queue and Jobs

### Developer API and durable dispatch

A Job is one file containing `job({ name, schema, handler, options })`; codegen
creates typed `app.queue.sendWelcomeEmail` and handler-local
`ctx.queue.sendWelcomeEmail` surfaces
(`11617485:apps/docs/content/docs/code/jobs.mdx:L11-L55`). `publish()` validates
at dispatch and worker boundaries, joins an ambient transaction, and returns a
stable `dispatchId`, never the handler result
(`11617485:apps/docs/content/docs/code/jobs.mdx:L57-L78`). The generated per-Job
surface is `publish`, `schedule`, and `unschedule`; importantly, `unschedule`
cancels schedules, not an already dispatched Job
(`11617485:apps/docs/content/docs/code/jobs/dispatching.mdx:L8-L16`,
`11617485:apps/docs/content/docs/code/jobs/dispatching.mdx:L55-L62`).

Portable idempotency hashes `(jobName, idempotencyKey)` into a stable UUID and
persists a unique reservation
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/dispatch-store.ts:L46-L78`,
`11617485:packages/questpie/src/server/modules/core/integrated/queue/dispatch-store.ts:L94-L137`).
The relay claims pending rows with `FOR UPDATE SKIP LOCKED`, an expiring lease,
and a lease token; failed publication retries up to 25 times with exponential
backoff capped at one hour, then retains a terminal failed row
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/dispatch-store.ts:L521-L577`,
`11617485:packages/questpie/src/server/modules/core/integrated/queue/dispatch-store.ts:L646-L765`).
Tests cover rollback atomicity, crash-after-commit recovery, duplicate logical
dispatch, uncertain broker acceptance under the same `dispatchId`, expired
leases, and retained terminal failure
(`11617485:packages/questpie/test/integration/queue-transactional-dispatch.test.ts:L143-L220`,
`11617485:packages/questpie/test/integration/queue-transactional-dispatch.test.ts:L310-L410`).

The guarantee remains at-least-once. A crash after broker acceptance but before
receipt persistence can create another physical delivery, and handler side
effects remain the developer's idempotency responsibility
(`11617485:apps/docs/content/docs/infrastructure/queue/transactional-dispatch.mdx:L14-L35`).

### Failure mechanisms and lost identity

The dispatch table records Job name, payload, options, status, attempts, lease,
adapter id, error, and timestamps, but no initiating Principal, Tenant,
Authority, resolved Context, or trace carrier
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/dispatch-table.ts:L34-L96`).
The worker creates a fresh context, explicitly forces `accessMode: "system"`, and
runs with whatever default session/locale that context supplied
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/service.ts:L185-L270`).
The docs confirm that the caller's locale does not travel, the handler session is
null, and access rules are skipped
(`11617485:apps/docs/content/docs/code/jobs.mdx:L80-L103`). This is not merely a
missing convenience: an on-behalf-of Job has lost the identity needed to apply
the same authority later.

V3 also exposes two transaction routes. An adapter with
`publishInTransaction` writes directly through the business transaction; other
adapters persist an intent for the framework relay
(`11617485:packages/questpie/src/server/modules/core/integrated/queue/service.ts:L690-L739`).
The docs acknowledge observable behavior changes when the adapter changes
(`11617485:apps/docs/content/docs/infrastructure/queue/transactional-dispatch.mdx:L8-L29`).
Broker-native `singletonKey`, queue policy, priority ordering, retry limits, and
expiration vary further by adapter
(`11617485:apps/docs/content/docs/code/jobs/dispatching.mdx:L64-L109`).

There is no portable audited API to cancel one dispatched Job, pause it, move a
terminal dispatch to a dead-letter queue, or requeue the same receipt. Terminal
relay failure is finite and requires a new `idempotencyKey` for another logical
attempt (`11617485:apps/docs/content/docs/infrastructure/queue/transactional-dispatch.mdx:L48-L57`).
Recovery also needs an external execution opportunity; a quiet serverless queue
can leave a committed intent waiting until a cron or later delivery invokes a
drain (`11617485:apps/docs/content/docs/infrastructure/queue/transactional-dispatch.mdx:L59-L98`).

## Workflows

### Developer API and history model

The first-party package has no corresponding public guide at the audited commit;
the contract is carried by source, examples, tests, and its Admin plugin.
`workflow()` is an identity function for type inference and codegen discovery.
A file under `workflows/` defines `name`, input schema, and a handler receiving
`{ input, step, ctx, log }`
(`11617485:packages/workflows/src/server/workflow/define-workflow.ts:L3-L44`).
The step surface is small and useful: cached `run`, durable `sleep`/`sleepUntil`,
`waitForEvent`, child `invoke`, and `sendEvent`
(`11617485:packages/workflows/src/server/workflow/types.ts:L130-L182`). The typed
runtime client provides `trigger`, `cancel`, `getInstance`, `getHistory`,
`sendEvent`, `cancelAll`, and `retryAll`
(`11617485:packages/workflows/src/server/client.ts:L130-L194`).

Execution loads persisted steps, replays the handler, returns completed step
results from cache, and persists instance completion, suspension, or failure
(`11617485:packages/workflows/src/server/engine/engine.ts:L117-L208`). Step-name
order is checked against the prior execution and duplicate names are rejected
(`11617485:packages/workflows/src/server/engine/step-context.ts:L523-L552`); the
test proves reordered named steps fail as nondeterministic
(`11617485:packages/workflows/test/engine/replay.test.ts:L321-L355`). An
owner-token lease with status and expiration predicates prevents ordinary
duplicate deliveries from claiming the same active instance
(`11617485:packages/workflows/src/server/modules/workflows/jobs/_execution-lock.ts:L241-L308`),
and tests cover requeue behind an owned lease, terminal duplicate suppression,
and expired-lease takeover
(`11617485:packages/workflows/test/jobs/wf-execute.test.ts:L126-L217`).

### Durability, versioning, cancellation, and context holes

The strongest Workflow claims are not actually met by the implementation:

1. `step.run` calls the arbitrary effect first and persists completion second.
   A process crash in between repeats the effect on replay
   (`11617485:packages/workflows/src/server/engine/step-context.ts:L182-L250`).
   This is replay-safe only when the effect itself is idempotent or transactionally
   coupled to step persistence.
2. `retry.maxAttempts` is calculated and stored, but the implementation executes
   `fn()` once; on failure it persists `failed` and immediately rethrows
   (`11617485:packages/workflows/src/server/engine/step-context.ts:L198-L275`).
   The option test verifies only that `maxAttempts` was recorded, not that a retry
   occurred (`11617485:packages/workflows/test/engine/step-run.test.ts:L65-L77`).
3. The Workflow definition and instance store a name, input, status, attempts,
   hierarchy, lease, and timestamps, but no code/schema version
   (`11617485:packages/workflows/src/server/workflow/types.ts:L99-L124`,
   `11617485:packages/workflows/src/server/workflow/types.ts:L311-L341`). Changing
   logic inside an existing named step silently returns the old cached result;
   only changed step order is detected. There is no audited migration/version
   selection contract.
4. The execution lease heartbeat only logs renewal failure and does not abort or
   fence the running handler
   (`11617485:packages/workflows/src/server/modules/workflows/jobs/_execution-lock.ts:L396-L425`).
   After expiry, another worker can claim the instance while the first continues:
   the lease prevents common duplicates but cannot guarantee single execution
   under lease loss.
5. `cancel()` is documented as compare-and-swap but performs a read, checks the
   status in memory, then updates by id without a status/owner predicate
   (`11617485:packages/workflows/src/server/client.ts:L284-L315`). It neither
   fences an already-running arbitrary effect nor cancels the broker delivery.
   Bulk cancel/retry are limited to 1,000 rows and swallow individual errors
   (`11617485:packages/workflows/src/server/client.ts:L336-L421`).
6. Trigger idempotency is a check-then-create sequence
   (`11617485:packages/workflows/src/server/client.ts:L213-L279`), while the
   collection has a global unique index on `idempotencyKey`, not the checked
   `(name, idempotencyKey)` pair
   (`11617485:packages/workflows/src/server/modules/workflows/collections/wf-instance.ts:L47-L53`).
   Concurrent triggers can conflict instead of deterministically returning the
   existing instance, and the same key cannot be intentionally reused by two
   Workflow definitions.

Workflow execution is itself a Queue Job
(`11617485:packages/workflows/src/server/modules/workflows/jobs/wf-execute.ts:L1-L50`).
Its instance record contains no initiating Principal, Tenant, Authority, or
resolved execution context
(`11617485:packages/workflows/src/server/modules/workflows/collections/wf-instance.ts:L11-L46`).
All Workflow persistence operations shown in the executor use system access
(`11617485:packages/workflows/src/server/modules/workflows/jobs/wf-execute.ts:L114-L160`).
It therefore inherits the Queue's lost-identity problem: `ctx` is broad, but it
is not a durable reconstruction of who initiated the Workflow and under what
authority.

## Studio and operator visibility

Workflows have the only substantial first-party operator surface in this audit.
The Admin list polls, filters by status, paginates, and shows name, start time,
duration, and attempt
(`11617485:packages/workflows/src/client/pages/workflow-list-page.tsx:L76-L109`,
`11617485:packages/workflows/src/client/pages/workflow-list-page.tsx:L171-L223`).
The detail view fetches instance, steps, and optional logs, and exposes cancel or
retry based on current status
(`11617485:packages/workflows/src/client/pages/workflow-detail-page.tsx:L251-L330`).
It renders input/output, an ordered step timeline, errors, and stored logs
(`11617485:packages/workflows/src/client/pages/workflow-detail-page.tsx:L348-L515`).

Realtime exposes metrics and an observer for routing candidates, authoritative
database reads, delivery mode, refreshes, and frame bytes, but the audited core
has no dedicated operator UI for the Change Ledger, subscriptions, gaps, or
replay (`11617485:apps/docs/content/docs/infrastructure/realtime/scaling.mdx:L208-L224`).
Queue exposes bounded `queue.drain()` counts and structured terminal logs
(`11617485:apps/docs/content/docs/infrastructure/queue/transactional-dispatch.mdx:L77-L98`),
but no first-party Admin page for ordinary Job attempts, leases, cancellation,
terminal dispatches, or requeue. The durable rows exist; the operator contract
does not.

## Keep-jobs

These are product jobs or observable outcomes that v4 should preserve while its
own ADRs decide the API and mechanism:

1. Turn one typed read into an immediate snapshot plus future replacements, with
   callback, async-iterator, and query-cache integrations and explicit teardown.
2. Capture committed changes transactionally; treat wakes as lossy hints; recover
   from durable state; expose lag, gaps, reset, and bounded backpressure honestly.
3. Track every dependency that can change a result, including Policy/Authority
   reads, and rerun authorization before delivery.
4. Keep Channels as typed, schema-validated, per-Resource ordered events with
   separate subscribe/publish authority, bounded replay, readiness, and explicit
   authority invalidation.
5. Dispatch typed Jobs inside the owning Mutation transaction, return stable
   logical identity, lease recovery work, retry with bounds, and surface a
   terminal state. Keep at-least-once semantics explicit.
6. Give Workflows a compact handler API, durable named steps, sleep/wait/invoke,
   persisted history, replay, cancellation intent, and operator-visible state.
7. Carry one durable execution identity/envelope through request, Mutation,
   realtime refresh, Job, and Workflow boundaries so authority and observability
   are reconstructable rather than ambient or silently discarded.
8. Make Studio visibility a consumer of the same execution records: attempts,
   leases, retry decisions, dead letters, cancellation, replay gaps, Workflow
   steps, and logs should not require a parallel builder architecture.

## Reject or replace these mechanisms

1. Do not make CRUD topic syntax the dependency model for arbitrary Query
   handlers, and do not assume framework CRUD hooks capture raw SQL, cascades, or
   external writers.
2. Do not use a fleet-wide row lock to forge commit order. Preserve the measured
   composite-cursor lesson or choose a database-native change mechanism.
3. Do not describe per-topic snapshot convergence as cross-query atomic replay.
4. Do not reuse an admission-time Principal or a manually guessed compute-sharing
   key as authorization refresh.
5. Do not split generated API identity from durable wire identity, or elevate
   provider-bypass client events into the safe Channel contract.
6. Do not let Queue transaction guarantees, retry interpretation, identity, or
   deduplication change materially with the adapter. Broker-native knobs can be
   advanced configuration, not the semantic center.
7. Do not call schedule removal Job cancellation, or call a retained failed row
   a dead-letter workflow without inspect/retry/discard APIs and Studio support.
8. Do not run Jobs or Workflows under accidental system authority after dropping
   the initiating Principal/Tenant/Authority. System execution must be an
   explicit choice in the durable envelope.
9. Do not claim Workflow step retries, cancellation CAS, single execution, or
   version-safe replay until the implementation and failure tests prove them.
10. Do not treat inline compensation callbacks as independently durable
    compensation history; after a process crash, only persisted step facts are
    trustworthy.

## Questions this audit intentionally leaves to v4 authority

- Whether Change Ledger capture uses database triggers, logical decoding, a
  compiler-owned write path, or a hybrid.
- How a semantic Query declares or records dependencies, and whether a set of
  Queries can expose one transaction-consistent client transition.
- The exact shape and refresh lifecycle of the durable execution envelope.
- Whether Channels, Jobs, and Workflows are separate Resource kinds or projections
  of a shared execution/event substrate.
- The portable Job cancellation, dead-letter, retry, and receipt APIs.
- Workflow version pinning, migrations, effect idempotency, fencing, and the
  transaction boundary between step result and business effects.

Those are design inputs for later ADRs. The evidence here narrows them; it does
not resolve them.
