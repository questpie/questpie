---
"questpie": minor
---

Fix request-scoped services to share one instance across each HTTP request,
queue job attempt, seed, or top-level operation and dispose them when that scope
ends.

**Breaking:** Remove the seed-specific `createContext()` helper. Pass partial context options
directly to CRUD calls instead; they inherit the active seed or step transaction:

```ts
await globals.siteSettings.update(data, { locale: "sk" });
```

Generated standalone `createContext()` remains a rich async-disposable
`AppContext`. `app.createContext()` remains the explicit lean `RequestContext`
factory.
