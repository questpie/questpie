---
"questpie": patch
---

Fixes `f.upload().multiple()` returning a field with no state.

The method spread `f._` instead of `f._state`. `Field._` is declared
`declare readonly _: TState` — a type-only phantom with no runtime property — so
the spread contributed nothing and the returned field kept only the five keys
`multiple` sets inline. Everything else was gone:

```ts
upload()            // getType() === "upload", metadata.targetCollection === "assets"
upload().multiple() // getType() === undefined, metadata === {}
```

That means no field type, no upload metadata, no target collection, and none of
the modifiers applied before it — `upload().required().multiple()` lost its
`required`. Anything reading the field through introspection saw an untyped
field, which is what the admin renders from.

The type checker could not see it: `multiple()` is declared `(): any`, so `f._`
typechecks as `TState` and spreading it is legal. The existing type test asserted
that state is preserved and stayed green throughout.

`multiple`'s own overrides are unaffected — it still sets `multiple`, `virtual`
and a null column factory on top of the restored state, so the column decision
and generated schema are unchanged. Regenerating produces no diff.

Now covered by `test/fields/chain-preserves-state.test.ts`, which pins the
behaviour and adds a source-level check that no builtin field module spreads the
phantom `_` — the two spellings differ by one character and only one exists at
runtime.
