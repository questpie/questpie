---
"questpie": patch
"@questpie/admin": patch
"create-questpie": patch
---

Docs/skills sweep: examples taught `f.relation("users")`, but the starter collection key is `user` (singular), so copying any of them caused a boot failure (`Relation target "users" not found`). All teaching material — shipped skills, docs, READMEs, AGENTS templates, and JSDoc examples — now uses `f.relation("user")`. Also documents that `.fields()` composes cumulatively with `.merge()`, and adds a Better Auth anonymous-plugin recipe (`plugins: [anonymous()]` in `auth.ts` + extending the starter user with `isAnonymous`).
