---
"questpie": minor
---

Add a server-only `beforeWrite` collection hook for revalidating dependent
durable facts inside generated CRUD transactions. Composed guards synchronously
declare one bounded lock plan before any guard runs, then read exact generated
collection types through the ordinary transaction-bound `ctx.collections` API.
Dependent rows are claimed per physical table in the same deterministic order
as relation targets before mutation DML or transaction-bound effects.
