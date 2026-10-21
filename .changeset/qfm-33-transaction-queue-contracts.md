---
"questpie": minor
---

Add `lockMany({ ids, mode: "update" })` to block foreign-key child inserts when an aggregate requires it. The default remains `FOR NO KEY UPDATE`, and unknown modes return a 400 bad request.

Preserve caller and transaction AsyncLocalStorage through database transaction callbacks with `AsyncResource.bind`, including Bun SQL cold acquisition and idle reconnects.

Add `db: { url, driver: "node-postgres" }` to select the optional `pg` peer on Bun as well as Node, preserving automatic selection when omitted. A missing `pg` peer now reports the selected driver and how to install the dependency.
