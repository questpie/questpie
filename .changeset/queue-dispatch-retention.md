---
"questpie": patch
---

Bound the cost and the size of the queue dispatch ledger (`questpie_queue_dispatch`).

- Execution reconciliation, which runs on every drain, is now served by a partial index, `idx_queue_dispatch_reconcile` on `(created_at, dispatch_id)` over accepted secret-payload rows with a broker job id. Before, each run read and sorted every accepted row.
- Finished ledger rows now have bounded retention. A listening worker deletes, at most once every 5 minutes and in batches of at most 500 rows (at most 20 batches per run), `completed` and `failed` rows 7 days after they finished and `accepted` rows of non-secret jobs 7 days after hand-off to the adapter. Pending rows, rows with a live relay lease or execution claim, and accepted secret-payload rows are never deleted. The batches are served by a second partial index, `idx_queue_dispatch_prune`.

Both indexes are part of the framework schema: generate and apply a migration after upgrading (`questpie migrate:generate`, then `questpie migrate:up`). The migration only adds the two indexes. On a large existing ledger, `CREATE INDEX` blocks writes to the table while it builds; the prune runs then work off the backlog at up to 10,000 rows per worker every 5 minutes.

Behaviour change: the ledger honours an `idempotencyKey` for 7 days after its dispatch was handed off (non-secret jobs) or finished (secret-payload jobs), instead of forever. A caller that re-uses a key after that window enqueues again: it gets a new dispatch with the same `dispatchId`, handed to the adapter once more. An adapter that still holds the earlier job under that id (pg-boss keeps finished jobs for 7 days by default) suppresses the duplicate itself until it drops that job.
