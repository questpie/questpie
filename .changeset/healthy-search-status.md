---
"questpie": patch
---

Fix `/health` reporting `search: degraded` forever. The health route checks `app.search.isInitialized?.()`, but no such method existed on `SearchServiceWrapper`, so every app — including ones with a working default Postgres search adapter — reported degraded search. `SearchService` now exposes `isInitialized(): boolean`.
