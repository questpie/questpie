---
"questpie": patch
---

Cut type-check cost for apps with many collections. `CollectionBuilderState.fieldDefinitions` now holds fields typed by their read surface (state and runtime methods) instead of the whole `Field` class. Every `CollectionBuilder<infer S>` related each field's chain methods (`required()`, `label()`, …) to that constraint down to the TypeScript depth limit, once per collection. Each collection's own state still carries precise field types, so selects, inserts, `where` and client types are unchanged. On a 131-collection app this halves the type count and cuts instantiations by a third; the flagship examples drop 12-16% in instantiations. Code that passes `state.fieldDefinitions` to a parameter typed `Record<string, Field<FieldState>>` should type that parameter as `Record<string, StoredField>` (exported from `questpie`).
