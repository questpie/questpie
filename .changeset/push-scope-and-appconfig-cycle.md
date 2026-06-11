---
"questpie": patch
---

Two fixes from jubli's 3.6.1 dogfooding:

**`questpie push` no longer touches framework or foreign database state.** The diff scope is restricted to the app's own schemas and excludes the migration ledger (`questpie_migrations`); adapter-owned schemas (pg-boss) never enter the diff. A belt-and-suspenders guard additionally scans every PLANNED statement before `apply()` and aborts loudly if anything still targets framework/foreign objects — the previous behavior planned and executed `DROP TABLE questpie_migrations` and pg-boss drops when those objects entered the diff as "extras".

**Function-valued rules in `appConfig({ access })` no longer collapse the AppContext augmentation.** Contextually-typed rule functions embedded the merged `AppContext` in `typeof config/app.ts`, which the generated index consumes — TS2456 across the whole app. App-level default access rules are now typed over the pre-codegen base context (`AppDefaultAccess` — `session`/`db` available, generated extensions deliberately not), and `appConfig()`'s return type erases `access`/`hooks` to opaque storage (the `CollectionAccessStorage` precedent) while preserving `locale` and the `context` resolver, whose annotated return keeps driving extension inference. Regression fixture: a function-valued default rule + global hook in toy-factory's app config now typechecks.
