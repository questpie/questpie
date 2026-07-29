---
"questpie": minor
---

Field builder chains typecheck about **twice as fast**. Instantiation counts on
the three flagship examples fall 47-53%, and `packages/questpie` itself by 56%.

`Field` now carries its type-specific methods as a second type parameter,
`Field<TState, TMethods>`, and declares its own return types. Previously a
27-key mapped type sat in front of the class rewriting return types the class
could have declared itself — and to build that map's member table TypeScript had
to resolve all 27 keys, roughly 22 `Omit<TState, …>` computations, at **every
link of every builder chain**, even when a single method was called. What is
left is a small map over `TMethods` only, which is still needed because field
modules declare `pattern(): any` and `hasMany(): Field<R>` without knowing
`TMethods`.

Measured on `examples/tanstack-barbershop` (4,579 files), same machine:

|                | before    | after     |        |
| -------------- | --------- | --------- | ------ |
| instantiations | 6,668,339 | 3,499,885 | −47.5% |
| types          | 1,220,506 | 997,331   | −18.3% |
| check time     | 16.45 s   | 14.42 s   | −12.3% |
| memory         | 2,478 MB  | 2,552 MB  | +3.0%  |

Peak heap did not follow instantiations down, so this is a CPU win, not a
memory one.

**Four chain methods stopped dropping type-specific methods.** `.operators()`,
`.$type()`, `.set()` and `.derive()` were declared on the class but missing from
the mapped mirror, so they fell through to a bare `Field` and lost the field
type's own methods. `f.text().required().$type<string>().pattern(/x/)` now
compiles; it used to be an error.

**`FieldCommonMethods` is deprecated, not removed.** It is now an alias for
`Field<TState, TMethods>`, so existing imports keep compiling and this stays a
minor. It
existed as a hand-maintained mirror of the class's method signatures, and
nothing checked the two stayed in sync (they had already drifted on `.drizzle()`
and `.operators()`). It existed so consumers could declaration-merge extra common methods in, and
that no longer does anything — the supported way to add methods is a
`fieldType()` with `methods`. `FieldWithMethods` is unchanged.

**`.drizzle()` no longer re-derives the field's value type from the column it
returns.** It swaps the column and leaves `data` alone. Only
`.drizzle((c) => c.$type<T>())` is affected — use `.$type<T>()` for a
type-level change or `.zod()` for type plus validation. The previous behaviour
was not uniform (it applied to four field types and not the other eleven), and
where it did apply it widened `f.select()`'s literal union to `string`.
