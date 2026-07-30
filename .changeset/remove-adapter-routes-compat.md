---
"questpie": major
---

**BREAKING: `createAdapterRoutes` is removed.** Routes are defined in
`modules/core/routes/` and served through the normal route pipeline; this
function was a shim that composed the old closure factories into an
`AdapterRoutes` object, marked `@deprecated Use route() definitions in core
module instead`. It had no production caller — only tests and one bench.

If you were calling it, call the handler you need directly:
`realtimeSubscribe(app, request, params, context, config)`,
`storageCollectionServe(app, request, params, context, config)`, and the
`collection*` / `global*` handlers from
`#questpie/server/adapters/routes/{realtime,storage,collections,globals}.js`.

Also removed, both of which the shim was the only thing keeping alive:
`server/adapters/routes/index.ts` (a re-export barrel nothing imported once the
shim was gone) and `server/adapters/routes/auth.ts`, whose `createAuthRoute` and
`authHandler` had no consumers at all — the live auth route is
`modules/core/routes/auth/` built with `route()`.
