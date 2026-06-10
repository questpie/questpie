---
"questpie": minor
"create-questpie": patch
---

Typed field extension hatches. `.zod(fn)` now propagates the returned schema's output type into the field's value type (and therefore CRUD select/insert types) — returning a plain `ZodType` keeps the previous type, so existing refinements are unaffected. New `.$type<T>()` explicitly sets a field's TypeScript value type with zero runtime effect (mirrors Drizzle's `$type`), mainly for `f.json()` fields that otherwise type as loose `JsonValue`. Docs and shipped skills now document field extension (`.zod()` / `.drizzle()` / `.$type()`) and promote collection composition via `.merge()` to a first-class documented pattern (reference section, extension recipes, common-mistake entry) so module collections get extended instead of accidentally replaced.
