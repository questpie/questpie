---
"questpie": patch
---

Fixes `crdt`, `observability` and `executor` runtime config leaking into
`app.state`, where a member exposing `build()` was silently replaced by its
return value.

`create-app` keeps a set of the `RuntimeConfig` keys it consumes; anything not
in it is treated as an unknown plugin extension and copied into
`instance.state`. All three of these keys were read by `create-app` but missing
from the set, so each ended up duplicated into the plugin bucket. That much was
only clutter. The damage came next: `buildExtensionState` duck-types one level
into every extension record and calls `.build()` on any member that has it —
intended for `BlockBuilder` → `BlockDefinition`, but it does not know what it is
walking. An observability or executor adapter that happens to expose a `build()`
method was replaced by whatever that method returned.

This is the mirror of the `observability` bug fixed one release ago. That one
dropped the key on the floor; this one copies it somewhere it can be mangled.

Now covered by `test/config/runtime-consumed-keys.test.ts`, which asserts both
that the keys stay out of `app.state` and that the adapter instance in
`app.config` is the object that was passed in.
