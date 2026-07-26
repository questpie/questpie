---
"questpie": minor
"@questpie/admin": minor
---

Add a generic, Admin-independent client i18n adapter with strict locale and
catalog validation, bounded Intl formatter caches, base-language RTL detection,
and separately importable React bindings built on `useSyncExternalStore`.

Reuse the generic adapter and React bindings inside `@questpie/admin` while
preserving its server-fetched catalog compatibility layer.
