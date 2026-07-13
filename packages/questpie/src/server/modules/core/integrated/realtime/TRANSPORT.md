# Realtime v2 transport contract

Status: accepted RT1.1 design gate after adversarial grill on 2026-07-13. This
document is normative for the transport extraction. It covers all fifteen
invariants in Part H of the Realtime v2 + Channels analysis.

## Goals and boundaries

Realtime v2 has one runtime composed from two independent seams:

- `ChangeBroker` wakes application instances when durable change state may have
  advanced. It never carries an access-controlled snapshot or a channel event.
- `ClientTransport` delivers already-authorized frames to one edge session. It
  does not query collections, resolve access, or subscribe to the change broker.

The runtime between them owns the outbox drain, topic admission, refresh
scheduling, access-equivalence keys, replay, and QoS policy. Calling this
composition a single transport is convenient in runtime config, but drivers must
not implement a single interface that combines the two seams.

Channels remains a thin semantic layer over the same runtime. The framework has
two first-class presets: SSE-native and Soketi/Pusher. A preset supplies the two
seams and client capabilities; switching presets is a runtime-config change, not
a change to live-query or `channel()` definitions.

This design does not add queryable channel history, collaborative editing,
binary events, or an in-process WebSocket server. A short-lived channel replay
log is delivery infrastructure, not an application message store. Applications
that need history persist messages in a collection.

## Terminology

- **Outbox**: transactionally captured collection/global changes, ordered by
  `seq`. It is the durable truth for live-query invalidation.
- **Wake**: a lossy hint that tells an instance to drain durable state.
- **Edge session**: one authenticated client-delivery session, independent of
  the physical SSE or managed-WS connection.
- **Principal**: the resolved authenticated session. Anonymous requests are
  isolated by edge-session id.
- **Topic**: one operation-aware live query (`find`, `count`, or `get`).
- **Resolved channel**: a channel definition plus concrete, validated params,
  producing one transport-safe wire name.
- **Access-equivalence key**: the scheduler key proving which requests may reuse
  one computed snapshot.

## Seam 1: `ChangeBroker`

The interface is deliberately smaller than today's `RealtimeAdapter`:

```ts
export type ChangeWake =
	| {
			kind: "outbox-maybe-advanced";
			/** Optional optimization only; never trusted as a complete cursor. */
			highWaterSeq?: number;
			reason: "publish" | "reconnect" | "reconcile";
	  }
	| {
			kind: "channel-events-maybe-advanced";
			/** Opaque routing hint, not a payload or authorization key. */
			channelHash?: string;
			highWaterEventId?: string;
			reason: "publish" | "reconnect" | "reconcile";
	  };

export interface ChangeBroker {
	start(input: {
		onWake: (wake: ChangeWake) => void;
		onError: (error: unknown) => void;
	}): Promise<void>;
	publish(wake: ChangeWake): Promise<void>;
	stop(): Promise<void>;
}
```

The wake contract is **unordered, at-most-once, and coalescable**. Duplicate,
missing, delayed, and reordered wakes are legal. Payloads are notice-sized and
contain no records, snapshots, channel payloads, session data, or authorization
decisions. Correctness therefore never depends on a wake being delivered.

Every app instance starts its broker during app startup, including workers and
instances with no local subscribers. Startup is idempotent. `stop()` is awaited
during app shutdown. A broker reconnect emits one `reason: "reconnect"` wake;
the runtime immediately drains from its lag-window cursor.

The runtime also schedules unconditional slow reconciliation while a broker is
active. It drains both durable sources: the live-query outbox and the channel
delivery ledger. An outbox drain reads rows, rescans a configurable lag window
behind the last observed sequence, deduplicates by `seq`, and advances a cursor
only after local dispatch. A channel drain follows the ordered-ledger rules
below. These drains are the guarantee; broker delivery is only the latency
optimization.

Mutation capture and notification have different durability requirements:

1. append exactly one outbox row per logical mutation inside the business
   transaction, using its transaction-bound database client;
