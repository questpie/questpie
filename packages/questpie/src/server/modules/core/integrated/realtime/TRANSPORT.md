# Realtime v2 transport contract

Status: accepted RT1.1 design gate after adversarial grill on 2026-07-13;
channel security model accepted by RT2.0 on 2026-07-14. This document is
normative for the transport extraction. It covers all fifteen invariants in
Part H of the Realtime v2 + Channels analysis.

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

The broker interface is notice-only and carries no snapshots or query payloads:

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
the runtime immediately drains from its durable sequence cursor.

The runtime also schedules unconditional slow reconciliation while a broker is
active. It drains both durable sources: the live-query outbox and the channel
delivery ledger. Every new writer locks the singleton outbox head inside the
business transaction before inserting, so sequence order is commit order. An
outbox drain reads strictly after its cursor and advances only after local
dispatch. Native deltas have a two-phase rollout gate: deploy every writer with
`nativeDeltas` disabled first, then enable it only after no legacy writer can
append without the head lock. A channel drain follows the ordered-ledger rules
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
	| LocalSessionClientTransport
	| SharedProviderClientTransport;
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

export type RealtimeDesiredTopicV1 = {
	id: string;
	topic: RealtimeTopic;
	sinceSeq?: number;
};

export type RealtimeTopologyControlV1 = {
	protocol: "questpie-realtime-topology";
	version: 1;
	revision: number;
	topics: RealtimeDesiredTopicV1[];
	channels: RealtimeDesiredChannelV1[];
};
```

Each desired topic `id` is unique within an edge session. Normalized topic content, not a
truncated hash, forms the scheduler topic key. Every control request submits the
complete desired topology. The owner admits and authorizes additions before
applying one diff, cancels removals, and keeps unchanged subscriptions mounted.

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

## Native-delta identity and queue ownership

QUESTPIE collections always expose a canonical `id` field: the collection
builder installs it unless the collection defines its own `id`. Native delta
frames and TanStack DB therefore use `String(row.id)` as their stable key. A
separate configurable primary-key field is not supported by the collection
contract and is not threaded through the realtime wire format.

Native delta SSE delivery and ordered channel delivery both use bounded,
non-coalescing FIFO behavior, but their implementations are deliberately kept
separate. Channel ledger topology is frozen and remains owned by
`channel-event-ledger.ts`; the delta implementation lives in
`ordered-fifo-writer.ts`. Their count/byte caps, busy-retry behavior, and
overflow teardown semantics must remain aligned. This duplication is an
explicit topology-preserving exception, not permission to weaken either queue.

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

`maxFindLimit` is a per-snapshot limit: it applies to the initial `find` and to
every later refresh. The default remains `100`. Rejection is explicit; the
runtime must not clamp or split a query because either changes ordering,
pagination, completeness, and topic-budget semantics. Configuration changes
require measurements of query cost, serialized size, fan-out, and slow-client
behavior. Large or paginated read models are not one realtime snapshot.

Topic admission failures use the safe `REALTIME_TOPIC_REJECTED` payload with
`topicId`, `resource`, `operation`, `retryable: false`, and bounded details.
Never attach `where`, session data, tokens, or arbitrary input. The edge sends
the error only to the rejected subscriber; adapters must expose a visible error
state and must not retry a non-retryable rejection.

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
| maximum native-delta bootstrap rows                 |     384 |
| queued native-delta events per group/session        |     512 |
| queued native-delta bytes per group/session         |   1 MiB |
| concurrent native-delta hydration batches           |       4 |
| periodic native-delta re-bootstrap                  |     60s |
| queued ordered channel events per edge session      |     100 |
| queued ordered channel-event bytes per edge session |   1 MiB |

## Future deep module: invalidation mode (not implemented)

A future, separately specified `realtime: { mode: "invalidate" }` module may
publish a bounded invalidation signal and let a read adapter refetch its own
page instead of streaming complete snapshots. That is a different delivery
contract: it needs explicit ownership of cache keys, pagination semantics,
dedupe, authorization revalidation, retry policy, and stale-data behavior.

It must not be added as a flag inside the snapshot pipeline or used to delay HA
topology work. No invalidate mode is implemented by this design; it requires a
separate spec and acceptance suite.

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

Client control submits complete desired topology protocol v1 over SSE control
HTTP or managed-provider control. Authorization and state transitions are
identical across both delivery transports.
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
The channel runtime applies the accepted RT2.0 security model below before it
authorizes, subscribes, or publishes.

## Channel security model

This section is normative for RT2.1, RT3.1, RT3.3, and the RT4.1 cross-driver
matrix. A transport may enforce stricter provider limits, but it cannot weaken
these framework rules.

### Authorization and publish boundaries

Channel authorization is a per-verb route-style boolean gate:

```ts
export type ChannelAuthorization<TContext> = {
	subscribe: boolean | ((context: TContext) => boolean | Promise<boolean>);
	publish?: boolean | ((context: TContext) => boolean | Promise<boolean>);
};
```

When an authorization map exists and `publish` is omitted, it is the same rule
as `subscribe`. The two rules are still evaluated independently at operation
time: membership is not proof that the current principal may publish, and a
stale subscription decision is never reused as a publish decision. A thrown,
timed-out, or non-boolean rule result denies the operation and is observed.

No authorization map means public subscription and **no client-originated
publish**. This preserves useful public read-only channels without silently
creating an anonymous write endpoint. Trusted server code may publish through
`ctx.channels` in system access mode, but schema, name, payload-size, ledger,
and observation rules still apply. A user-mode server context and every
`channels/publish` request evaluate the `publish` rule.

Server-mediated publish is the framework default on both presets. The runtime
must, in this order, resolve and validate params, prove the resolved-name
identity, authenticate the principal, evaluate `publish`, parse the declared
Zod event schema, enforce serialized size and rate limits, and only then append
to the ordered event ledger. No rejected publish allocates a channel sequence
or emits a broker/provider event.

### Direct WebSocket client events

Pusher-compatible client events bypass the framework HTTP publish route and
therefore bypass the publish rule, Zod parsing, ordered ledger, replay, dedupe,
and server observation. They are a distinct best-effort capability, not a fast
path for framework events.

- The provider-app default and every framework channel default are disabled.
  Opt-in is deliberately two-level: deployment config enables the provider-app
  capability with an explicit unvalidated-payload acknowledgement, and the
  channel definition exposes a literal event-name allowlist in the SDK. A
  boolean `clientEvents: true` is insufficient.
- Pusher enforces client events at provider-app scope, not per channel. Once
  enabled, a hostile member can emit any `client-*` name on every private or
  presence channel in that provider app. The framework allowlist controls only
  typed SDK send/bind behavior; it is not an authorization boundary.
- Consequently, a channel exposing direct events cannot have a publish rule
  stricter than its subscribe rule: provider membership is the only enforceable
  send gate. Deployments with mixed trust requirements use separate provider
  apps or keep direct events globally disabled and use server-mediated publish.
- The client API exposes a distinct operation; regular `.publish()` always uses
  the server-mediated path and never silently falls back to a client event.
- The capability is available only for private/presence channels on a managed-WS
  driver. The SSE preset returns a typed capability error.
- On-wire names use the provider-required `client-` prefix. They cannot overlap
  framework event names or `pusher:`/internal namespaces.
- Payloads are treated as hostile input by receivers. TypeScript inference is a
  convenience only and must not be described as runtime validation.
- Delivery is best-effort, non-replayable, and not sent back to the originator.
  Provider webhooks may improve audit visibility but do not change those QoS
  semantics.

The SDK applies the same 10 events/second and payload-byte preflight as the
provider, but this is UX only; a hostile client can bypass the SDK allowlist and
limiter. Provider rate and payload enforcement remains mandatory.

### Resolved names and collision proof

The server never trusts a client-supplied wire name. Requests identify the
generated channel key and params; the server validates params and renders the
application name itself. The final provider name, including `private-` or
`presence-`, must:

- be non-empty ASCII using only `A-Z a-z 0-9 _ - = @ , . ;`;
- contain no whitespace, control characters, slash, `#`, or unresolved bracket;
- be at most 164 characters including the provider prefix;
- contain only non-empty params satisfying the same alphabet.

