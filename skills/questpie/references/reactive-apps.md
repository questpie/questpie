---
name: questpie-client/reactive-apps
description:
  QUESTPIE React realtime performance live queries count channels TanStack Query selectors rerender isolation bounded streams presence lifecycle diagnostics
  - questpie-core
---

# Reactive Apps and Performance

Choose the smallest mechanism that matches the state contract:

| Need                                            | Mechanism                             |
| ----------------------------------------------- | ------------------------------------- |
| Durable collection/global state after reconnect | Live query with `{ realtime: true }`  |
| Badge or aggregate                              | Live `count()`                        |
| Ordered transient UI event                      | Typed channel                         |
| State changed only by local actions/navigation  | Normal cached query plus invalidation |
| Durable chat/notification history               | Collection; channel only as a UI hint |

Do not emit channel events for ordinary QUESTPIE CRUD. Transactional realtime capture already refreshes matching live queries.

## Multiplexing and React isolation

One SSE/provider connection does not create one shared React state. Each normalized query shape gets its own deterministic topic id, and frames dispatch only to that topic's subscribers. TanStack Query stores each operation/options shape under a separate structured key.

Unrelated keys do not notify each other. Still keep independent subscriptions in separate leaf components: a parent that calls both hooks normally renders when either hook changes.

For badges, stream the scalar:

```tsx
const { data: itemCount = 0 } = useQuery(
	q.collections.cartItems.count({ where: { cartId } }, { realtime: true }),
);
```

Live snapshots are full access-controlled query re-runs, not patches. Narrow them with `where`, finite `limit`, intentional `orderBy`, and only necessary relations. Use a one-shot query for large reports or unsupported realtime projections.

## Select the render value

Query builders return normal TanStack Query options. Spread them and add `select` when a component needs only a projection:

```tsx
const liveOrders = q.collections.orders.find(
	{ where: { status: "overdue" }, limit: 20 },
	{ realtime: true },
);

const { data: firstOrderId } = useQuery({
	...liveOrders,
	select: (snapshot) => snapshot.docs[0]?.id,
});
```

Narrow the server query first; `select` reduces observer/render work, not database or transport cost. Keep expensive selectors stable.

## Bound channel state

`q.channels.<name>.subscription(params)` accumulates all received messages into a new array. Use it only for short-lived, moderate streams. For high-rate or long-lived streams, use `subscribe()`/`iter()` and maintain a bounded ring/window or latest-value map.

Throttle noisy producers such as cursor/typing updates, keep payloads small, and always unsubscribe or abort on unmount. Ordered channel events are not coalesced. Recover an explicit replay gap from persisted collection state; the bounded ledger is not durable history.

## Presence contract

`.authorize(...).presence(resolver)` creates a typed presence channel, and the client reads a snapshot:

```ts
const members = await client.channels.chatRoom.presence({ roomId });
```

Presence is not currently a public reactive stream:

- Pusher/Soketi provides native membership and the transport tracks changes while mounted.
- SSE presence is coarse and app-instance-local.
- There is no public `subscribePresence()` or TanStack presence query yet.

Do not claim globally exact live occupancy and do not manufacture trusted membership with client-published join/leave events.

## Lifecycle and diagnostics

Direct `live()`/`subscribe()` consumers must clean up on parameter change and unmount. Prefer `AbortSignal` for iterators and effects. Inspect these counters during navigation/leak tests:

```ts
client.realtime.topicCount;
client.realtime.subscriberCount;
client.channels.channelCount;
client.channels.subscriberCount;
```

Equivalent server refresh work is shared per principal by default. Never share across principals without proving deterministic row/field access and `afterRead` equivalence.

## Checklist

1. Choose live query, live count, channel, or normal query intentionally.
2. Split unrelated subscriptions into leaf components.
3. Narrow query shape before optimizing React.
4. Use `select` for the value actually rendered.
5. Bound channel state and throttle noisy producers.
6. Clean up every direct subscription.
7. Treat replay and presence as bounded delivery features.
8. Measure query cost, snapshot bytes, topics, subscribers, and React commits at realistic event rates.
