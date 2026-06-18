---
"questpie": minor
---

Add transactional seed runs by default and a checkpointed `seed.steps()` API for resumable seed work.

Normal `seed({...})` handlers now run inside a single database transaction, so failed writes and the seed tracking row roll back together. For resumable or side-effectful seed work, `seed.steps({...})` exposes `step(name, fn)`, stores completed step checkpoints in `questpie_seed_steps`, returns cached JSON results on replay, and clears checkpoints during force/reset/undo flows.

The seed docs and Questpie skill references were updated to describe the new default transaction behavior, the `seed.steps()` API, checkpoint cleanup, and the no seed-wide rollback caveat for step seeds.
