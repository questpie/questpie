---
"questpie": patch
"@questpie/admin": patch
"@questpie/hono": patch
"@questpie/elysia": patch
"@questpie/next": patch
"@questpie/tanstack-query": patch
---

Fix npm publish by converting workspace:* to actual versions

- Remove internal @questpie/typescript-config package (inline tsconfig)
- Add publish script that converts workspace:* references before changeset publish
- Fixes installation errors when installing packages from npm
