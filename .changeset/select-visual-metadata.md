---
"questpie": patch
"@questpie/admin": patch
---

Add first-class visual metadata (`icon`, `description`, `className`) to `f.select()` options. Options now flow end-to-end through introspection so the admin renders icons and tonal styling in cells, single/multi dropdowns, and selected-value chips without per-project cell overrides. Adds `c` (component callback proxy) to the fields callback context so `c.icon("ph:check-circle")` is in scope inside `({ f, c }) => f.select([...])`.
