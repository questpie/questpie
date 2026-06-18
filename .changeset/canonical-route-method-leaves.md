---
"questpie": minor
"@questpie/openapi": patch
---

Make custom route calls use one canonical typed client shape: `client.routes.name.method(input)`.
Route definitions now accept one HTTP method per builder; use method-suffixed route files for multiple methods on the same path.
Route params inferred from method-suffixed keys now ignore the trailing `:METHOD`, so keys like `posts/[id]:GET` and `auth/[...path]:POST` keep their params.

OpenAPI route generation now keeps operation and schema ids distinct for method-suffixed sibling routes that share one path.
Docs and agent-facing examples now show only method-suffixed route files and method-leaf client calls.

Normal `seed({...})` handlers now run inside a single database transaction, so failed writes and the seed tracking row roll back together. For resumable or side-effectful seed work, `seed.steps({...})` exposes `step(name, fn)`, stores completed step checkpoints in `questpie_seed_steps`, returns cached JSON results on replay, and clears checkpoints during force/reset/undo flows.

The seed docs and Questpie skill references were updated to describe the new default transaction behavior, the `seed.steps()` API, checkpoint cleanup, and the no seed-wide rollback caveat for step seeds.
