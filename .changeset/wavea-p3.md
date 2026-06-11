---
"questpie": patch
---

Field & input type integrity (type-supremacy Wave A, lane C):

- `.default()` value is now constrained to the field's data type (Drizzle-identical): `f.boolean().default("yes")` and select defaults outside the option-value union are compile errors. Literal values, factories, and raw `SQL` expressions are accepted.
- Field `.hooks()` values are typed to the field's data type — `beforeChange`/`afterRead`/`validate`/`beforeCreate`/`beforeUpdate` receive `TState["data"]` instead of `unknown`.
- Sealed per-field operator maps: where-clause operator maps no longer carry a permissive `[x: string]: any` index signature. Unknown operators (`fuzzyMatch`) and wrong-type operators (`gt` on text, `contains` on dates) are compile errors. To-many quantifiers (`some`/`none`/`every`/`count`) remain available on relation fields, typed against the target collection's where. `.array()` fields now carry the real multi-value operator set.
- `create({})` on relation-less collections is a compile error again: an introspected-empty relations map stays inert instead of widening to `Record<string, RelationConfig>`, which silently optionalized every required insert key.
- `columns` omission mode (`columns: { x: false }`) now types the result as the row WITHOUT the excluded keys (it was inverted to a pick). `id` stays pinned in both modes, matching runtime semantics.
- No-arg `find()`/`findOne()` and `ReturnType<>` of the generic query methods no longer silently drop relation keys from the row type (`with` keys are only omitted when a `with` clause is actually present).
