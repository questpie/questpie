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

## Transport selection

SSE is the default `ClientTransport`; no browser transport config is required. With a normal Postgres URL the server auto-wires `pg_notify`; otherwise it polls every 2s. Explicit pg, Redis, and Cloudflare adapters remain supported as notice brokers.

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

## Admission and lifecycle

Default SSE limits are 20 topics per connection, 5 connections per authenticated principal, `find` limit 100, nested `with` depth 3, 4 concurrent initial snapshots, and 1 MiB buffered snapshot bytes per edge session. Slow consumers are bounded and disconnected rather than allowed unbounded memory growth.

Keep `keepAliveIntervalMs` (default 8s) below the server/proxy idle timeout. `live()` without server `realtime` errors explicitly; it does not silently fall back to a normal query.

Full adapter options and deployment guidance: `references/infrastructure-adapters.md`.
