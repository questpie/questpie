---
"questpie": minor
---

Add optional connection-pool tuning to the `db: { url }` config via a new `pool` field (`DbPoolConfig`): `max`, `connectionTimeoutMs`, `idleTimeoutMs`, `maxLifetimeMs`, and `prepare` (Bun only, for PgBouncer transaction mode). Values are given in milliseconds and mapped to each driver's native unit — Bun `bun:sql` (seconds) and `node-postgres` (ms for acquire/idle, seconds for lifetime).

Previously `db: { url }` created the pool with zero tuning (`new SQL({ url })` / `new pg.Pool({ connectionString })`), so it inherited driver defaults — notably node-postgres' `connectionTimeoutMillis: 0`, i.e. an unbounded wait to acquire a connection. On a shared Postgres running near its `max_connections` cap, that unbounded wait let a single request stall long enough to trip the SSR stream lifetime cap. Set a bounded `connectionTimeoutMs` so pool acquisition fails fast instead of hanging. Fully backward compatible: omit `pool` to keep the previous behavior.
