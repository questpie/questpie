---
"questpie": patch
---

Internal: adds a `deprecated-imports` CI ratchet and extracts the shared module
resolver the gates use. No runtime or API change.

Counts imports of `@deprecated` symbols from the framework's own non-test
source, per package, and fails on any increase. A rising number means the tag
has stopped being a migration signal: the deprecated code can never be removed,
and a user who follows the tag's advice lands on a path the framework does not
itself use.

166 today — `@questpie/admin` 125, `questpie` 41 — dominated by admin importing
its own `@deprecated` compat barrel 91 times, and by every file in
`modules/core/routes/` importing `createCollectionRoutes`, which is marked
"@deprecated Use standalone handler functions instead".
