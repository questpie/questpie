---
"questpie": patch
---

Remove waiting realtime computations when their last subscriber closes, immediately freeing space in the bounded compute queue. Closed snapshot and delta groups no longer start queued computation. Shared groups continue serving remaining subscribers, and active computations retain their concurrency slot until they finish.
