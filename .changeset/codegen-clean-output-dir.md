---
"questpie": patch
---

Codegen now recreates each target's output directory on every non-dry run, so generated files from a convention that was removed (for example `env.client.*` modules after deleting `env.client.ts`) no longer linger after regeneration.
