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
- Authorization and presence resolvers receive the full request-scoped `AppContext`,
  including collections, services, application context extensions, and the caller's
  database handle. Framework-owned context keys cannot be shadowed by an extension.

## Publish on the server

Framework handlers and hooks receive a generated `channels` service:

```ts
.handler(async ({ input, channels }) => {
	return channels.publish("chatRoom", {
		params: { roomId: input.roomId },
		event: "message",
		data: { id: input.id, text: input.text },
	});
});

.hooks({
	afterChange: [async ({ data, channels }) => {
		await channels.publish("chatRoom", {
			params: { roomId: data.roomId },
			event: "message",
			data: { id: data.id, text: data.text },
		});
	}],
});
```

In collection/global/hook files, use the injected `{ channels }`. Hooks run in
the owning mutation transaction, so a publish failure rolls back both the
mutation and ordered channel-ledger append. Never import the generated `app` or
defer lookup through ambient `getContext()`; the injected service is
generated-type-safe and mutation-context aware.

## Revoke current delivery authority

When a membership or authorization mutation removes access, cut the affected
resolved channel in the same transaction:

```ts
await channels.revokeAuthority("chatRoom", {
	params: { roomId },
	subject: { kind: "user", id: removedUserId },
	idempotencyKey: `chat-room:${roomId}:${removedUserId}:membership-v2`,
});
```

The idempotency key identifies the domain authorization transition. QUESTPIE
advances a durable per-channel/subject generation and returns
`{ generation, scope }`. `scope: "exact-subscription"` means the local SSE
binding is cut without closing unrelated channel bindings.
`scope: "principal-connections"` means the provider can only conservatively
terminate every current connection for the signed-in user. Pusher supports the
`user` subject for that capability.

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
pending for an idempotent retry.

Pusher does not provide zero-frame atomicity: a frame already accepted by the
physical provider connection may arrive while termination is in flight. The
durable fence prevents new ordered provider dispatch from crossing a pending
cut; reconnect and replay reauthorize against current application state.

## Client, presence, and TanStack Query

```ts
const stop = client.channels.chatRoom.subscribe(
	{ roomId },
	(message) => {
		if (message.event === "message") console.log(message.data.text);
	},
	{
		onReady: reconcileAuthoritativeRoom,
		onError: markRoomReadOnly,
	},
);

await client.channels.chatRoom.publish({
	params: { roomId },
	event: "typing",
	data: { active: true },
});

const members = await client.channels.chatRoom.presence({ roomId });
const stopPresence = client.channels.chatRoom.subscribePresence(
	{ roomId },
	onMembers,
);
stop();
stopPresence();
```

`onReady` is provider-neutral and payload-free. It fires once per successful
subscription epoch only after current authorization and replay/catch-up: replay
events precede it and later live events use the normal callback. Reconnect
freshly authorizes and replays before firing it again. Socket open alone is not
readiness, and denial, replay gap, aborted setup, or stopping before admission
does not fire it. Leaving Pusher/Soketi's connected state ends the epoch and
invalidates any pending replay until fresh provider subscription and catch-up.
Keep protected state fenced after `onError`; use `onReady` to
start an authoritative read, and make the event callback schedule a trailing
read when an invalidation races with that reconciliation.

`presence()` returns one typed snapshot. `subscribePresence()` emits the initial and later rosters, and `presenceIter(params, { signal })` provides the async-generator form. Pusher/Soketi uses native membership; SSE uses Postgres leases across instances and deduplicates multiple connections by authenticated principal. Crash leave converges after the lease TTL.

Async consumers use `client.channels.chatRoom.iter(params, { signal })`. TanStack Query exposes an accumulating event query:

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
