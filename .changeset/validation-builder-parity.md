---
"questpie": patch
---

Fix `.validation()` silently narrowing what a collection accepts.

`state.validation` was built by two different code paths. When `.validation()`
was never called, the `Collection` constructor built it from the real Drizzle
columns and added the system columns on top — `defaultIdColumn()` when the user
declared no id, `timestampsCols()` unless timestamps were off, and
`softDeleteCols()` under soft delete — precisely so a custom id can be supplied
on create and so restore can write `deletedAt`.

Calling `.validation()` swapped in a second implementation that walked
`fieldDefinitions` and added none of those three. Because both paths end in a
Zod object, which strips unknown keys instead of rejecting them, the difference
produced no error: `.validation()` — even with no arguments — quietly removed
the ability to pass an id on create, and made restore's `deletedAt: null` write
a no-op. The two paths also classified localized fields differently
(`state.localized` versus `fieldDef.getLocation()`), which decides whether a
field is validated by the main schema or the i18n one.

`.validation(options)` now records its options on state and the constructor
stays the only place that builds schemas, so the two can no longer drift.
Behaviour is unchanged for collections that never called `.validation()`, and
collections that did call it regain the id, timestamp and soft-delete columns
they should always have had.

Also removes a byte-for-byte copy of `mergeFieldsForValidation` from the
globals validation helpers; globals now call the collection one.
