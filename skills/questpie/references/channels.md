---
name: questpie-core/channels
description:
  QUESTPIE typed channels channel factory schema validated application events subscribe publish authorization presence replay SSE Pusher Soketi TanStack Query
  - questpie-core
---

This skill builds on questpie-core.

# Channels

Channels are typed application-event streams over the realtime runtime. Ordinary channels preserve ordered events with bounded replay; ephemeral channels carry replaceable cursors, typing and presence without event/presence rows. Use collections plus live queries for re-readable messages, notifications and lists. The bounded replay ledger is delivery infrastructure, not durable application history; persist events users must retrieve later in a collection.

Ordered events, replay, and presence preserve nested `Date` values over SSE and
Pusher/Soketi using the same versioned metadata as live queries. ISO-looking
string fields remain strings. The reserved metadata key and its bytes are part
of the canonical bounded envelope.

## Define and generate

```ts title="channels/chat-room.ts"
import { channel } from "questpie/channels";
import { z } from "zod";

export default channel("chat-room-[roomId]")
	.events({
		message: z.object({ id: z.string(), text: z.string() }),
		typing: z.object({ active: z.boolean() }),
	})
	.authorize({
		subscribe: ({ session }) => Boolean(session?.user),
		publish: ({ session }) => Boolean(session?.user),
	})
	.presence(({ params, session }) => ({
		id: session!.user.id,
		roomId: params.roomId,
	}));
```

The default-export filename derives the registry/API key (`chatRoom`); the builder string is the stable wire pattern. `[roomId]` becomes a required typed parameter. Run `bunx questpie generate` after adding or renaming a channel.

Authorization rules:

- With no `.authorize()`, subscribe is public and browser publish is denied.
- `.authorize(rule)` uses the rule for subscribe and as the publish fallback.
- `.authorize({ subscribe, publish })` separates both permissions; omitted publish falls back to subscribe.
- Server/system contexts may publish; browser publish always uses the framework route, authorization, rate limits, and Zod parsing.

## Publish on the server

Framework handlers and hooks receive a generated `channels` service:

Server facade member names are reserved for canonical handle projection;
existing server collisions keep working through the root API during
3.x. Client channels only collide with actual controls such as `destroy`,
`channelCount`, and `subscriberCount`. Rename a colliding file/export to adopt
handles; keep the wire pattern unchanged.

```ts
.handler(async ({ input, channels }) => {
	const chatRoom = channels.chatRoom({ roomId: input.roomId });
	return chatRoom.publish("message", { id: input.id, text: input.text });
});

.hooks({
	afterChange: [async ({ data, channels }) => {
		const chatRoom = channels.chatRoom({ roomId: data.roomId });
		await chatRoom.publish("message", { id: data.id, text: data.text });
	}],
});
```

In collection/global/hook files, use the injected `{ channels }`. Hooks run in
the owning mutation transaction, so an ordinary channel publish failure rolls
back both the mutation and ordered channel-ledger append. Ephemeral publishes
use a separate best-effort broker and are not rolled back with the mutation. Never import the generated `app` or
defer lookup through ambient `getContext()`; the injected service is
generated-type-safe and mutation-context aware.

## Ephemeral awareness

Define a separate wire pattern for page or conversation awareness:

```ts title="channels/page.ts"
import { channel } from "questpie/channels";
import { z } from "zod";

export default channel("page-awareness-[pageId]")
	.ephemeral({ coalesceMs: 100, maxPayloadBytes: 1024 })
	.events({ typing: z.object({ actorId: z.string(), active: z.boolean() }) })
	.authorize({
		subscribe: ({ session }) => Boolean(session?.user),
		publish: false,
	})
	.presence(({ session }) => ({ id: session!.user.id }));
```

Replace the example subscribe rule with the page's read-access check. It runs
at admission, before each delivery batch and every second while idle, with a
fresh request context. Return the same denial for missing and inaccessible
pages. Denial, including user-mode CRUD permission errors, ends only that binding and removes presence. A failed or timed-out check delivers no unchecked data. The shared client temporarily excludes that channel from its topology and retries it separately, preserving healthy siblings; its fifth consecutive failure calls only that channel’s onError. Successful channel_ready resets the retry count. A live failure may first reconnect the physical stream.

Publish through an authorized application command after resolving actor identity
on the server. A system-bound service can publish for agents or multiple actors:

```ts
await channels
	.page({ pageId })
	.publish("typing", { actorId, active: true }, { coalesceKey: actorId });
```

The server-only key partitions actors independently. Browser publishes cannot
supply it. Throttle cursor POSTs to about 100 ms; server coalescing limits broker
fan-out rather than HTTP input. Set `coalesceMs: 0` on a typing topic for next-turn
flushes. Presence join/leave bypass cursor windows. Subscribe/unsubscribe through
the existing client API and reuse one app client/SSE connection per tab.

Ephemeral events have diagnostic UUID receipts and no replay/resume. Subscribe
presence is in memory with 10 s heartbeats and a 30 s lease; own membership is
known immediately and remote members converge asynchronously. Use ongoing
`subscribePresence` or `presenceIter` for UI state. The shared SSE topology row
and lease remain for cross-pod ownership; the lane creates no event, authority
or presence rows.

The default broker is in-process for PGlite and PostgreSQL NOTIFY for a PostgreSQL
runtime. For explicit setup, use `new InProcessEphemeralBroker()` from
`questpie/channels` for one process, or:

