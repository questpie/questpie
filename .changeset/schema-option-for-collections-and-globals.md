---
"questpie": patch
---

Add `schema?: string` option to collections and globals for placing tables under a named Postgres schema instead of `public`. Applies to all four table variants (main, i18n, versions, i18n_versions). `migrate:generate` emits `CREATE SCHEMA IF NOT EXISTS "<name>";` for new schemas and cross-schema relations render as `REFERENCES "other_schema"."table"("id")`. Unset (default) stays on `public` — fully backward-compatible.