2. commit the business transaction and outbox row together;
3. call `ChangeBroker.publish()` after commit, off the response path, with an
   attached rejection handler and observable failure;
4. let reconciliation recover any missed post-commit publish.

## Seam 2: `ClientTransport`

The edge seam receives serialized protocol frames. It cannot see CRUD objects or
execute application code.

```ts
export type DeliveryClass = "latest-snapshot" | "ordered-channel-event";

export type SinkWriteResult =
	| { status: "accepted"; bufferedBytes: number | null }
	| { status: "busy"; bufferedBytes: number };

export interface ClientSink {
	readonly sessionId: string;
	write(frame: Uint8Array, delivery: DeliveryClass): Promise<SinkWriteResult>;
	close(reason: ClientCloseReason): Promise<void>;
}

interface ClientTransportBase {
	start(input: { onError: (error: unknown) => void }): Promise<void>;
	openSession(input: EdgeSessionInput): Promise<ClientSink>;
	getClientConfig(input: ClientConfigInput): Promise<ClientTransportConfig>;
	stop(): Promise<void>;
}

export interface LocalSessionClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "local-sessions";
}

export interface SharedProviderClientTransport extends ClientTransportBase {
	readonly channelDeliveryScope: "shared-provider";
	publishChannel(input: OrderedChannelDelivery): Promise<SinkWriteResult>;
}

export type ClientTransport =
	LocalSessionClientTransport | SharedProviderClientTransport;
```

`EdgeSessionInput` carries the initial resolved principal and a
`resolvePrincipal()` callback. The runtime uses that callback on reconnect and
on its coarse revalidation timer; a transport cannot keep an immutable session
snapshot forever.

`write()` returning `busy` is not a write failure. The runtime applies the QoS
policy below. A rejected/thrown write, provider failure, abort, or failed health
check is terminal: the runtime removes every topic and channel listener for the
edge session, clears queued frames, unregisters admission counters, and closes
the sink. Teardown is idempotent.

Runtime-owned sinks report buffered bytes. A managed provider may return
`bufferedBytes: null` because it does not expose a remote client's socket buffer;
it must not fabricate zero. The shared runtime owns one keep-alive ticker for
runtime-owned sinks, so an SSE sink does not allocate its own interval. Managed
WS uses the provider heartbeat. A client ping watchdog treats a half-open
connection as failed.

The SSE-native implementation has `channelDeliveryScope: "local-sessions"` and
maps a sink to a stream controller. Incremental control uses an authenticated
companion request keyed by the edge-session id; adding or removing a topic does
not recreate the SSE stream. The Pusher/Soketi implementation has
`channelDeliveryScope: "shared-provider"`, maps live-query sinks to per-session
private delivery, implements `publishChannel()` for native multicast, and
returns the managed-WS client config from `getClientConfig()`.

## QoS classes

### Live-query snapshots: coalescable latest-wins

Live-query delivery is state synchronization, not an event log.

- At most one refresh runs for a scheduler key.
- A wake during a refresh marks the key dirty; the next refresh uses the latest
  observed outbox sequence.
- Identical serialized snapshots are hash-suppressed.
- When a sink is busy, its pending frame for that topic is replaced by the newer
  frame. Older snapshot frames may be dropped.
- The client ignores a snapshot whose `seq` is lower than its applied sequence.
- Write failure tears down the session; reconnect resumes from the last applied
  sequence.

### Framework channel events: ordered and non-coalescable

Validated, server-mediated channel publishes use a bounded operational replay
log. Ordering cannot use an unconstrained database sequence because sequence
allocation and transaction commit order may differ. Instead, publish locks a
head row for the resolved-channel hash, increments its channel-local sequence,
and inserts the event in the same transaction. The next publisher cannot
allocate until the prior transaction commits or rolls back. The resulting
`eventId` is monotonic in committed publish order for that resolved channel.
Only after commit does publish emit a notice-only broker wake.

Delivery depends on the client transport's declared scope:

- `local-sessions`: every app instance drains in `eventId` order and fans out
  only to its local member sinks. Duplicate wakes are deduped by the local
  cursor; there is no global lease because each instance owns different sinks.
