---
"questpie": minor
---

Generated type emissions — the deferred infer-first half lands. Codegen now auto-populates the names-only key registries (`Questpie.CollectionKeys`/`GlobalKeys`/`JobKeys`) from discovered files, so `f.relation("…")` autocompletes collection keys out of the box (plain strings keep compiling). The generated index exports `AccessRuleContext<K>`/`HookRuleContext<K>` (shared-helper ctx with `data` narrowed to a collection row), `GlobalDoc<K>`, `AppSession`, and `AppSessionUser`. `ctx.app` is now fully typed on every handler context (access rules, hooks, helpers) via the AppContext augmentation — collection-imported helpers keep the explicit-return-annotation cycle cut. Typed `app` on route handler args stays recipe-based (`getContext<App>()`) — the eager conditional it would need re-enters the generated module graph.
