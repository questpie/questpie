---
"questpie": minor
---

Stop realtime discarding writes and swallowing the reason a subscription failed.

**A failed change capture no longer hands you a record for a row that does not
exist.** Capture runs inside the caller's transaction, so a failure there has
already aborted it. The `catch` that swallowed the error could not save the
write: the later `COMMIT` was silently degraded to `ROLLBACK`, and `create()`
resolved with a fabricated record carrying a generated id while the row was
absent. Reproduced for `42P01` and `55P03`. A capture failure is now always
fatal to the write.

That rollback used to be gated on `realtime.nativeDeltasEnabled`, which made a
delivery-mode flag load-bearing for write correctness — and its default of
`false` was the losing setting. The flag now selects a delivery mode and nothing
else. A missing realtime log table is also no longer silenced; it reports itself
as the configuration error it is.

**A stream that fails to start reports it.** The catch closed the stream
controller before calling `controller.error()`, and a closed controller discards
it, so any failure inside the SSE `start()` reached the client as HTTP 200 and a
cleanly closed empty stream. The error is now raised before teardown. Note the
remaining gap: once any topic has received a sequence, the client still
suppresses connection errors and retries silently, so this fixes the server half
only.

**Topology rejections arrive typed, at the right topic.** Two separate faults
made every rejection on the control channel useless. It is keyed by
`topologyEntryId` while the client read only `topicId`, so it resolved to
`undefined` and reached nobody; and the control handler forwarded only
id/kind/code/message, discarding the typed rejection the server attaches under
`rejection`, so even a routed one could only ever become a bare `Error` and the
rejected topic stayed mounted in the desired topology. Both are fixed, so these
now raise `RealtimeTopicRejectedError` with a reason and tear the topic down.
This matters more than it sounds: the open POST carries only the topics present
at connect, so every topic mounted afterwards travels this path.

One gap remains, and it is in a path the framework itself never takes.
`RealtimeMultiplexer` can be constructed directly without a shared connection,
and its own stream loop suppresses connection errors once any topic has received
a sequence. `createRealtimeSession` always injects `SseConnectionManager`, which
classifies terminal statuses, so first-party clients are unaffected.

**`RealtimeTopicRejectionReason` covers the reasons the server actually emits.**
It had five members while the server produced twelve, so `connection_limit` —
the reason behind a filled connection cap — could not be expressed, let alone
classified. Added: `connection_limit`, `subscription_limit`, `access`,
`not_found`, `operation_shape`, `since_seq_invalid`, `activation_rejected`, plus
an `observed` count beside `configuredLimit`, because those two numbers are the
whole diagnosis. The server and client now share one union instead of two that
drifted. `isRealtimeTopicRejectedPayload` is exported, so consumers stop
reimplementing the guard.

This is the source-breaking part: an exhaustive `switch` over
`RealtimeTopicRejectionReason` will now fail to compile. That is the intended
outcome.

**Context extensions are part of the subscription group key.** They decide what
field-level access, `columns` and `afterRead` return, so subscribers whose
extensions differ are not entitled to the same bytes. Leaving them out meant a
single user with two workspaces open could receive the first workspace's rows in
the second workspace's tab, with no configuration involved. An extension that
cannot be serialized now isolates the subscriber instead of sharing.

`scaling.mdx` claimed every row was re-checked against each subscriber's own
rules on every recompute. It is not, and a second page said so. The page now
describes what actually holds: row-level rules are safe because the access
predicate is part of the group key, while field-level access, `columns` and
`afterRead` run once per group.

**A shared group survives losing the subscriber that created it.** A group computes
once and delivers to everyone, so one subscriber's closure does the work — and
that closure asserts its own connection's fence. When the creating connection
went away the group kept calling it, so every remaining subscriber received
`Realtime owner is fenced` and no further snapshot, permanently, with nothing
classifying the error as terminal so nothing tore the topic down. Two tabs and
closing the first was enough. The group now adopts a live subscriber's closures.

This does not make a widened group key safe on its own: the adopted closure
still carries its own context, so field-level access, `columns` and `afterRead`
run as whichever subscriber is currently providing.

**A node with no subscribers stops replaying the outbox at boot.** `initialize()`
runs on every node while the drain cursor is seeded only by `subscribe()`, so an
idle node walked the entire retained window — three days of it by default — into
an empty listener set, on every deploy.

Also removed: a per-capture `max(seq)` subquery over the whole log, and a second
head-row `UPDATE` writing a column that is never read.