- `shared-provider`: one leased coordinator per resolved channel drains and
  calls `publishChannel()` in order; another instance resumes after lease loss.
  This prevents multiple app instances from multiplying one event on the same
  global provider channel.

Every instance may observe the coalescable wake. Scope changes coordination, not
the ordered ledger or client dedupe contract.

- Events for one resolved channel are delivered in `eventId` order.
- Duplicate event ids are legal across reconnects; clients deduplicate by id.
- Events are never replaced or coalesced.
- A busy sink queues ordered events up to both an event-count and byte limit.
- Crossing either limit closes the session with `slow_consumer`; it never drops
  an event and silently continues.
- Reconnect supplies the last applied event id. Events still inside replay
  retention are resent in order.
- If the requested event id is older than replay retention, the server sends an
  explicit `channel_gap` frame and closes that channel subscription. There is no
  invented snapshot for an arbitrary event stream. The application recovers
  from its persisted collection or deliberately subscribes from "now".

The replay log is not exposed for history queries and has a bounded retention
and size. Applications needing durable chat/message history use collections.
Implementation ownership is RT3.1b; RT3.3 publish routes and the cross-driver
matrix cannot land without it.

Direct Pusher client events are outside this QoS class. They are disabled by
default and, when explicitly enabled by the channel security model, are
best-effort, unvalidated, non-replayable, and use a distinct event namespace.
They must never masquerade as framework-validated channel events.

## Live-query topic contract

The public topic is a discriminated union. Invalid combinations are rejected
before a scheduler entry or broker listener is created.

```ts
export type RealtimeTopic =
	| {
			kind: "collection";
			operation: "find";
			resource: string;
			where?: Record<string, unknown>;
			with?: Record<string, unknown>;
			limit?: number;
			offset?: number;
			orderBy?: Record<string, "asc" | "desc">;
			locale?: string;
	  }
	| {
			kind: "collection";
			operation: "count";
			resource: string;
			where?: Record<string, unknown>;
			locale?: string;
	  }
	| {
			kind: "collection";
			operation: "get";
			resource: string;
			id: string;
			with?: Record<string, unknown>;
			locale?: string;
	  }
	| {
			kind: "global";
			operation: "get";
			resource: string;
			with?: Record<string, unknown>;
			locale?: string;
	  };

export type AddTopicFrame = {
	type: "add_topic";
	topicId: string;
	topic: RealtimeTopic;
	sinceSeq?: number;
};

export type RemoveTopicFrame = {
	type: "remove_topic";
	topicId: string;
};
```

`topicId` is unique within an edge session. Normalized topic content, not a
truncated hash, forms the scheduler topic key. An add is admitted and authorized
before registration. A remove immediately cancels queued work and releases its
reference to the scheduler entry. Re-adding the same id replaces nothing: the
client must remove first or receives a conflict error.

Snapshots use `{ type: "snapshot", topicId, seq, data, reset }`. `count` returns
a number and never fetches documents. `get` returns one access-filtered record or
`null`. `find` returns the existing paginated result shape.

On resume, the runtime compares `sinceSeq` with the retained outbox horizon:

- cursor inside retention: drain and compute the current operation result;
- cursor missing: initial full snapshot;
- cursor older than retention or otherwise unverifiable: forced full snapshot
  with `reset: true` at the current sequence.

No code path treats an unavailable cursor as caught up. Resume never produces a
silent gap.

## Refresh scheduler and access equivalence

The scheduler key is `(normalizedTopic, accessEquivalenceKey)`. It computes and
serializes one result for all sinks holding the same key, then fans out immutable
bytes. Record pre/post scalar projections in the outbox are used to avoid a
refresh only when they prove an update/delete cannot affect the topic; uncertain
matches refresh.

The default access-equivalence key is session-scoped:

- authenticated requests use the resolved session id plus locale, stage, and
  access mode;
- anonymous requests use the edge-session id plus locale, stage, and access
  mode;
- missing or unstable session identity falls back to the edge-session id.

