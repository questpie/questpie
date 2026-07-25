---
name: questpie-core/realtime
description:
  QUESTPIE realtime v2 live queries transactional outbox reconciliation SSE Pusher Soketi ChangeBroker ClientTransport pg-notify Redis Streams Cloudflare admission privacy live liveIter
  - questpie-core
---

This skill builds on questpie-core.

# Realtime

Realtime powers two distinct products:

- **Live queries** re-run a collection/global query under the subscriber's session and deliver the latest access-controlled snapshot. Snapshot wakes are coalescable.
- **Channels** deliver schema-validated application events in channel-local order. Events are not coalesced. See `references/channels.md`.

Enable it with `realtime: true`. Do not write CRUD hooks to emit live-query changes: every logical create/update/delete, including bulk operations, already appends one `questpie_realtime_log` row **inside the business transaction**.

## Correctness model

1. The mutation and outbox row commit or roll back together.
2. A `ChangeBroker` wake tells instances to drain quickly. Wakes are notice-only, unordered, at-most-once, and may be coalesced.
3. An unconditional reconciliation poll drains missed outbox rows. Default: 15s with push, 2s without; provider failure tightens to at most 2s.
4. The server re-runs matching queries under the subscriber's session, including row/field access and `afterRead`, then a `ClientTransport` delivers authorized frames.

The broker is a latency hint; the transactional outbox plus reconciliation is the guarantee. Brokers must never carry rows or snapshots. Equivalent snapshot work is shared per principal by default, never across users unless the application proves deterministic access equivalence.

## Client usage

```ts
const stop = client.collections.posts.live(
	{ where: { status: "published" }, with: { author: true }, limit: 50 },
	(snapshot) => render(snapshot.docs),
	{ onError: console.error },
);

for await (const snapshot of client.collections.posts.liveIter(
	{ where: { status: "published" } },
	{ signal: controller.signal },
)) {
	render(snapshot.docs);
}

client.globals.siteSettings.live(undefined, (settings) => applyTheme(settings));
```

`live()` accepts the query options supported by the wire contract: `where`, `with`, `limit`, `offset`, `orderBy`, and `locale`. Prefer these typed wrappers over raw `client.realtime.subscribe()`.

TanStack Query uses the stream for its initial result too; it does not issue a duplicate REST fetch:

```tsx
const { data } = useQuery(
	q.collections.posts.find(
		{ where: { status: "published" }, limit: 20 },
		{ realtime: true },
	),
);
```

`count(..., { realtime: true })` yields a number, not a paginated snapshot. `findOne()` and `findVersions()` do not have realtime forms.

Mutation results carry non-enumerable transaction metadata. The shared
realtime API exposes `awaitMutation(result)` (or `awaitTxId(txid)`) to wait
until every subscribed topic has reconciled that commit. `getTxid(result)`
reads the metadata when custom coordination is necessary. Advanced transport
authors can use `RealtimeTxidTracker` and `realtimeEventResolvesTxid`; ordinary
apps should use the client-wide realtime API.

## Transport selection

SSE is the default `ClientTransport`; no browser transport config is required. With a normal Postgres URL the server auto-wires `PgNotifyChangeBroker`; otherwise it polls every 2s. Redis Streams and Pusher are supported v2 broker overrides. A clean v2 configuration uses one `ChangeBroker`.

Realtime topology is durable in `questpie_realtime_topology`. Complete desired topology uses monotonic revisions; a metadata-only broker wake lowers latency and one-second reconciliation heals dropped wakes. This makes companion control HA-safe without sticky routing after the migration is applied and every request-handling replica supports the advertised `questpie-realtime-topology` v2 capability.

Before a production upgrade, run `bunx questpie migrate:create`, review and commit the generated migration, then run `bunx questpie migrate`. Never use `push` for this production schema change.

For managed WebSockets and native presence, select the isolated Pusher/Soketi preset:

```ts
import { pusherRealtime } from "questpie/adapters/pusher";
import { runtimeConfig } from "questpie/app";

const managed = pusherRealtime({
	appId: env.PUSHER_APP_ID,
	key: env.PUSHER_KEY,
	secret: env.PUSHER_SECRET,
	cluster: env.PUSHER_CLUSTER,
});

export default runtimeConfig({ realtime: { ...managed } });
```

`pusherRealtime()` supplies both the notice broker and client transport. App-facing `live()`, TanStack, and channel APIs do not change. Direct provider client events are off by default because they bypass framework publish authorization, Zod validation, rate limits, ordered ledger, and replay.

Pusher invalidations contain opaque target ids only, never snapshots or CRDT
updates. QUESTPIE caps one targeted invalidation at 128 targets and an 8 KiB
JSON envelope, leaving headroom for JSON/provider serialization. Overflow or
malformed targeting collapses to one generic reconcile. Channel application
events use the exact 10,000-byte QUESTPIE cap while remaining below the
provider's <10 kB ceiling.

