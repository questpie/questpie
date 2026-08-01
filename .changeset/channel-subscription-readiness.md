---
"questpie": minor
---

Add `onReady` to channel subscriptions — a provider-neutral signal that the
subscription is authorized **and** has finished replay catch-up.

```ts
client.channels.subscribe("space", { spaceId }, handler, {
	onReady: () => {
		// authorized, caught up; everything from here is live and complete
	},
});
```

Until now a subscriber had no way to tell "still replaying history" from
"caught up and live". The only callback was `onError`, so applications either
guessed with a timer or treated the first frame as readiness — which is wrong
whenever replay has more than one frame to deliver.

The signal fires once per transport subscription epoch and works the same way on
SSE and Pusher. On SSE the server emits a `channel_ready` control frame after
authorization and catch-up; the client orders it against replay and live
delivery so a subscriber never sees a live frame before its readiness callback.
Reconnects end the epoch and re-signal.

Presence subscriptions deliberately do not expose it —
`ChannelPresenceOptions` is `ChannelSubscribeOptions` without `onReady` — because
a presence read is one-shot and has no catch-up to complete.

Consumer callbacks are also isolated from one another: a throwing `onReady` or
`onError` in one subscriber no longer takes down delivery for its siblings.

The channel transports are also loaded on demand now, so an application that
never opens a channel no longer pays for them at all. Together with the change
above the browser entry chunk drops from 180.5 KB to 115.6 KB — roughly 65 KB
less than before this feature was added.