It is deliberately not keyed by user id: two sessions for one user can carry
different roles, claims, or hook context. Row access, field access, and
`afterRead` hooks all run using the same resolved context as a normal CRUD call.

Cross-principal sharing requires an explicit deterministic access-cache-key
resolver on the collection/global definition. The resolver's return value joins
the locale/stage/access-mode dimensions; throwing or returning no key falls back
to the default. Opt-in asserts that row access, field access, and `afterRead`
output are equivalent for every principal returning that key. There is no global
"public" shortcut inferred from a boolean collection access rule.

Before a query, `beforeOperation` hook, or listener registration, admission
evaluates the resource's normal read-access rule with the resolved request
context. `false` rejects the topic; an access `where` constraint is retained for
the later operation. Only an admitted topic runs its first bounded operation
through the normal CRUD query, field-access, hook, and `afterRead` pipeline.
Access is reevaluated before each refresh, on reconnect, and after coarse session
revalidation. Permanent denial rejects/removes only that topic instead of
running hooks or creating a per-event error loop.

Every principal revalidation invalidates that edge session's cached scheduler
result even when the session id is unchanged; changed roles or claims must not
reuse bytes computed under the earlier session snapshot.

The acceptance suite must include three adversarial two-principal tests:

1. row access returns different records for the same normalized topic;
2. field access redacts a field for only one principal;
3. `afterRead` derives different output from session data.

Each test must prove one compute cannot fan bytes across principals by default,
and must also cover an explicit safe shared key.

## Admission control

Admission happens before listener registration and before unbounded work. The
runtime config exposes finite limits with safe defaults:

```ts
export type RealtimeAdmissionConfig = {
	maxTopicsPerConnection: number;
	maxConnectionsPerPrincipal: number;
	maxFindLimit: number;
	maxWithDepth: number;
	initialSnapshotConcurrency: number;
	maxBufferedSnapshotBytes: number;
	maxBufferedChannelEvents: number;
	maxBufferedChannelBytes: number;
};
```

Every `find` receives a finite effective limit no greater than `maxFindLimit`.
Relation depth is measured after normalization. Initial computations use the
bounded concurrency pool. Per-principal counters are released by every teardown
path. A batch with some rejected topics keeps admitted topics alive and emits
per-topic errors; a request with no admitted topics fails before opening a sink.

The initial defaults are normative and may be changed only with benchmark and
compatibility evidence:

| Limit                                               | Default |
| --------------------------------------------------- | ------: |
| topics per edge session                             |      20 |
| edge sessions per principal per app instance        |       5 |
| effective `find` limit                              |     100 |
| `with` relation depth                               |       3 |
| concurrent initial computations per edge session    |       4 |
| queued latest-snapshot bytes per edge session       |   1 MiB |
| queued ordered channel events per edge session      |     100 |
| queued ordered channel-event bytes per edge session |   1 MiB |

The connection count is explicitly per app instance; exact distributed rate
limiting is outside this program. Provider account/channel limits and RT2.0
security caps are additional constraints, never replacements for local limits.

Frames are size-checked before enqueue. A single snapshot larger than the
snapshot byte cap emits a terminal error for that topic and removes it; it is not
placed in a permanently busy queue. RT2.0 defines an event-payload cap enforced
before a channel event enters the ordered ledger.

Authorization is fail-closed. Topic validation and access errors are not
transport failures. Repeated protocol violations or admission-limit violations
close the edge session.

## Protocol and privacy

Logical client control frames are `add_topic`, `remove_topic`, channel
subscribe/unsubscribe, and channel resume. Physical encoding may be SSE control
HTTP or managed-WS APIs, but authorization and state transitions are identical.
Server frames are versioned and include `snapshot`, `channel_event`,
`channel_gap`, `topic_error`, `ping`, and terminal `close`.

Live-query data is private by construction:

- `ChangeBroker` carries notice metadata only.
- SSE writes the authorized result only to the requesting edge session.
- Pusher/Soketi live queries use a per-session private channel. For this driver,
  the latest-wins frame is an invalidation cursor rather than snapshot bytes; the
  client refetches with normal authorization. An ACL'd snapshot never rides a
  shared Pusher channel.
