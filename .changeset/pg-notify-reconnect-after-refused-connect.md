---
"questpie": patch
---

Keep the Postgres realtime broker connected after the database restarts or terminates its connections. If a reconnect attempt was refused (the server still starting, connections not yet accepted), the broker reused the failed `pg` client; its `LISTEN` waited forever, no further reconnect was scheduled and `stop()` hung, so realtime wakes stopped until the process restarted. The publisher had the same reuse problem, so every later publish queued behind a `pg_notify` that never ran. Terminating the publisher connection also raised an unhandled `error` event from `pg`. Failed clients are now discarded and replaced on the next attempt, and the publisher keeps its error handlers until its client is replaced.
