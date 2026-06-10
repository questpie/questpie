---
"questpie": patch
---

Query-layer correctness fixes:

- **Multi-field `orderBy` applies all clauses.** Drizzle's `.orderBy()` replaces previous clauses instead of appending, so `orderBy: [{ a: "desc" }, { b: "asc" }]` (and the multi-key object syntax) silently applied only the LAST field — including inside relation `with` options. Clauses are now passed in one variadic call, so multi-field sort priority works as documented.
- **System timestamps are now `timestamp(3)` (millisecond precision).** `created_at` / `updated_at` / `deleted_at` / `version_created_at` and the internal search/realtime tables previously stored microseconds, which a JS `Date` cannot represent — round-tripped timestamps compared as *less than* the stored value, breaking `eq` and keyset-cursor pagination (skipped/duplicated rows at millisecond boundaries). Stored values now round-trip a `Date` exactly. Upgrading emits a one-time `ALTER COLUMN … TYPE timestamp(3)` rewrite per system column — see `MIGRATION.md`.
- **`questpie push` works on the default bun-sql driver.** drizzle-kit's `pushSchema` assumes node-postgres result shape (`execute().rows`), but bun-sql returns rows directly, crashing introspection (`undefined is not an object (evaluating 'namespaces.reduce')`). Driver-native results are now normalized at one seam (`rowsOf`/`toKitDb`), which also replaces the scattered `result.rows || result` sniffs in seed/migration runners and the Postgres search adapter.