- Scheduler sharing changes computation reuse, never the destination ACL.

Framework channel events may multicast only after event-schema validation,
resolved-channel authorization, and server-mediated publish authorization.

## Channel naming and codegen contract

The builder string is the stable wire pattern:

```ts
export default channel("chat-room-[roomId]");
```

`[param]` uses the repo-native bracket syntax. Literals and resolved parameter
values must satisfy the transport-safe Pusher-compatible alphabet; slashes,
whitespace, control characters, and unresolved brackets are rejected. The
resolved name is checked against the driver's byte-length limit, not only the
pattern's source length.

The API registry key is independent:

- named export: camel-cased export name;
- default export: camel-cased filename;
- factory string argument: never used as the channels registry key.

Codegen therefore needs a per-category key-derivation policy. It rejects
duplicate registry keys and duplicate wire patterns across the app and extracted
modules. Renaming a file/export changes the typed API key but not the wire
pattern; changing the builder string is an intentional wire-contract change.

Resolved-name collision and parameter classification are security concerns.
The channel runtime exposes validation hooks for RT2.0 to define fail-closed
collision handling, parameter size limits, presence-data limits, origin/CSRF
policy, and the `{ subscribe, publish }` authorization rules. `publish` defaults
to `subscribe`; direct WS client events remain a separate explicit capability,
off by default.

## Lifecycle and crash safety

The composed runtime starts both seams during app startup and stops them during
app shutdown. Driver callbacks never rethrow into an event emitter. Every
fire-and-forget promise has an attached catch that reports an observation.
Listener failures are isolated per listener.

Only a database missing-table error (`42P01`) may be silently treated as
"realtime not installed". Other capture, drain, broker, scheduler, and sink
errors are rate-limited and surfaced. A client-transport failure emits a terminal
error/close when possible, then tears down so the client reconnect policy can
run. Session state is refreshed on reconnect and on a configurable coarse timer.

## Observability contract

RT1.9 implements a non-throwing observation sink owned by the runtime:

```ts
export interface RealtimeObserver {
	record(event: RealtimeObservation): void;
}
```

The discriminated events cover at least:

- broker start/stop/reconnect and publish failure;
- outbox capture failure, drain failure, drain lag rows, drain lag milliseconds,
  and reconciliation duration;
- refresh started/completed/suppressed/failed with operation and access-key
  cardinality, but never raw principal or topic values as metric labels;
- sink buffered bytes, busy results, write failures, slow-consumer disconnects,
  and active sessions;
- admission rejection by reason;
- resume replay, forced snapshot reset, channel gap, and dedupe counts.

Logging and metrics adapters may consume the same events. Observer failure is
isolated and cannot break delivery.

## Defect mapping

| Defect | Design element that removes it                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1     | App-lifecycle `ChangeBroker.start()` on every instance, independent of subscribers.                                                                             |
| G2     | Unconditional reconciliation, reconnect drain, lag-window rescan, and lossy wake contract.                                                                      |
| G3     | Explicit broker error callback, idempotent reconnect lifecycle, crash-safe callbacks, and immediate reconnect drain.                                            |
| G4     | Broadcast conformance tests for every broker; durable ordered state is drained independently by each instance rather than shared consumer-group load balancing. |
| G5     | Broker messages are notice-only; Cloudflare fan-out is sharded and query execution remains in the requesting worker.                                            |
| G6     | Scheduler key `(normalizedTopic, accessEquivalenceKey)`, one compute/serialization, snapshot suppression, and conservative record match.                        |
| G7     | Pre-registration access execution, finite topic/query/connection/buffer caps, bounded initial concurrency, and permanent-denial teardown.                       |
| G8     | Default time retention at zero subscribers, no local watermark deletion, notice-sized outbox, and bounded channel replay log.                                   |
| G9     | One transaction-bound outbox append per logical operation; post-commit broker publish is caught, observable, and off the response path.                         |
| G10    | Discriminated `find`/`count`/`get` topics; count executes count and transfers one number.                                                                       |
| G11    | Outbox append commits inside the mutation transaction; reconciliation can heal the post-commit wake crash window.                                               |