```ts
import { pgNotifyEphemeralBroker } from "questpie/adapters/pg-notify";

realtime: {
 ephemeral: {
  broker: pgNotifyEphemeralBroker({ connectionString: process.env.REALTIME_DATABASE_URL! }),
 },
}
```

`pgNotifyEphemeralBroker` constructs a `PgNotifyEphemeralBroker`: one LISTEN
connection plus one separate autocommit publisher per app process. Supply a
direct/session-pooled URL; a separately configured durable `changeBroker` does
not change this URL. Packets stay below 7900 UTF-8 bytes. Event data defaults to
1024 serialized bytes (maximum configurable 4096); member data is limited to 1024. Pending signals retain 100 keys per topic; deployment admission is
configurable with `maxTopics` and `maxSubscriptionsPerTopic`. Broker adapters
implement the small `EphemeralBroker` start/publish/stop contract; a Redis adapter
can be added later without changing application APIs.

## Invalidate current delivery authority

When a membership or authorization mutation removes access, cut the affected
resolved channel in the same transaction:

```ts
const chatRoom = channels.chatRoom({ roomId });

await chatRoom.invalidateAuthority({
	subject: { kind: "user", id: removedUserId },
	idempotencyKey: `chat-room:${roomId}:${removedUserId}:membership-v2`,
});
```

The resolved handle is the complete authority target: registry definition plus
validated params. There is no second tenant/workspace scope. The idempotency key
identifies one domain authorization transition. QUESTPIE advances the existing
durable per-channel/subject generation and returns
`{ generation, transportEffect }`. `transportEffect: "exact-binding"` means
SSE cut only that logical binding. `"principal-connections"` means the provider
can only terminate every current connection for the signed-in user. Pusher
supports the `user` subject for that capability.

Fresh request context, subscribe authorization, and the presence resolver (for
presence channels) run outside database locks. A short expected-generation
publication installs the binding, latest fresh member payload, and optional
presence lease together; a stale result and stale payload publish nothing and
retry fresh. Internal revocation of the last SSE binding also stops its
demand-driven authority reconciliation. A Pusher client signs in with an opaque
provider user id before channel authorization, reconnects after termination,
then obtains fresh user and per-channel authorization. Its channel grant is
side-effect-free local signing guarded by an optimistic generation check, so a
post-cut blob is discarded before reaching the client. Thus removing Space A
may disconnect Space B briefly, but Space B can reconnect while Space A remains
denied.

In a managed caller transaction, Pusher termination and authority
acknowledgement run inline under a bounded call. Provider failure throws and
rolls back the database transaction; a conservative disconnect may survive a
later caller rollback. Standalone provider failure leaves the durable cut
pending for an idempotent retry. Reusing the same key for another target or
subject is a conflict.

The released root method
`channels.revokeAuthority("chatRoom", { params, subject, idempotencyKey })`
remains a 3.x compatibility entry point backed by the same ledger. New code
uses the resolved handle.

Pusher does not provide zero-frame atomicity: a frame already accepted by the
physical provider connection may arrive while termination is in flight. The
durable fence prevents new ordered provider dispatch from crossing a pending
cut; reconnect and replay reauthorize against current application state.

## Client, presence, and TanStack Query

```ts
const chatRoom = client.channels.chatRoom({ roomId });

const stop = chatRoom.subscribe(
	(message) => {
		if (message.event === "message") console.log(message.data.text);
	},
	{
		onReady: () => setMutationEnabled(true),
		onNotReady: () => setMutationEnabled(false),
		onError: console.error,
	},
);

await chatRoom.publish("typing", { active: true });

const members = await chatRoom.presence();
const stopPresence = chatRoom.subscribePresence(onMembers);
stop();
stopPresence();
```

`onReady` begins an admitted logical subscription epoch after authorization and
replay catch-up. `onNotReady` runs exactly once when that admitted epoch ends;
successful reconnect calls `onReady` again for the next epoch. It is not called
before the subscriber's first `onReady`, or when the subscriber explicitly
stops or aborts. Ordinary reconnects use `onNotReady` without manufacturing an
`onError`; a terminal failure after admission calls `onNotReady` before
`onError`. Lifecycle callback exceptions are isolated from sibling subscribers,
cleanup, and later reconnects.

`presence()` returns one typed snapshot. `subscribePresence()` emits the initial and later rosters, and `presenceIter(params, { signal })` provides the async-generator form. Pusher/Soketi uses native membership; SSE uses Postgres leases across instances and deduplicates multiple connections by authenticated principal. Crash leave converges after the lease TTL.

Async consumers use `chatRoom.iter({ signal })`. TanStack Query exposes an accumulating event query:

```tsx
const { data: messages = [] } = useQuery(
	q.channels.chatRoom.subscription({ roomId }),
);

const { data: members = [] } = useQuery(
	q.channels.chatRoom.presence({ roomId }),
);
```

The event subscription accumulates messages. The presence query and live-query `{ realtime: true }` retain only the latest snapshot.

## Delivery and security

- Ordinary channel events are ordered per resolved channel and never coalesced. Reconnect can replay an id; clients deduplicate it.
- Falling behind the bounded replay horizon raises an explicit gap. Recover from persisted state or subscribe from now.
- Payloads must be JSON-serializable and at most 10,000 UTF-8 bytes.
- Cookie-authenticated authority routes require an exact trusted Origin; configure extra origins under `realtime.channelSecurity.trustedOrigins`.
- Client publish token buckets default to 10/s with burst 20 per session and principal.
- Pusher/Soketi is an opt-in transport preset. Direct provider client events are a separate unsafe capability and are off by default.
