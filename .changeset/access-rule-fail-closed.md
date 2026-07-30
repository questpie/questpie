---
"questpie": patch
---

Collection access rules now fail closed on a rule shape the type system does
not admit.

`AccessRule` is `boolean | ((ctx) => boolean | AccessWhere)`. Both collection
evaluators ended with an unconditional allow for anything else —
`executeAccessRule` in `crud/shared/access-control.ts` returned `true`, and
introspection's `evaluateAccessRule` returned `{ allowed: true }` — so the one
branch nobody can type-check was the one branch that granted access, on the
enforcement path. Such a rule can only arrive from untyped JS, a cast, or
config deserialized at runtime, which is exactly when a default matters.

Both now deny, matching the globals evaluator, which was made fail-closed
earlier. No typed application can reach this branch, so no behaviour changes
for correctly-typed apps.
