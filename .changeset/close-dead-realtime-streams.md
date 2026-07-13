---
"questpie": patch
---

Tear down SSE realtime listeners and timers when a stream can no longer enqueue data. Permanently denied topics are now unsubscribed instead of retrying an access failure after every matching change.
