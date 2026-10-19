---
"questpie": patch
---

Cut type-check cost for apps with many collections. `CollectionBuilderState.fieldDefinitions` is now `Record<string, any>`, as on `GlobalBuilderState`, instead of `Record<string, Field<FieldState>>`. Every `CollectionBuilder<infer S>` checked each field's method chain against that constraint to the TypeScript depth limit, uncached. Each collection's own state still carries precise field types. On a 131-collection app this halves the type count and cuts instantiations by a third; the flagship examples drop 12-16% in instantiations.