## Admission and lifecycle

Default SSE limits are 20 topics per connection, 5 connections per authenticated principal, `find` limit 100, nested `with` depth 3, 4 concurrent initial snapshots, and 1 MiB buffered snapshot bytes per edge session. Slow consumers are bounded and disconnected rather than allowed unbounded memory growth.

`maxFindLimit` applies to each initial and refreshed snapshot. QUESTPIE rejects
an oversized topic rather than clamping or splitting it, because either changes
ordering, pagination, completeness, and topic-budget semantics. Change the
default `100` only after measuring query cost, serialized bytes, fan-out, and
slow-client behavior. Large or paginated read models are not one realtime
snapshot.

Initial topics and topics added through companion control use the same
`REALTIME_TOPIC_REJECTED` payload: `topicId`, `resource`, `operation`,
`retryable: false`, and bounded details. It never includes `where`, session,
token, identity, or results. The multiplexer delivers it only to the rejected
subscriber; `live()` calls that subscriber's `onError`, `liveIter()` throws, and
TanStack enters an error state without retrying. Client callbacks receive a
`RealtimeTopicRejectedError`, which exposes the safe structured fields.

Keep `keepAliveIntervalMs` (default 8s) below the server/proxy idle timeout. `live()` without server `realtime` errors explicitly; it does not silently fall back to a normal query.

A future `realtime: { mode: "invalidate" }` is separate-spec work and is not
implemented.

## Scalable row realtime

Correctness does not imply scalability. The database query plus current read
access is authoritative; client filters and routing guards never authorize a
row.

- Put a stable, indexed own-column `scopeId`, `partitionId`, `parentId`,
  `principalId`, `recipientId`, or `audienceId` on ordinary realtime rows.
- Let TanStack DB compose joins, ordering, limits, and derived live views from
  authorized normalized rows.
- At admission, freeze only stable principal, server-derived scope, topic
  locale, stage, and access mode. Never store expanded membership or permission
  id sets in subscription context.
- Resolve scope with
  `realtime.subscriptionScope(({ request }) => request?.headers.get("x-scope-id") ?? null)`.
  `null` means unscoped; a value is capped at 256 UTF-8 bytes. A scope switch
  opens a new subscription and bootstraps a fresh client store.
- Collection/global `realtime.accessCacheKey` is an explicit proof that output
  may be shared across principals within the frozen scope tuple. Its key is
  capped at 256 UTF-8 bytes; invalid or throwing resolvers stay edge-isolated.
- Mutable membership/access stays in the database. Watched-resource changes
  trigger targeted reset; periodic delta re-bootstrap is only the safety net.

Payload routing is conservative. It returns `match | miss | unknown`; only
`miss` skips work. Own-column scalar equality, `eq`, and bounded `in` are cheap.
Relations, `RAW`, unsupported operators, missing projections, and ambiguous
values are `unknown`. Updates inspect before and after, so moving a row between
scopes wakes both partitions. The full database matcher still decides
membership and access.

Disable direct topics without disabling dependency capture:

```ts
collection("memberships")
	.fields(({ f }) => ({
		scopeId: f.text(128).required(),
		principalId: f.text(128).required(),
	}))
	.options({ realtime: false });
```

Use `realtime: { rowLiveQueries: false }` for an app-wide row-topic deny.
Typed channels, CRDT, the outbox, change capture, and watched dependency
invalidation stay enabled. Raw topics receive the same
`collection_realtime_disabled` or `row_live_queries_disabled` rejection as
typed clients, before scheduler allocation or bootstrap.

A personalized relation query for 100,000 principals in one shared scope can
cause 100,000 authoritative recomputations. Snapshot fallback is correct but
expensive. Prefer materialized inbox rows with direct `recipientId`, a shared
typed audience channel, an invalidation/refetch event, or a normal query.
`bun --cwd packages/questpie run bench:realtime:routing` runs the deterministic
100,000-subscription / 1,000-scope routing harness and its high-blast
personalized adversary.

Observer metrics expose candidate groups, guard outcomes, authoritative DB
calls, snapshot bytes, delta frames, fallback reasons, and bounded queue
gauges. Metric labels never contain raw principal, scope, topic, record, query,
or result values. Advanced diagnostics can call
`classifyRealtimeDeliveryDecision()` to inspect the stable delivery mode/reason
without executing a query. Missing/mismatched reverse relation metadata in an access
predicate must reject/deny; normal reads, hydration, realtime bootstrap, and
authoritative matching share the fail-closed compiler.

Full adapter options and deployment guidance: `references/infrastructure-adapters.md`.
