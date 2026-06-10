---
"questpie": minor
---

Atomic conditional writes (claim-checked) + one CRUD vocabulary with fail-loud unknown methods.

**Claim-checked writes.** Bulk `updateMany`/`deleteMany` previously evaluated `where` in a pre-SELECT and then mutated by id — two parallel conditional writes (claims, optimistic-version checks, state transitions) could both "win" and silently overwrite each other. Now, inside the write transaction, the candidate rows are locked (`SELECT … FOR UPDATE`, deterministic order) and the caller's `where` is re-evaluated through the find pipeline on the transaction connection. Every mutation step (UPDATE, i18n upsert, nested relations, versioning, `afterChange`, realtime) is scoped to the rows that still match at write time. `updateMany` returns exactly the written rows (`[]` = lost the race), `deleteMany`'s `count` reports rows that still matched, and `updateById`/`deleteById` throw `notFound` instead of silently no-oping when the row vanishes concurrently. Behavior-correcting change: a conditional bulk write that previously "won" falsely now reports fewer rows — code relying on the old behavior was already corrupting data.

**One CRUD vocabulary.** Server CRUD adds `updateMany`/`deleteMany` keys (aliases of the bulk implementations); server `update`/`delete` are deprecated (removed in v4). The client SDK adds `updateById`/`deleteById`/`restoreById` aliases for the by-id methods. Same name = same concept on both surfaces.

**Fail-loud unknown methods.** Accessing a non-existent method on server CRUD (e.g. `updateMnay`, or `updateMany` on questpie < 3.6 style glue) now throws a `TypeError` naming the closest real method and listing the full vocabulary, instead of returning `undefined` that turns into a silent no-op inside a bare `catch`. Probe patterns keep working: `await crud`, `JSON.stringify`, test matchers, spreads, `"x" in crud` feature detection, and the `crud.upload` capability check on non-upload collections.

Also fixes `count()` (and `find()`'s `totalDocs`) failing with "column does not exist" when `where` references a localized field — the count query now joins the i18n tables like the docs query does.
