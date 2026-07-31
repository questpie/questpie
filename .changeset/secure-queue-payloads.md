---
"questpie": minor
---

Add transactional Queue dispatches for short-lived secret payloads. Payloads are
envelope-encrypted before durable storage or broker publication, their wrapped
data keys are erased after durable completion or an unclaimed broker-terminal
outcome, and applications can read a payload-free queued/completed/failed
receipt by stable dispatch id. This release qualifies pg-boss through durable
broker-state reconciliation and fails secret publication closed on BullMQ,
Cloudflare Queues, and unqualified custom adapters. Deploy the additive Queue
ledger migration before enabling secret dispatches; populated legacy rows remain
ordinary non-secret dispatches. Separate-database pg-boss relays recover the
stable physical Job identity after an uncertain publication receipt only after
proving that exact broker row exists; other queue-policy conflicts fail closed.
Transactional publication performs the same proof through the caller's
transaction connection. Accepted secret work is reconciled through finite
snapshot pages so older active Jobs cannot starve later terminal key erasure.
