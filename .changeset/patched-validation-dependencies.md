---
"questpie": patch
"@questpie/admin": minor
"@questpie/mcp": patch
"@questpie/openapi": patch
"@questpie/workflows": patch
"create-questpie": minor
---

Require Zod 4.6.6 or newer for its bounded-collection validation security fix. Update dependency and peer minimums, examples, and generated-project templates so an existing vulnerable Zod 4 version cannot satisfy the declared contract.

Upgrade shadcn to 4.22.1 and env-core to 0.13.11 so their supported dependency ranges accept Zod 4, removing the private Zod 3 copy. Existing shadcn CSS imports stay the same. The admin package and generated projects now declare Node 20.18.1 or newer to match shadcn's supported runtime; this does not change the core framework's Node requirement. Regenerate project lockfiles when upgrading these dependencies.

Repository and generated-project roots pin Azure Identity to 4.13.0, whose supported MSAL 3 LTS dependency avoids GHSA-xcx6-jx8p-x3h5. The pin satisfies the existing Tedious, files-sdk and unstorage ranges. They also pin body-parser 2.4.0 and Undici 7.30.1 for their denial-of-service fixes. Package-manager overrides are application-root configuration and do not propagate from published libraries: existing applications should add these three pins to their own Bun/npm `overrides`, pnpm `pnpm.overrides`, or Yarn `resolutions`, then regenerate the lockfile. No audit allowlist or release-age exemption is added.
