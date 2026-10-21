---
"questpie": minor
---

Add `lockMany({ ids, mode: "update" })` to block foreign-key child inserts when an aggregate requires it; the default remains `FOR NO KEY UPDATE`, and unknown modes return a bad request. Add `db: { url, driver: "node-postgres" }` to select the optional pg peer on Bun as well as Node, preserving automatic selection when omitted.

Preserve caller and transaction AsyncLocalStorage through database transaction callbacks, including Bun SQL cold acquisition and idle reconnects. Prevent queue startup and reconciliation from failing secret receipts or erasing their keys merely because another adapter or schema does not recognize their identity. Inspection now returns `unknown` when ownership is unproven; `missing` remains terminal evidence only for a known, owned dispatch whose broker job is gone. Switching adapters still requires transferring pending work before it can execute on the new broker.
