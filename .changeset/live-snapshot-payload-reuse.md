---
"questpie": patch
---

Reuse each route LIVE evaluation's normalized typed payload for both change detection and SSE delivery. Emitted snapshots now visit application getters and `toJSON` methods once instead of twice; the bytes sent describe the same data that was hashed, even if the original object changes during asynchronous hashing. Keep serializers deterministic and free of side effects rather than relying on their previous duplicate invocation.

Date metadata, unchanged-result watermarks, and authority checks after hashing are preserved. Collection/global snapshot and delta behavior is unchanged. This removes duplicate payload normalization; it does not share route results across watchers or establish a measured throughput increase.
