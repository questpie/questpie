---
"questpie": patch
---

Remove deprecated collection/global scoped `.functions()` RPC from builders and runtime routes. RPC is now app-level only via `rpc().router(...)` on `/rpc/:path...`.

Update docs to match current behavior:
- runtime install baseline is `questpie` (add `zod`/`drizzle-orm` only when imported directly)
- explicit sidebar items are automatically excluded from the auto-generated section
- `where.RAW` now documents and supports optional i18n aliases via `(table, { i18nCurrentTable, i18nFallbackTable })`
