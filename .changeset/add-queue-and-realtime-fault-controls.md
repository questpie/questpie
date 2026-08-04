---
"@questpie/testing": minor
---

Add `drainQueue` and `cycleRealtimeTransport` to `@questpie/testing/scenario`,
two generic fault levers for scenario tests.

`drainQueue` waits for a queue to go quiet. Quiet means several consecutive zero
readings rather than the first one, because a job that enqueues its follow-up
leaves a gap where the queue reads as empty, and a drain that returns on that gap
is the flake that fails one run in twenty. It is bounded: a queue that never
settles fails with the last count it saw instead of hanging the suite.

`cycleRealtimeTransport` drops a realtime transport and brings it back. It calls
your own connect and disconnect and touches nothing else, so it never writes to a
channel ledger or any other durable store. It reconnects even when the disconnect
throws, because a transport left down by a failed fault injection breaks every
test after it and points the blame at the wrong place.

Both take what to probe or drive from the caller, so neither names a queue,
adapter or channel. Both record what they observed into the shared evidence ring.
