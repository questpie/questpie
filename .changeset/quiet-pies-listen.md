---
"questpie": patch
---

Write realtime outbox entries in the same transaction as collection and global mutations so committed changes remain recoverable when post-commit notifications are lost.
