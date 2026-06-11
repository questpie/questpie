---
"questpie": minor
"@questpie/tanstack-query": minor
"@questpie/admin": patch
"@questpie/workflows": patch
---

Routes/client/TanStack Query type de-poisoning (Wave A, lane A):

- `client.routes` is now typed from the generated route map: flat keys expand
  into nested literal-keyed callers (`client.routes.admin.stats(...)`), unknown
  route names are compile errors, and the `& Record<string, any>` index-signature
  poisoning is gone. Untyped apps (`QuestpieClient<any>`) keep a permissive
  surface.
- `route().outputSchema(schema)` now types the route end-to-end: the handler
  return is checked against the schema at compile time, and the schema type
  becomes the client's return type (it survives codegen handler erasure via the
  definition's `outputSchema` member). Handler-return inference is deliberately
  not captured — it would make `typeof routeDef` depend on the handler body,
  which cycles through the app module type graph (TS2456).
- Route handler args no longer declare `app: any` — `ctx.app` now comes from
  the generated `AppContext` augmentation, fully typed. (`JsonRouteHandlerArgs`
  input default is `unknown` instead of `any`.)
- `ServiceCreateContext` lost its `[key: string]: any` index signature — typos
  on the service-create context are now compile errors. Pre-codegen it falls
  back to `AppContext & { app }`; generated apps get the full typed surface via
  a names-only marker interface (`ServiceCreateContextGenerated`) that keeps the
  fallback conditional acyclic. New public export: `ServiceCreateContext`.
- `@questpie/tanstack-query`: `find` / `findOne` / `get` builders are generic
  per call — query options results now match the direct client's narrowing
  (relations loaded via `with`, narrowed columns) instead of collapsing to
  `PaginatedResult<{}>`.
- New public type exports from `questpie/client` for deriving per-call
  generics: `ApplyQuery`, `FindManyOptions`, `FindOneOptionsBase`, `FindResult`,
  `PaginatedResult`, `GroupedPaginatedResult`, `Where`, `With`, `OrderBy`,
  `GetCollection`, `GetGlobal`, `CollectionSelect`, `CollectionRelations`,
  `GlobalSelect`, `GlobalRelations`, `ResolveRelationsDeep`, `AnyCollection`,
  `AnyGlobal`, `AnyCollectionOrBuilder`.

Run `questpie generate` after upgrading to refresh the generated index (adds
the `ServiceCreateContextGenerated` marker).
