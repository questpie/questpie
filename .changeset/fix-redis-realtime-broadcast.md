---
"questpie": patch
---

Fix Redis realtime delivery so every app instance receives each wake. The adapter now uses an independent XREAD cursor per instance, caps its stream with approximate MAXLEN trimming, recovers from read failures, and waits for its read loop during shutdown.
