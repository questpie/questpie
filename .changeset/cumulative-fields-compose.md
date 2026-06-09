---
"questpie": patch
---

`.fields()` on collections and globals is now cumulative: it adds to fields the builder already has (from earlier `.fields()` calls or `.merge()`) and overrides them by key, instead of silently replacing all prior field state. This fixes the documented starter-user extension recipe — `collection("user").merge(starterModule.collections.user).fields(...)` previously wiped every starter field and broke auth at runtime. Redefining a key fully replaces that field (stale localized/virtual/relation state is dropped), and `.merge()` now also preserves unresolved relation fields from both sides instead of clobbering the left side's.