Duplicate source patterns are rejected by codegen. Dynamic collisions fail
closed as well: the bounded resolver matches the rendered application name
against every registered pattern and enumerates possible param splits. Exactly
one `(channel key, canonical params)` candidate must remain and it must equal
the request's claimed identity. Zero, multiple-definition, or ambiguous
same-pattern matches return `channel_name_collision` before authorization or
provider contact. This check is deterministic from the generated registry, so
different app instances cannot claim the same provider wire name for different
logical channels.

### HTTP origin, CSRF, and CORS policy

`channels/auth` and `channels/publish` are authority-bearing POST endpoints.
The trusted-origin set defaults to the origin of the configured application URL
and may be extended only with exact `https://host[:port]` origins. Development
may additionally allow exact `http://localhost[:port]`, `http://127.0.0.1[:port]`,
or `http://[::1][:port]`; production rejects non-HTTPS origins. Wildcards,
paths, credentials in URLs, opaque/null origins, and suffix matching are invalid.

- Cookie-authenticated browser requests require an `Origin` header whose parsed
  origin is in the trusted set. Missing, malformed, `null`, or untrusted origins
  are rejected. SameSite cookies are defense in depth, not the CSRF decision.
- A non-cookie bearer/API-key request may omit `Origin` for server-to-server
  use. If it supplies `Origin`, that origin must still be trusted.