## Fifteen-invariant gate

| Invariant | Concrete mechanism                                                                                                         | Required proof                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| H1        | Both seams start/stop with app lifecycle; no subscriber-gated broker start.                                                | Write-only instance wakes a separate subscriber instance.                              |
| H2        | Lossy wake contract plus unconditional poll, reconnect drain, lag-window rescan, and seq dedupe.                           | Drop/reorder wakes and expose an out-of-order commit; state still converges.           |
| H3        | Logical-operation batch guard; one in-tx append; caught post-commit publish.                                               | Exact event/insert/notify counts and response-path latency assertion.                  |
| H4        | Scheduler keyed by topic and access equivalence; immutable byte fan-out; hash suppression; pre/post match.                 | N equivalent sinks cause one query and unchanged results emit no frame.                |
| H5        | Admission config, pre-registration access execution, bounded concurrency, finite limits.                                   | Cap matrix and denied-topic teardown tests.                                            |
| H6        | `ClientSink.write()` busy/throw contract, latest-wins replacement, bounded ordered queue, shared ticker, terminal cleanup. | Slow and failed sink tests prove bounded memory and zero listeners/timers after close. |
| H7        | `sinceSeq`, add/remove control frames, jittered reconnect, ping watchdog, forced reset outside retention.                  | Resume inside/outside retention and incremental mount tests with no reconnect storm.   |
| H8        | Discriminated `find`/`count`/`get` topic union.                                                                            | Live count runs count and transfers O(1) data.                                         |
| H9        | Notice-only broker and per-session private WS live-query channel with authorized refetch.                                  | Cross-session WS test proves no ACL snapshot reaches a shared channel.                 |
| H10       | Default time retention, no local watermark deletion, bounded replay infrastructure.                                        | Cleanup with zero subscribers and multiple instances.                                  |
| H11       | Caught async, isolated listeners, 42P01-only silence, client error/close, coarse session refresh.                          | Failure-injection matrix produces no unhandled rejection or hanging client.            |
| H12       | Non-throwing observer events for broker, drain, refresh, buffers, admission, resume, and failures.                         | Observer contract tests plus sensitive-label audit.                                    |
| H13       | Mutation and outbox append share the transaction; wake is post-commit.                                                     | Crash-window rollback/commit/reconcile tests.                                          |
| H14       | Separate `ChangeBroker` and `ClientTransport`; latest-snapshot and ordered-event QoS have different queue/replay rules.    | Interface compile test and cross-driver QoS matrix.                                    |
| H15       | Session-scoped default access key; cross-principal sharing only by explicit deterministic resolver.                        | Adversarial row, field, and `afterRead` isolation tests.                               |

Dependent implementation tasks may start only after this table is reviewed
15/15 and any blocker found by the grill is represented on the board.

## Security-model handoff (RT2.0)

RT2.0 owns the final channel security model. Its design must fill the hooks left
here without weakening transport invariants: `{ subscribe, publish }`
authorization, server-mediated schema validation, direct-client-event opt-in,
CSRF/origin handling, resolved-name collision policy, presence-data
classification and limits, channel/member caps, token expiry, and audit events.

Until RT2.0 is accepted, implementations must default to server-mediated
publish, direct client events off, no presence payload beyond a stable opaque
principal id, and fail-closed authorization.

Current provider constraints that RT2.0 must encode are documented by Pusher's
official Channels documentation: channel names are at most 164 characters and
use alphanumerics plus `_ - = @ , . ;`; presence channels allow 100 members, a
1 KiB user object, and a 128-character user id; client events are private or
presence-only, use the `client-` prefix, are tamperable, and are rate-limited to
10 events per second per connection. These are driver constraints, not universal
framework limits, and must be validated on resolved values.

- <https://pusher.com/docs/channels/using_channels/channels/>
- <https://pusher.com/docs/channels/using_channels/presence-channels/>
- <https://pusher.com/docs/channels/using_channels/events/>
