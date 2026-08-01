---
"questpie": minor
---

Add a server-only `beforeWrite` collection hook for revalidating dependent
durable facts inside generated CRUD transactions. The hook receives fresh
primary preimages and a bounded, access-aware helper that claims dependent rows
in deterministic physical-table and type-tagged id order before any mutation
DML or transaction-bound effects.
