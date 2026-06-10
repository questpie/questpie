---
"questpie": minor
"@questpie/tanstack-query": minor
---

Realtime client contract: typed live queries as the documented primitive. New `live()` / `liveIter()` on collection and global clients mirror `find()` / `get()` typing — same `where`/`with`/`orderBy` aliases in, the same result type out — delivered as access-controlled snapshots over the existing multiplexed SSE connection (no new transport; identical queries share one topic). `client.realtime.subscribe` gains a snapshot type parameter and an `onError` callback. `@questpie/tanstack-query` now types the `{ realtime: true }` second argument on `find()`/`count()`/`get()` (`RealtimeQueryConfig`) and fixes option inference for optional-argument builders, so the documented calls compile without casts. The SSE keep-alive ping default drops from 15s to 8s — strictly under Bun's default 10s `idleTimeout` — and is tunable via `realtime.keepAliveIntervalMs`. The `POST /realtime` wire protocol (`snapshot`/`error`/`ping` events) is now documented as a stable contract.
