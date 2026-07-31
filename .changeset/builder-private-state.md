---
"questpie": patch
---

Fix `.fields()` losing module-contributed field types after any other builder
call.

`CollectionBuilder` and `GlobalBuilder` are immutable: every method builds a new
builder from new state. Each one also had to remember to hand-copy the private
state across. `_indexesFn` was copied at all thirteen collection sites;
`_fieldDefs` — the runtime map holding `richText`, `blocks` and the app's own
`fieldType()`s — was copied at none. It was assigned once in `create()` and
dropped by the first derivation.

Every extension method routes through `.set()`, so:

```ts
collection("posts").admin({ … }).fields(({ f }) => f.richText())
```

fell back to `builtinFields`, `f.richText` was undefined, and the call threw —
while the type still advertised `richText`, because `~fieldTypes` travels on the
state and survives. Writing `.fields()` first worked. Globals had the same
defect, in a purer form: `_fieldDefs` is their only private state and nothing
carried it.

Both builders now derive through a single private helper that carries every
piece of private state, so the knowledge lives in one place instead of nineteen.
`indexes()` and `merge()` derive and then override the one field they exist to
change.
