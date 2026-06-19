---
name: questpie-core/realtime
description: QUESTPIE realtime live queries SSE subscriptions snapshots automatic broadcast outbox questpie_realtime_log live liveIter subscribe wire protocol keepalive idleTimeout pg-notify redis-streams polling
  - questpie-core
---

This skill builds on questpie-core.

# Realtime

Live queries over SSE. **Broadcasts are automatic**, every collection/global create/update/delete already writes a change event to the `questpie_realtime_log` outbox and notifies subscribers. Do NOT write `afterChange` hooks that "emit" realtime events; a custom emitter double-fires against the built-in broadcast hook.

## How It Works

1. Every CRUD write appends a change event to the outbox; an adapter (pg_notify / Redis Streams) or 2s polling wakes subscribers
2. The server **re-runs the subscribed query under the subscriber's auth** and pushes the full result as a `snapshot`, clients never receive raw change events (no `operation`/`recordId` on the client; snapshots are access-controlled)
3. One SSE connection multiplexes all topics (`POST /realtime`)

Snapshots are idempotent state, not diffs, filtered subscriptions may receive unchanged snapshots on update/delete (over-refresh by design). Always render from the snapshot.

## Client-Side Usage

```ts
// React + TanStack Query, typed second arg, no casts needed
const { data } = useQuery(
	qp.collections.posts.find(
		{ where: { event: eventId }, limit: 50 },
		{ realtime: true },
	),
);

// Vanilla TS, live() is the live form of find(): same options in, same result type out
const stop = client.collections.posts.live(
	{
		where: { event: eventId },
		with: { author: true },
		orderBy: { createdAt: "desc" },
	},
	(snap) => render(snap.docs), // snap.docs[i].author is typed
	{ onError: (e) => console.error(e) },
);
stop(); // unsubscribe

// Async-iterable form (workers, agents, tests), terminate via AbortSignal
for await (const snap of client.collections.posts.liveIter(
	{ where: { event: eventId } },
	{ signal: controller.signal },
)) {
	render(snap.docs);
}

// Globals mirror get()
client.globals.siteSettings.live(undefined, (settings) => applyTheme(settings));

// Low-level escape hatch, topic objects, never channel strings; data is untyped
client.realtime.subscribe(
	{ resourceType: "collection", resource: "posts", where: { event: eventId } },
	(data) => {}, // unknown, prefer the typed live() wrappers
);
```

Live options carry exactly what the wire protocol supports: `where`, `with`, `limit`, `offset`, `orderBy`, `locale` (no `columns`/`groupBy`/`search`, compile error).

## Wire Protocol (stable contract)

`POST <basePath>/realtime` body `{ topics: [{ id, resourceType: "collection" | "global", resource, where?, with?, limit?, offset?, orderBy?, locale? }] }` → SSE events:

| Event      | Payload                  | Meaning                                               |
| ---------- | ------------------------ | ----------------------------------------------------- |
| `snapshot` | `{ topicId, seq, data }` | Full `find()`/`get()` result under subscriber's auth  |
| `error`    | `{ topicId, message }`   | Topic-level failure (unknown resource, access denied) |
| `ping`     | `{ ts }`                 | Keep-alive (default every 8s)                         |

Ignore unknown SSE event types (forward compat).

## Keepalive (Bun)

The stream pings every 8s by default (`realtime.keepAliveIntervalMs`). Bun's default `idleTimeout` is 10s, the default ping survives it, but set headroom explicitly in the server entry:

```ts
export default { port: 3000, idleTimeout: 30, fetch: server.fetch };
```

## Realtime Adapters

Without an adapter, subscribers wake on a 2s poll. For push-based delivery, configure a realtime adapter in `runtimeConfig`:

```ts
import { pgNotifyAdapter } from "questpie/adapters/pg-notify";

runtimeConfig({
	realtime: {
		adapter: pgNotifyAdapter({ connectionString: env.DATABASE_URL }),
	},
});
```

| Adapter                 | Description                  |
| ----------------------- | ---------------------------- |
| _None_ (default)        | Polling-based (every 2s)     |
| `pgNotifyAdapter()`     | PostgreSQL LISTEN/NOTIFY     |
| `redisStreamsAdapter()` | Redis Streams consumer group |

Full adapter configuration (connection options, multi-instance setup): see `references/infrastructure-adapters.md`.
