---
"questpie": minor
"@questpie/admin": minor
"@questpie/openapi": minor
"@questpie/tanstack-query": minor
---

Add a separately authorized physical-purge lifecycle for soft-delete collections.

- Expose capability-aware `purgeById` server, HTTP, browser client, OpenAPI, and TanStack Query surfaces without adding a force-delete alias.
- Require an explicit `purge` access rule, reject active rows, hide denied or missing targets behind the same not-found result, and run dedicated fatal purge hooks transactionally.
- Strictly prevalidate purge `AccessWhere` trees so unknown or unsupported leaves, including leaves nested below `NOT`, fail closed.
- Block retained collection/global relations and concurrent foreign-key DDL instead of converting soft-delete cascades into destructive cascades. Declared relation writes to a missing registered target now fail with bad request so a writer delayed behind purge cannot commit a dangling reference.
- Serialize purge per collection behind a PostgreSQL schema fence, bound relation-lock waits to three seconds, and return a retryable conflict on contention.
- Add two mandatory core tables, `questpie_storage_cleanup` and `questpie_storage_object_key`. Every application with upload collections must generate and deploy the migration before its next upload metadata create/key change, even when purge and the durable cleanup worker are not enabled yet.
- Preserve upload bytes through soft delete/restore. Replaced upload keys and committed purge now depend on the existing API/queue worker running the durable `storageCleanup` job; provider failures and crashes retain leased retry work. Hard-delete uploads remain post-commit but now use the same reference-aware key fence, and missing provider objects converge without leaking coordination rows.
- Reject upload metadata creation or key replacement when the provider object does not exist, with a bounded provider existence check.
- Integrate committed purge with audit, realtime, Search, and CRDT retention. Expired CRDT epochs, bindings, and the final retired identity tombstone are removed after the recovery window.
- Preserve the original active-row `deletedAt` index and add a partial `(deletedAt, id)` index for bounded retention keysets.
- Correct polymorphic relation persistence so public `{ type, id }` values map to both physical discriminator/id columns on create and update, reads and versions restore the public shape, and purge inspects every discriminator. Applications using polymorphic relations must review and deploy the generated schema migration, backfill legacy discriminator/id pairs, and verify that no retained reference has a null discriminator before enabling purge.
- Keep framework-derived upload `key`, sanitized `filename`, MIME type, size, and configured visibility authoritative over `additionalData`; validate upload keys against the provider and relation targets against registered rows before writing. These checks add one bounded provider lookup or target-row lock to affected writes.
- Make PostgreSQL queue `runOnce()` explicitly complete/fail fetched jobs and settle every fetched sibling before surfacing the first handler error.
- Add a bounded high-water/keyset retention recipe, a relation-bearing real PostgreSQL benchmark harness, and a mandatory CI concurrency/key-reuse contract.
