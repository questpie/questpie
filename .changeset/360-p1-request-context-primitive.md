---
"questpie": minor
---

Request-context primitive: the `appConfig({ context })` resolver result now travels with the request instead of being dropped at every internal boundary. Previously the resolved context only reached route handlers — access rules, hooks, and `getContext()` silently saw `undefined` even though the generated types promised the keys (the type-lie is now truth).

- **One derivation point**: `app.createContext()` runs the resolver once per HTTP request (idempotent — re-entry never re-runs it); the adapter's inline resolver block is gone. Programmatic `app.createContext({ request })` resolves identically, no adapter needed.
- **One carrier**: the result is stored as an internal `"~contextExtensions"` bundle on the request context and the AsyncLocalStorage store, inherited by `normalizeContext` like `session`/`db` — nested CRUD, relation hydration, and hook-triggered operations all see it.
- **Every ctx assembly spreads it flat**: collection/global access rules, collection/global hooks, transition rules and transition hooks, route access rules, field access rules, search-route access checks, and `getContext()`.
- **Resolver inputs grew** from `{ request, session, db }` to the full system-mode service surface (`collections`, `globals`, `logger`, `kv`, `queue`, `t`, user services), typed via the codegen-emitted `Questpie.ContextResolverContext` global.
- **`getContext<App>()` is now typed with resolver extensions** via the new `"~contextExtensions"` phantom on the generated app config (`InferContextExtensionsFromApp`).
- Request-level memoization needs no framework machinery — return closures from the resolver; they live exactly one request.
- A throwing resolver fails the request before any rule or handler runs; reserved keys (`session`, `db`, `locale`, …) returned by a resolver log a dev-mode warning and never shadow framework keys.

Extensions stay `Partial<…>`: jobs, seeds, and request-less contexts skip the resolver — narrow before use.
