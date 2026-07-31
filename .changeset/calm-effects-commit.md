---
"questpie": minor
---

Make transaction-bound collection and Global hooks fail atomically by default.
Errors from `afterChange`, `afterDelete`, and purge hooks now propagate and roll
back the owning mutation together with nested CRUD, Queue, Channels, and
realtime ledger work.
