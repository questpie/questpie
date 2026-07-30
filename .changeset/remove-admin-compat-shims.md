---
"@questpie/admin": patch
---

Removes six backward-compatibility re-export shims. No public API change.

`server/augmentation.ts`, `server/auth-helpers.ts` and the four
`server/block/*` files were all pure `export *` barrels carrying an
`@deprecated` header pointing at the real module. Every importer — including
the two public re-exports in `exports/factories.ts` — now points at the real
module directly, so the exported surface is byte-for-byte what it was and the
barrels are gone.

Internal imports of deprecated API in `@questpie/admin` drop from 125 to 20.
