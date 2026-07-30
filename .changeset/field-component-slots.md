---
"@questpie/admin": minor
---

Add per-field component slots: `.admin({ components: { field, cell } })`.

A component was chosen by field **type** only — the client registry maps `text`
to one form component and one cell, shared by every `f.text()`. Giving a single
field a different cell meant registering a whole new field type. These slots let
one field instance point at its own components while every other field of that
type keeps the default.

```ts
status: f.select(STATUSES).admin({ components: { cell: "status-pill" } }),
```

The value is a registry key, not a component: `.admin()` is serialized from the
server through field introspection and cannot carry a function. The key resolves
on the client against the admin component registry — `custom` first, then
registered field types — reusing the same reference-plus-registry mechanism that
already backs `c.icon("ph:users")` in views, actions and dashboards. The object
form `{ type, props }` is accepted too.

An unrecognised key falls back to the by-type component instead of rendering
nothing, so a typo degrades to the default rather than blanking the field.

Cell precedence, highest first: a `.list()` column `cell` → the `components.cell`
slot → the field type's registered cell → the built-in default.
