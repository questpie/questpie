---
"questpie": patch
"@questpie/admin": patch
"@questpie/workflows": patch
"@questpie/ai": patch
---

Codegen emission fixes (type-supremacy Wave A, lane B):

- Module codegen emits category maps as `type` aliases instead of `interface`. Interfaces have no implicit index signature, so `AppCollections` failed the `Record<string, AnyCollectionOrBuilder>` constraint, `GetCollection` silently degraded to `never`, and **every `with`-populated relation typed as `{}` in every app**. With type aliases, populated relations resolve to the target collection's row type.
- Empty module category stubs emit `Record<never, never>` instead of `Record<string, never>` — the string index signature poisoned `keyof` to `string` through the `_MP` UnionToIntersection chain, collapsing service/collection aggregates.
- Module route maps guard leaf entries on the `__brand: "route"` marker so helper files in routes/ directories keep their own types instead of being erased to `RouteDefinition` (broke the module-object cast).
- Generated `AppConfig` no longer intersects `& Record<string, AnyCollectionOrBuilder>` / `& Record<string, AnyGlobalOrBuilder>` — phantom collection/global keys on `createClient<AppConfig>()` are now compile errors instead of silently `any`.
- Generated `JobHandlerContext` / `WorkflowContext` expose typed `db`, `email`, `kv`, `logger`, `search`, `realtime`, `globals`, `tables`, and `session` members (previously `unknown` / `Record<string, unknown>`).
- With the workflows plugin installed, `ctx.workflows` is `WorkflowClient<AppWorkflows>` in routes, jobs, and workflows — `trigger()` names and payloads are checked instead of accepting anything.
- Regenerated all package `.generated/module.ts` files and example apps with the current templates.
