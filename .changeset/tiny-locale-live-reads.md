---
"@questpie/tanstack-query": patch
---

Forward the configured locale to collection find/count and global get reads and their LIVE topics. Explicit per-read locale takes precedence; factories without a configured locale retain their existing behavior. This prevents distinct locale Query keys from sharing a topic that cannot provide the new key's first snapshot.
