---
"questpie": patch
---

Reduce database transactions during durable Channel fan-out by batching concurrent frame admissions. Each protected attempt still checks its exact subject and generation, including retries after a busy sink. Existing logical revocation semantics remain unchanged: transport writes run outside the fence transaction, and a frame admitted before a cut may finish afterward.
