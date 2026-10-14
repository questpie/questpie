---
"questpie": patch
---

Keep the Postgres realtime broker connected after the database restarts, terminates its connections or stops answering.

- If a reconnect attempt was refused (the server still starting, connections not yet accepted), the broker reused the failed `pg` client; its `LISTEN` waited forever, no further reconnect was scheduled and `stop()` hung, so realtime wakes stopped until the process restarted. The publisher and `startPublisher()` had the same reuse problem. Failed clients are now discarded and replaced on the next attempt, and an "already connected" client is accepted only when you supplied it yourself.
- A `LISTEN` the server refuses on a live connection (for example on a standby after a failover) now reconnects on a new session instead of retrying the same one.
- Owned clients now use TCP keepalive and a connect timeout, every LISTEN, UNLISTEN, publish and close is bounded, and the LISTEN connection runs a periodic health check. A server that accepts TCP but never answers, or a network path that silently stops delivering, no longer leaves `start()`, `stop()` or publishes pending forever or the listener "connected" without receiving anything. Tune with the new `connectionTimeoutMs` (default 10 s; `connection.connectionTimeoutMillis` still overrides the connect part) and `healthCheckIntervalMs` (default 30 s) options.
- Terminating the publisher connection, or the connection closing while `stop()` runs, no longer raises an unhandled `error` event from `pg`.