- Endpoints accept only their documented JSON or Pusher form encoding and reject
  simple `text/plain` submissions. GET never authorizes or publishes.
- Credentialed CORS echoes one exact trusted origin, emits `Vary: Origin`, and
  never returns `Access-Control-Allow-Origin: *`. OPTIONS validates the origin
  before advertising POST and the required content/auth headers.
- Redirects are not used for auth/publish failures; responses are `no-store` and
  contain no provider secret, raw session identifier, or authorization reason
  that reveals channel membership.

This strict origin check is the CSRF mechanism for cookie requests. RT3.3 must
use one shared helper for auth and publish so their policies cannot drift.

### Admission, rate, and payload limits

Limits are checked before expensive authorization where possible and always
before ledger/provider writes. Initial framework defaults are:

| Limit                                                     |   Default |
| --------------------------------------------------------- | --------: |
| channel subscriptions per edge session                    |        20 |
| server-mediated publishes per edge session per second     |        10 |
| server-mediated publish token-bucket burst                |        20 |
| authorization-rule execution timeout                      |  5,000 ms |
| serialized framework event data (UTF-8 JSON bytes)        |    10,000 |
| direct client events per managed-WS connection per second |        10 |
| presence members per resolved channel                     |       100 |
| serialized presence member object, including id and info  |   1,024 B |
| presence member id                                        | 128 chars |

The server-mediated limiter is also keyed by authenticated principal (or a
bounded anonymous IP/edge-session fallback) per app instance, so opening more
tabs does not multiply the principal's allowance without bound. Distributed
exact rate limiting remains a non-goal; provider/account limits are additional.
Exceeding a publish rate returns 429 with a bounded retry hint. Repeated protocol
or rate violations close the edge session.

The payload cap is measured on the exact JSON string passed as provider event
data, not JavaScript string length or the pre-validation request body. It is
enforced before a framework event enters the ordered ledger. Oversize requests
return 413 and allocate no event id. Binary and cyclic/non-serializable values
are outside this program.

### Presence-data classification

Presence is private for joining but not private among members. The full member
object is sent to every current member of the resolved channel. Every presence
resolver field is therefore classified **channel-member-visible**; it must not
contain email addresses, roles, permissions, bearer/session tokens, internal
database keys, or data the principal cannot disclose to every member.

