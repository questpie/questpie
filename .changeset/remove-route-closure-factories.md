---
"questpie": major
---

**BREAKING: the legacy route closure factories are removed.**
`createCollectionRoutes`, `createGlobalRoutes` and `createSearchRoutes` were
marked `@deprecated Use standalone handler functions instead`, and every one of
them did nothing but forward to a standalone handler that lives in the same
file.

Replace `createCollectionRoutes(app).find(request, params)` with
`collectionFind(app, request, params)`. The same shape holds for every method:
`count`, `create`, `findOne`, `update`, `remove`, `versions`, `revert`,
`transition`, `restore`, `purge`, `updateMany`, `updateBatch`, `deleteMany`,
`audit`, `meta`, `schema`, and the `global*` and `search*` equivalents. If you
were passing a config to the factory, it is the fifth argument of the handler,
after an optional context.

The framework's own 27 core route modules were the only remaining callers and
now use the handlers directly. `GlobalRoutes`, the factories' return type, is
removed with them.
