---
"questpie": minor
---

Add `lockMany({ ids, mode: "update" })` to block foreign-key child inserts when an aggregate requires it; the default remains `FOR NO KEY UPDATE`, and unknown modes return a bad request. Add `db: { url, driver: "node-postgres" }` to select the optional pg peer on Bun as well as Node, preserving automatic selection when omitted.

Preserve caller and transaction AsyncLocalStorage through database transaction callbacks, including Bun SQL cold acquisition and idle reconnects. Prevent queue startup and reconciliation from failing secret receipts or erasing their keys merely because another adapter or schema does not recognize their identity. Inspection now returns `unknown` when ownership is unproven; `missing` remains terminal evidence only for a known, owned dispatch whose broker job is gone. Switching adapters still requires transferring pending work before it can execute on the new broker.

`QueueExecutionState` now includes `"unknown"`. This widens the exported union: third-party adapters and consumers with exhaustive switches must add an `unknown` branch that preserves live receipts. Adapters can supply a stable `executionIdentity` and accept the optional publishing identity in `inspectExecutionState` to distinguish their retention-deleted jobs from foreign receipts.

Generate and apply a database migration before running the upgraded queue: the internal `questpie_queue_dispatch` table adds nullable `adapter_identity`. New receipts retain their broker/database/schema identity after pg-boss job retention or Graphile ledger pruning, so reconciliation can terminalize owned missing jobs and erase their wrapped keys. Foreign identified receipts are excluded from inspection. Reconciliation inspects at most 20 batches per call, resumes capped scans, and backs off unknown receipts for one hour. Legacy receipts without identity are adopted when broker inspection proves ownership; if they remain unknown for 30 days after acceptance, they fail and their wrapped keys are erased. Transfer or settle older unclassified live work before upgrading.