The framework default member id is a stable opaque value derived from the
principal subject with a deployment secret. An application-supplied id is sent
verbatim and is an explicit disclosure. IDs use the provider-safe alphabet and
are at most 128 characters. The complete UTF-8 JSON member object is at most
1,024 bytes, and a resolved presence channel admits at most 100 distinct
members. These parity defaults also apply to the SSE coarse-presence preset;
providers may be stricter. Limit or serialization failure denies the join
rather than truncating identity or member info.

### Authorization grants, expiry, and revocation

Every auth request resolves the current session afresh. A Pusher subscription
signature is bound to one provider `socket_id` and one final channel name, is
returned with `Cache-Control: no-store`, and is never persisted or reused by the
client. The Pusher protocol does not provide an independent TTL field for that
signature; its honest lifetime is the provider connection. We do not claim a
fictional token expiry.

Any framework-minted bearer used by a future transport must be single-purpose,
single-use, at most 60 seconds old, and bound to principal/session, channel key,
canonical params hash, verb, and connection nonce. Long-lived provider secrets
are server-only and never appear in `channels/config`.

Revocation has three mandatory layers:

1. revoked/expired sessions receive no new auth or publish grant;
2. local-session transports close the affected edge sessions immediately;
3. managed-WS transports user-authenticate with an opaque provider user id and
   terminate that user's active provider connections on session revocation or
   expiry, then require full subscribe authorization on reconnect.

A provider driver that cannot terminate established user connections must
report that capability honestly and cannot advertise immediate revocation. Its
documented bounded fallback must force provider reauthentication; RT4.1 measures
the window. Secret rotation invalidates future grants but is not a substitute
for terminating already-authorized connections.

### Security observations

The observer records allow/deny outcomes and reason codes for subscribe,
publish, origin, name collision, rate, size, presence, grant, and revocation
events. Metric labels use channel definition keys and bounded reason enums, not
raw resolved names, params, payloads, presence info, tokens, socket ids, or
principal identifiers. Direct client-event payloads are not observable by the
framework unless an explicitly configured provider webhook supplies metadata.

### Required security test checklist

| ID     | Rule                                                                                                                                                 | Owning proof                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SEC-01 | `subscribe` and `publish` are evaluated independently; omitted publish reuses subscribe.                                                             | RT3.3 route matrix; RT4.1 both presets.                       |
| SEC-02 | No auth map is public-read/server-write, not anonymous client-write.                                                                                 | RT3.3 public-channel 200 subscribe / 403 publish.             |
| SEC-03 | Denied/thrown/timed-out rules allocate no listener, sequence, ledger row, or provider call.                                                          | RT3.3 failure injection; RT4.1 counters.                      |
| SEC-04 | Framework publish validates Zod before size check, ledger append, and delivery.                                                                      | RT3.3 invalid-event tests; RT4.1 exact publish counts.        |
| SEC-05 | Direct client events require deployment + channel opt-in and use a separate SDK API/namespace.                                                       | RT2.1 provider config tests; RT4.1 hostile direct-event test. |
| SEC-06 | Provider-app scope, membership-only authorization, SDK-only allowlist, unvalidated/non-replayable payload, and non-originator delivery are explicit. | RT2.1 Soketi raw-client test; RT4.1 QoS matrix.               |
| SEC-07 | Final prefixed names enforce alphabet and 164-char cap on resolved values.                                                                           | RT2.1 auth mint boundary tests; RT3.3 SSE boundary parity.    |
| SEC-08 | Cross-pattern and ambiguous-param resolved collisions fail before auth/provider work.                                                                | RT3.3 resolver tests; RT4.1 two-instance parity.              |
| SEC-09 | Cookie auth/publish rejects missing, null, malformed, and untrusted origins.                                                                         | RT3.3 CSRF table tests.                                       |
| SEC-10 | Credentialed CORS reflects only exact trusted origins with `Vary: Origin`; never wildcard.                                                           | RT3.3 OPTIONS/POST tests.                                     |
| SEC-11 | Per-session and per-principal publish buckets return 429 and recover after the window.                                                               | RT3.3 fake-clock tests; RT4.1 multi-tab flood.                |
| SEC-12 | Exact serialized payload boundary accepts 10,000 bytes, rejects 10,001 with no event id.                                                             | RT3.3 unit/integration; RT4.1 all drivers.                    |
| SEC-13 | Presence exposes only the resolver object and enforces 100 members, 1,024 bytes, 128-char id.                                                        | RT2.1 provider auth tests; RT4.1 SSE/WS parity.               |
| SEC-14 | Auth signatures are socket/channel-bound, `no-store`, and config never leaks provider secret.                                                        | RT2.1 mint/config tests.                                      |
| SEC-15 | Session revocation denies new grants and terminates/re-authenticates established sessions within the declared window.                                | RT2.1 revocation test; RT4.1 measured drill.                  |
| SEC-16 | Security observations contain bounded reasons but no raw params, payload, member, token, socket, or principal data.                                  | RT4.1 sensitive-label audit.                                  |

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
- refresh started/completed/suppressed/failed with operation and subscriber
  count, but never raw principal, access key, or topic values as metric labels;
