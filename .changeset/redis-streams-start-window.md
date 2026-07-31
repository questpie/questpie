---
"questpie": patch
---

Fix Redis Streams dropping wakes published right after `start()`.

`RedisStreamsChangeBroker.start()` connected its reader and then launched the
read loop **without awaiting it**, and the loop opened with `XREAD … id="$"`.
`$` means "messages that arrive after this call reaches the server", so anything
published between `start()` resolving and the loop's first read was silently
dropped and never redelivered:

```ts
await broker.start({ onWake });
await broker.publish(wake); // could vanish
```

`pg-notify` never had this problem — its `start()` awaits `LISTEN`, so the
subscription exists before it returns. Two implementations of one `ChangeBroker`
interface were giving different delivery guarantees.

`start()` now resolves the concrete stream id first and reads from there, so it
means "subscribed from here" rather than "reader connected". Clients that cannot
report stream info fall back to `$`, which is no worse than before.

This is what a flaky CI failure in the realtime driver matrix turned out to be —
the test timed out on the full deadline rather than near it, which is the
signature of a message that never arrives rather than a slow one.

Also stops `oxfmt` from flagging generated `CHANGELOG.md` files, which the
release tooling rewrites on every publish and which therefore turned the format
gate red after each release.
