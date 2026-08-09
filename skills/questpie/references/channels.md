---
name: questpie-core/channels
description:
  QUESTPIE typed channels channel factory schema validated application events subscribe publish authorization presence replay SSE Pusher Soketi TanStack Query
  - questpie-core
---

This skill builds on questpie-core.

# Channels

Channels are typed, ordered application-event streams over the realtime runtime. Use them for chat notifications, progress, typing, or presence. The bounded replay ledger is delivery infrastructure, not durable application history; persist events users must retrieve later in a collection.

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
existing server collisions keep working through the deprecated root API in
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
the owning mutation transaction, so a publish failure rolls back both the
mutation and ordered channel-ledger append. Never import the generated `app` or
defer lookup through ambient `getContext()`; the injected service is
generated-type-safe and mutation-context aware.

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
remains a deprecated 3.x compatibility entry point backed by the same ledger. New code
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

- Events are ordered per resolved channel and never coalesced. Reconnect can replay an id; clients deduplicate it.
- Falling behind the bounded replay horizon raises an explicit gap. Recover from persisted state or subscribe from now.
- Payloads must be JSON-serializable and at most 10,000 UTF-8 bytes.
- Cookie-authenticated authority routes require an exact trusted Origin; configure extra origins under `realtime.channelSecurity.trustedOrigins`.
- Client publish token buckets default to 10/s with burst 20 per session and principal.
- Pusher/Soketi is an opt-in transport preset. Direct provider client events are a separate unsafe capability and are off by default.