- sink buffered bytes, busy results, write failures, slow-consumer disconnects,
  and active sessions;
- admission rejection by reason;
- resume replay, forced snapshot reset, channel gap, and dedupe counts.

Logging and metrics adapters may consume the same events. Observer failure is
isolated and cannot break delivery.

The built-in snapshot exposes only bounded counter keys. In particular,
`refresh.started` is the compute count and `refresh.subscriber_deliveries` is
the fan-out count, so their ratio measures compute-once sharing without an
access-key label. `drain.poll_healing`, `drain.rows`, and `drain.seq_delta`
separate reconciliation recovery from broker-triggered work. Durations, lag,
frame sizes, and per-write buffered bytes remain numeric event fields for an
OTel adapter to record as histograms rather than unbounded metric labels.

Operators should alert on sustained broker publish failures, any outbox capture
or drain failure, drain age above the configured reconciliation-poll window,
and a refresh compute-to-delivery ratio approaching `1` while subscriber count
is materially higher (a refresh-herd signal). Repeated slow-consumer closes,
write failures, or an increasing admission-rejection rate are warning signals;
single access denials and rate-limit rejections are structured audit warnings,
not paging conditions by themselves.

## Distributed desired-topology control

Realtime topology control follows the same durable-state/wake/reconcile rule as
the outbox. `questpie_realtime_topology` is authoritative for the complete
desired topology, its monotonic revision, the applied revision, owner lease,
and fencing generation. The live sink and its apply/close callbacks remain in
the owner process and are never serialized.

An opening SSE or shared-provider session advertises
`questpie-realtime-topology` version `1`. New clients then submit a complete
bounded topology with one positive revision; unchanged topics/channels stay
mounted while the owner applies only additions and removals. The accepting
replica commits the desired revision before acknowledging it, then publishes a
metadata-only `topology-maybe-advanced` wake. The owner re-reads the durable
row and a one-second reconciliation loop heals a lost wake. The default lease
is 30 seconds with a 10-second heartbeat, both using database time and fenced
updates.

Session ids, control tokens, and identities are stored as SHA-256 hashes. Wakes
contain only the session hash, owner id/generation, desired revision, and a
bounded reason. A missing/expired row or token/identity mismatch has the same
unavailable response. Owner death never transfers a live stream; the client
reconnects and opens a new fenced session after transport/watchdog failure.

Postgres apps construct `PgNotifyChangeBroker` automatically. Redis deployments
can select `redisStreamsChangeBroker`; neither broker is the durable topology
store. Generic KV is not a coordinator and load-balancer affinity is not part
of the correctness contract.

