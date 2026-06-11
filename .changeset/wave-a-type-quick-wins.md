---
"questpie": minor
"@questpie/tanstack-query": minor
"@questpie/admin": patch
---

Wave A type quick wins — the probe-validated half of the type-supremacy audit.

**Client & routes**

- The routes client is typed end-to-end: `ExpandRoutes` is wired into `client.routes` (nested literal keys, phantom route names error) and the `& Record<string, any>` poison is gone. `AppConfig` no longer carries collection/global index-signature intersections — typo'd keys error on the client.
- Route outputs are typed from `.outputSchema()`: it compile-checks the handler return and `InferRouteOutput<typeof def>` resolves through the definition (full handler-return inference deferred — a generic `.handler<TResult>()` provably re-enters the generated module graph; Wave B layered emission unblocks it).
- `app: any` is gone from route handler args — `ctx.app` is fully typed via the AppContext augmentation (core module routes use an internal accessor).
- @questpie/tanstack-query `find`/`findOne`/`get` are generic per call — results stop collapsing to `PaginatedResult<{}>`; global `columns` options are `Record<string, boolean>` instead of `any`.

**Generated types**

- Module codegen emits `type` aliases for category maps — module `interface` maps lacked implicit index signatures, failing the `Record` constraint and collapsing every `with`-populated relation to `{}` app-wide. Populated relations are real row types again (committed tripwire test guards the constraint).
- Job/workflow contexts get typed `db`/`session`/`globals`/`kv`/`logger` members and a typed `workflows: WorkflowClient<AppWorkflows>` — bogus workflow names and wrong payloads error.

**Field & input integrity**

- `.default()` is constrained to the field's value type (`f.boolean().default("yes")` is now a compile error), field hooks receive typed values, and where-operator maps are sealed — unknown operators (`fuzzyMatch`, `eqq`) and wrong value types error instead of passing as `any`.
- `create({})` errors again on collections without relations (the empty-relations fallback no longer optionalizes every key), and `columns: { x: false }` omission mode types the result correctly (it was inverted).

**Type performance & CI**

- Variance annotations on the hot field/CRUD aliases: flagship app check time drops ~13-30% (city-portal 10.6s → 7.4s) with byte-identical error sets.
- New CI gates: `scripts/type-budget.ts` (instantiation budget per package/example, fails on >10% regression), `scripts/any-census.ts` (type-escape ratchet — counts can only go down), alongside the dist-types gate.
