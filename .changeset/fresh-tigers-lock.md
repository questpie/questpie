---
"questpie": minor
"@questpie/admin": minor
"@questpie/openapi": minor
"@questpie/tanstack-query": minor
---

Add framework-owned canonical revisions and generated optimistic concurrency to
collection and Global CRUD, clients, REST/OpenAPI, TanStack Query, and Admin
mutation flows.

Canonical `revision` is now distinct from version-history sequencing and CRDT
clocks. History snapshots record `sourceRevision`, stale and incomplete bulk
preconditions fail atomically before durable effects, owner-derived history
access closes cross-tenant reads, and collaborative aggregate projections
advance the owner revision once while preserving their existing commit,
cursor, recovery, and realtime protocols.

Optimistic delete hooks execute inside the revision-checked transaction and
revalidate the locked row before committing. Collections without optimistic
concurrency retain their established pre-claim delete-hook ordering, including
TOCTOU-aware hooks, without self-deadlocking on the framework row lock.