QuestPie 4 accepts only desired topology protocol v1 and uses `ChangeBroker` as
the only cross-instance wake seam. All request-handling replicas and clients are
upgraded together across this major-version boundary. After the topology
migration and multi-pod verification, load-balancer affinity is removed.

## Defect mapping

| Defect | Design element that removes it                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1     | App-lifecycle `ChangeBroker.start()` on every instance, independent of subscribers.                                                                             |
| G2     | Unconditional reconciliation, reconnect drain, commit-ordered outbox cursor, and lossy wake contract.                                                           |
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

| Invariant | Concrete mechanism                                                                                                                              | Required proof                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| H1        | Both seams start/stop with app lifecycle; no subscriber-gated broker start.                                                                     | Write-only instance wakes a separate subscriber instance.                              |
| H2        | Lossy wake contract plus unconditional poll, reconnect drain, head-locked commit order, and the two-phase native-delta rollout gate.            | Drop/reorder wakes; prove commit-order capture and snapshot fallback during rollout.   |
| H3        | Logical-operation batch guard; one in-tx append; caught post-commit publish.                                                                    | Exact event/insert/notify counts and response-path latency assertion.                  |
| H4        | Scheduler keyed by topic and access equivalence; immutable byte fan-out; hash suppression; pre/post match.                                      | N equivalent sinks cause one query and unchanged results emit no frame.                |
| H5        | Admission config, pre-registration access execution, bounded concurrency, finite limits.                                                        | Cap matrix and denied-topic teardown tests.                                            |
| H6        | `ClientSink.write()` busy/throw contract, latest-wins replacement, bounded ordered queue, shared ticker, terminal cleanup.                      | Slow and failed sink tests prove bounded memory and zero listeners/timers after close. |
| H7        | `sinceSeq`, revisioned complete desired topology, durable ownership/fencing, jittered reconnect, ping watchdog, forced reset outside retention. | Cross-replica topology, resume, reconciliation, and incremental mount tests.           |
| H8        | Discriminated `find`/`count`/`get` topic union.                                                                                                 | Live count runs count and transfers O(1) data.                                         |
| H9        | Notice-only broker and per-session private WS live-query channel with authorized refetch.                                                       | Cross-session WS test proves no ACL snapshot reaches a shared channel.                 |
| H10       | Default time retention, no local watermark deletion, bounded replay infrastructure.                                                             | Cleanup with zero subscribers and multiple instances.                                  |
| H11       | Caught async, isolated listeners, 42P01-only silence, client error/close, coarse session refresh.                                               | Failure-injection matrix produces no unhandled rejection or hanging client.            |
| H12       | Non-throwing observer events for broker, drain, refresh, buffers, admission, resume, and failures.                                              | Observer contract tests plus sensitive-label audit.                                    |
| H13       | Mutation and outbox append share the transaction; wake is post-commit.                                                                          | Crash-window rollback/commit/reconcile tests.                                          |
| H14       | Separate `ChangeBroker` and `ClientTransport`; latest-snapshot and ordered-event QoS have different queue/replay rules.                         | Interface compile test and cross-driver QoS matrix.                                    |
| H15       | Session-scoped default access key; cross-principal sharing only by explicit deterministic resolver.                                             | Adversarial row, field, and `afterRead` isolation tests.                               |

Dependent implementation tasks may start only after this table is reviewed
15/15 and any blocker found by the grill is represented on the board.

## Security-model status (RT2.0)

The channel security model above is accepted. RT2.1 and RT3.3 must reference
SEC-01 through SEC-16 in implementation evidence; RT4.1 owns the cross-driver
and hostile-client proofs. Provider constraints remain additional to framework
limits and are validated on final resolved values.

- <https://pusher.com/docs/channels/using_channels/channels/>
- <https://pusher.com/docs/channels/using_channels/presence-channels/>
- <https://pusher.com/docs/channels/using_channels/events/>
- <https://pusher.com/docs/channels/library_auth_reference/rest-api/>
