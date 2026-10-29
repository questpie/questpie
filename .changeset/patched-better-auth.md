---
"questpie": patch
"@questpie/admin": patch
"create-questpie": patch
---

Require Better Auth 1.7.12 or newer, which fixes GHSA-965c-763c-88jm (OAuth state usable as a magic link to sign in as another user) and GHSA-r4xp-prcw-77qf (OAuth Proxy sign-in as another user). The `questpie` dependency, the `@questpie/admin` peer minimum and generated-project templates move from `^1.7.4`, so a vulnerable Better Auth version can no longer satisfy them. Regenerate your lockfile when upgrading.
