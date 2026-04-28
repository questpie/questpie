---
"questpie": patch
---

Fix three independent bugs in the CRUD + queue layer.

**Race in `globals.<name>.get` auto-create.** Two concurrent `get(...)` calls against a fresh global both saw zero rows under READ COMMITTED and each inserted a "default-valued" auto-created row, leaving the database with two singletons. Auto-create now takes a transaction-scoped `pg_advisory_xact_lock(hashtext('questpie:global:<name>'))` and re-checks existence inside the locked transaction before inserting. Applied to both the workflow-versions branch and the plain branch. Schema-free — no migration. Backends without `pg_advisory_xact_lock` log a warning and fall back to the existence re-check.

**Pre-stringified jsonb values stored as jsonb strings.** When upstream code (legacy seeds, RPC layers, custom hooks) handed an already-`JSON.stringify`'d array or object to `globals.<name>.update(...)` or `collections.<name>.create/update(...)`, Drizzle's jsonb `mapToDriverValue` stringified it a second time and Postgres stored a jsonb string instead of the intended array/object. The framework now normalizes input for jsonb-backed fields (`f.json()`, `f.object()`, `f.<x>().array()`, `f.blocks()`) before validation, hooks, and write — pre-stringified arrays/objects are decoded back to their plain JS values. Field input hooks always observe decoded values.

**`pgBossAdapter` ignored pg-boss v10+ array callback shape.** pg-boss v10+ calls `work()` callbacks with `Job<T>[]` regardless of `batchSize`. The adapter destructured `job.id` / `job.data` straight off the array → both `undefined` → registered handlers received `payload: undefined` and every job failed Zod validation upstream. `listen()` now iterates the array, dispatches each job to the handler, and reports per-item failures via `boss.fail(jobName, id, …)` so siblings in the same batch still complete and the failed job retries independently. `runOnce()` already handled the array shape correctly via `fetch()` and is unchanged.

All three fixes are backwards-compatible. No public API changes, no schema migrations.
