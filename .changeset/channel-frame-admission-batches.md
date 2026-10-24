---
"questpie": patch
---

Reduce database transactions during durable Channel fan-out by batching concurrent frame admissions. Each protected attempt still checks its exact subject and generation, including retries after a busy sink. Existing logical revocation semantics remain unchanged: transport writes run outside the fence transaction, and a frame admitted before a cut may finish afterward.

Batches own their transaction completion; remembered binding generations change only after a successful commit. Closing a binding removes its waiting attempts, and late completions cannot overwrite newer reconciliation. Each ledger limits pending attempts to 4,096 and active batches to two, with 64 attempts per batch; overflow fails delivery through the existing failure path.

Local frame delivery inside a caller-owned transaction now fails before transport output. Defer delivery until after commit instead of awaiting it inside the transaction. Ordinary transactional channel publishing remains supported; its normal after-commit wake path is unchanged. This patch does not share route LIVE results or introduce an authorization cache.
