---
"questpie": patch
---

Make realtime startup, drain, listener, and cleanup failures crash-safe. Transport failures now reach SSE clients as an error before the stream closes, and change capture only silently ignores a missing outbox table.
