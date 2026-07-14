---
name: questpie-core/channels
description:
  QUESTPIE typed channels channel factory schema validated application events subscribe publish authorization presence replay SSE Pusher Soketi TanStack Query
  - questpie-core
---

This skill builds on questpie-core.

# Channels

Channels are typed, ordered application-event streams over the realtime runtime. Use them for chat notifications, progress, typing, or presence. The bounded replay ledger is delivery infrastructure, not durable application history; persist events users must retrieve later in a collection.

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

In collection/global/hook files, use the injected `{ channels }`. Never import the generated `app` or defer lookup through ambient `getContext()`; the injected service is generated-type-safe and mutation-context aware.

## Client, presence, and TanStack Query

```ts
const stop = client.channels.chatRoom.subscribe({ roomId }, (message) => {
	if (message.event === "message") console.log(message.data.text);
});

await client.channels.chatRoom.publish({
	params: { roomId },
	event: "typing",
	data: { active: true },
});

const members = await client.channels.chatRoom.presence({ roomId });
stop();
```

`presence()` returns one typed member snapshot. Pusher/Soketi tracks native membership while mounted; SSE presence is coarse and app-instance-local. There is no public `subscribePresence()` or TanStack presence query yet, so do not claim a continuously reactive, globally exact occupancy contract. See `references/reactive-apps.md`.

Async consumers use `client.channels.chatRoom.iter(params, { signal })`. TanStack Query exposes an accumulating event query:

```tsx
const { data: messages = [] } = useQuery(
	q.channels.chatRoom.subscription({ roomId }),
);
```

This differs from live-query `{ realtime: true }`, which retains only the latest snapshot.

## Delivery and security

- Events are ordered per resolved channel and never coalesced. Reconnect can replay an id; clients deduplicate it.
- Falling behind the bounded replay horizon raises an explicit gap. Recover from persisted state or subscribe from now.
- Payloads must be JSON-serializable and at most 10,000 UTF-8 bytes.
- Cookie-authenticated authority routes require an exact trusted Origin; configure extra origins under `realtime.channelSecurity.trustedOrigins`.
- Client publish token buckets default to 10/s with burst 20 per session and principal.
- Pusher/Soketi is an opt-in transport preset. Direct provider client events are a separate unsafe capability and are off by default.
