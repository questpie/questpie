# BETA-10 optional-infrastructure absence report

## Result

BETA-10 correctness used Bun, generated QUESTPIE code, and PostgreSQL 17 only.
Both executable scenarios report `optionalAccelerators: 0` and pass with no
cache, broker, Redis, Pusher, WebSocket server, process registry, or leader.

The published Runtime workspace declares only the `questpie` workspace package
as a dependency (`packages/runtime/package.json:16`–`:18`). The compiler depends
only on workspace packages, Bun types, and TypeScript
(`packages/compiler/package.json:13`–`:18`). A source search found no import of
`redis`, `ioredis`, `pusher`, or `ws` in packages, apps, or the BETA-10
scenarios.

The root `package.json:73` contains a `ws` **override**, not a Runtime dependency
or carrier implementation. Treating that lock-resolution pin as production
WebSocket support would be a false positive; no source imports it.

PostgreSQL remains semantic authority:

- reconciliation reads and advances one PostgreSQL horizon in a Repeatable
  Read transaction (`packages/runtime/src/live-query/postgres.ts:169`–`:256`);
- durable admission reads eligible rows and executable digests from PostgreSQL
  (`packages/runtime/src/durable/postgres-kernel.ts:473`–`:504`); and
- absence or loss of a wake hint is repaired by the startup scan, whose `start()`
  immediately calls `requestScan()` (`packages/runtime/src/live-query/postgres-wake.ts:109`–`:123`).

This report proves absence, not an unavailable-backend fallback. Optional cache,
broker, and alternate carrier implementations remain absent beta.1 capabilities;
there is no configuration switch to exercise or silently degrade.
