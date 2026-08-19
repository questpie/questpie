---
"questpie": patch
---

Accept a CRDT hold that arrives alongside live-query topics or channels.

One SSE connection multiplexes every realtime resource a page holds, and the
client's own `openTopology()` sets `crdtHold: true` whenever a CRDT resource
exists while still sending its `topics` and `channels` arrays. The bootstrap
validation rejected exactly that payload with `realtime.topicsRequired`, so any
screen that edited a collaborative document while subscribed to anything else
could not open the document at all.

The guard now treats `crdtHold` as additive rather than exclusive, matching the
comment above it ("Initial sessions may carry live-query topics, framework
channels, or both") and every downstream use of the flag. The only bootstrap
still refused is one that asks for no topic, no channel and no hold.
