---
"questpie": minor
---

Add batchRead for field read policies that acquire permission facts once per authorized page. It returns one boolean per selected document and preserves existing per-row rules, system bypass, nested field filtering, and hook ordering. The additive batch context includes the effective database handle, so permission facts inside a query route use its read-only snapshot; use this handle instead of a captured root app.db.

The callback is evaluated afresh per field path and read, without a permission cache. Globals and write responses use a singleton batch; row-dependent aggregates remain unsupported. In the PGlite growth fixture, 10/50/100 roots each use five statements: page plus count, then one fact lookup for each of three protected field paths. This does not optimize I/O loops inside callbacks or establish PostgreSQL plan/throughput performance.
