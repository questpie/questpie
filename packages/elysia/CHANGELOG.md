# @questpie/elysia

## 3.28.1

### Patch Changes

- Updated dependencies [[`5f7dbb9`](https://github.com/questpie/questpie/commit/5f7dbb90e69bb104d8bfbddde464ad706d0f415a)]:
  - questpie@3.28.1

## 3.28.0

### Patch Changes

- Updated dependencies [[`c92a0c2`](https://github.com/questpie/questpie/commit/c92a0c28cf2a74d909eae35565b3f5d084cbe23d), [`fe8f86f`](https://github.com/questpie/questpie/commit/fe8f86f7839c23a5ae32592e5c6ef21a6bb8b03f), [`fa440e5`](https://github.com/questpie/questpie/commit/fa440e5f499a4090c73601aff87f8a6071455e34)]:
  - questpie@3.28.0

## 3.27.1

### Patch Changes

- Updated dependencies [[`d425ca9`](https://github.com/questpie/questpie/commit/d425ca9355f11d5b514c2ae7a4dee03f543ca6e6)]:
  - questpie@3.27.1

## 3.27.0

### Patch Changes

- Updated dependencies [[`74b9a6d`](https://github.com/questpie/questpie/commit/74b9a6d35f47d627177966beb81c395f45216790), [`3214843`](https://github.com/questpie/questpie/commit/3214843c46238a66097a5d3bc35e65dc1a7732e2), [`5fff464`](https://github.com/questpie/questpie/commit/5fff46425ee306fd89dddb663b0e60ba33c528a9), [`8a9eef7`](https://github.com/questpie/questpie/commit/8a9eef739bbecc8ba8e9a3444eb8905ef4307585), [`5fff464`](https://github.com/questpie/questpie/commit/5fff46425ee306fd89dddb663b0e60ba33c528a9), [`bd75a6b`](https://github.com/questpie/questpie/commit/bd75a6b01f661fe5277d0905ed35acd7db271953)]:
  - questpie@3.27.0

## 3.26.2

### Patch Changes

- [#249](https://github.com/questpie/questpie/pull/249) [`9f8b921`](https://github.com/questpie/questpie/commit/9f8b921685178d9b4af51bfd7febba02c9a0fee2) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Keep Fetch handler configuration local to each binding and surface ambiguous
  route patterns during handler construction instead of silently falling back to
  404 responses. Forward safe request-context options through the Hono and Elysia
  adapters, keep public HTTP authority in user mode, and preserve native route
  fallthrough outside the configured base path. Hono mounts no longer derive
  QUESTPIE authority from a mutable `c.user`; use `getSession` for custom mount
  identity. Existing `questpieMiddleware` composition reuses one immutable
  authority snapshot instead of resolving a second identity. Its native context
  stays fully backwards-compatible while the mount derives a private app context
  that native middleware cannot forge. Fresh channel and live-query authorization
  also stays bound to the private request snapshot. Hono and Elysia share the core-owned
  `NativeAdapterConfig` option contract. Next route handlers now return an exact
  seven-method type while preserving their 3.x configuration surface. Code that
  indexed the handler object with an arbitrary string must use one of the seven
  exported method names. The Elysia adapter no longer carries the unused
  `@elysiajs/cors` dependency or claims a built-in CORS option; applications that
  need cross-origin access must install and compose Elysia's native CORS plugin.

- [#252](https://github.com/questpie/questpie/pull/252) [`1a81417`](https://github.com/questpie/questpie/commit/1a8141742292e9e17149ec4e6bc88c1c42bdfc3e) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Accept generated QUESTPIE app values across physical package boundaries in the
  Next and Elysia adapter entrypoints. Their runtime input now follows the
  existing low-level Fetch seam instead of requiring the nominal `Questpie` class
  identity from the adapter package's own installation.
- Updated dependencies [[`be5dcd5`](https://github.com/questpie/questpie/commit/be5dcd5b6c0cd6034a15a8ab73d6d767d358a3f7), [`1a81417`](https://github.com/questpie/questpie/commit/1a8141742292e9e17149ec4e6bc88c1c42bdfc3e), [`9f8b921`](https://github.com/questpie/questpie/commit/9f8b921685178d9b4af51bfd7febba02c9a0fee2), [`8d4fbad`](https://github.com/questpie/questpie/commit/8d4fbad5da94ddbd32237ac10c7cf601750afe6a)]:
  - questpie@3.26.2

## 3.26.1

### Patch Changes

- Updated dependencies [[`e1620ea`](https://github.com/questpie/questpie/commit/e1620ea526bf4ab9e3e0d90b0b4df9fc1b8c30e2)]:
  - questpie@3.26.1

## 3.26.0

### Patch Changes

- Updated dependencies [[`c6fbf42`](https://github.com/questpie/questpie/commit/c6fbf42e0b8a199753a92dbe91eb9b5d034d61f6)]:
  - questpie@3.26.0

## 3.25.3

### Patch Changes

- Updated dependencies [[`f72cdfa`](https://github.com/questpie/questpie/commit/f72cdfa26b94ff1f4bcfffeec398e7a79a66b548)]:
  - questpie@3.25.3

## 3.25.2

### Patch Changes

- Updated dependencies [[`974e6b2`](https://github.com/questpie/questpie/commit/974e6b24eeee2d26466c142d06f79cc7ba1f65e7)]:
  - questpie@3.25.2

## 3.25.1

### Patch Changes

- Updated dependencies [[`6542080`](https://github.com/questpie/questpie/commit/65420804940ede8b419bfeed8964d5f1ce32b82b)]:
  - questpie@3.25.1

## 3.25.0

### Patch Changes

- Updated dependencies [[`da70c88`](https://github.com/questpie/questpie/commit/da70c88286f0b5228d500b989554908d8724a463)]:
  - questpie@3.25.0

## 3.24.0

### Patch Changes

- Updated dependencies [[`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270), [`e23ad85`](https://github.com/questpie/questpie/commit/e23ad853d9c62b3e575d8cb9420ed63fe8924270)]:
  - questpie@3.24.0

## 3.23.0

### Patch Changes

- Updated dependencies [[`bec0c23`](https://github.com/questpie/questpie/commit/bec0c23a78f1318a86c09e8d02f1584c89605c50), [`76bf85c`](https://github.com/questpie/questpie/commit/76bf85c681bf3187338574d8a9b4e21e47ac9051)]:
  - questpie@3.23.0

## 3.22.0

### Minor Changes

- [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Close a set of holes where the framework promised something and quietly did not
  do it.

  **Codegen no longer fails silently.** A `modules.ts` that could not be imported
  was caught, reported only under `--verbose`, and then codegen removed the output
  directory and wrote a core-only artifact over the correct one, with exit code 0.
  One unbuilt dependency erased every category, collection extension and factory
  method with no message. It now throws. The same bug pair in `module-metadata.ts`
  is fixed too, along with a Windows drive-letter path that parsed as a URL scheme
  and `modules.mts`, which discovery already accepted.

  **A module's `emails/` directory reaches the app.** The module template emitted
  the key `emails` while `create-app` read `emailTemplates`.

  **Deep imports into module internals are closed.** `"./*": "./*"` shipped
  `dist/server/modules/*/.generated/module.mjs` to consumers of `questpie` and
  `@questpie/admin`. It is replaced by explicit `./internal/*` subpaths carrying
  types only.

  **`module()` keeps dependency types.** It lacked `const`, so a module's own
  `modules` array was widened away.

  **Targets have one owner.** `root`, `outDir`, `outputFile` and `generate` come
  from the owner instead of merging, a duplicate output path throws instead of one
  target deleting another's work, and `target.generate` now runs in package mode.

  Field and context fixes:

  - `f.upload().multiple()` owns a `jsonb` column. It set `virtual: true,
columnFactory: null`, which is the shape of `hasMany`, so the array had
    nowhere to go and `.localized()` was a silent no-op.
  - `f.upload({ mimeTypes, maxSize })` reaches the admin control. Both were
    destructured and discarded.
  - The email service boots without an adapter. It threw at startup, so an app
    that never sends mail could not start, and `MailerService`'s own development
    fallback was unreachable.
  - `global().options({ scoped })` sees context keys you added. It was typed
    against an interface with no augmentation seam, so its own documented example
    did not compile.
  - `ctx.tables` resolves instead of being `undefined`, and `ctx.executor` and
    `ctx.observability` are typed as well as set.

  Removed, with no deprecation because there are no users on it:

  - `createClient({ crdt })`. Configure the engine on `createCrdtClient(client,
{ runtime })`. The old slot put the client CRDT implementation into every
    bundle, which is what splitting it out was meant to prevent. This also fixes
    `createElysiaClient`, which read the removed `client.crdt` getter and threw
    before it could return a client.
  - `generateModule()`. Use `packageConfig()` and `questpie generate`.

### Patch Changes

- Updated dependencies [[`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124), [`195648d`](https://github.com/questpie/questpie/commit/195648dba74395dfa1d37c6ba9382c40ef63c8e3), [`17b6cab`](https://github.com/questpie/questpie/commit/17b6cabffb8f340270c4caf4f8da36be42310fb7), [`cd62bb8`](https://github.com/questpie/questpie/commit/cd62bb8bf4df98b3f75c4a894ba8148677a3b9ae)]:
  - questpie@3.22.0

## 3.21.1

### Patch Changes

- Updated dependencies [[`5c5f5b6`](https://github.com/questpie/questpie/commit/5c5f5b672acfeca55cf7ffd6db97dec535997bfe)]:
  - questpie@3.21.1

## 3.21.0

### Patch Changes

- Updated dependencies [[`fb6653a`](https://github.com/questpie/questpie/commit/fb6653a8b41d5c7e61bf4fa209b2ec86cf91ec7b)]:
  - questpie@3.21.0

## 3.20.1

### Patch Changes

- Updated dependencies [[`4e4ea31`](https://github.com/questpie/questpie/commit/4e4ea3174bce830b1a8efa95faf381aa36b88b24)]:
  - questpie@3.20.1

## 3.20.0

### Patch Changes

- Updated dependencies [[`030c5dd`](https://github.com/questpie/questpie/commit/030c5dd09be7798fcb696e4e47312c758e855930)]:
  - questpie@3.20.0

## 3.19.2

### Patch Changes

- Updated dependencies [[`8114e59`](https://github.com/questpie/questpie/commit/8114e5966ffce9ecc2dd1c3be844dfff065b8af3)]:
  - questpie@3.19.2

## 3.19.1

### Patch Changes

- Updated dependencies [[`15a9f47`](https://github.com/questpie/questpie/commit/15a9f4726fdd68402532f3d6683b657e02a65863)]:
  - questpie@3.19.1

## 3.19.0

### Patch Changes

- Updated dependencies [[`7510720`](https://github.com/questpie/questpie/commit/7510720b88e1688998f5bfe5e098f7a7b3313b38)]:
  - questpie@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [[`62992aa`](https://github.com/questpie/questpie/commit/62992aa22f0708cc0bf545231f1e6f9f47b58516)]:
  - questpie@3.18.0

## 3.17.0

### Patch Changes

- Updated dependencies [[`f534369`](https://github.com/questpie/questpie/commit/f53436930137368000294877b5f02ced55b2dbf4), [`4be1529`](https://github.com/questpie/questpie/commit/4be15299ffafa8a4808474823815a3dc6d49689d), [`079be69`](https://github.com/questpie/questpie/commit/079be6971f1ff3b8f6aed4a1c8bc0b3182bfcb99), [`b5c2b78`](https://github.com/questpie/questpie/commit/b5c2b78f274d444a0b63867d262025d2ebd592a9), [`d752314`](https://github.com/questpie/questpie/commit/d75231406e016b0e07f36182fc6dc9dbb1f8b224), [`c1ab1c0`](https://github.com/questpie/questpie/commit/c1ab1c0b8873a66a163effbc31ec431a5d442298), [`1a750e0`](https://github.com/questpie/questpie/commit/1a750e02a7c9eea7a52c035b009b78b79742961c), [`158ff0c`](https://github.com/questpie/questpie/commit/158ff0c58933a4b498191d99544222af134bea49), [`875ae8c`](https://github.com/questpie/questpie/commit/875ae8c23fbdebd7e557a86ce4ee19c8c180d9aa), [`5c4804a`](https://github.com/questpie/questpie/commit/5c4804a8f45a34e3b8f20fc1210c2518f18e6f6a)]:
  - questpie@3.17.0

## 3.16.0

### Patch Changes

- Updated dependencies [[`ea5f109`](https://github.com/questpie/questpie/commit/ea5f1096009fec7818b0ffd6ae74412662a3ac6e)]:
  - questpie@3.16.0

## 3.15.2

### Patch Changes

- Updated dependencies [[`734737f`](https://github.com/questpie/questpie/commit/734737fd5a079c4063b6ff49f34fbacf01d8a2e8)]:
  - questpie@3.15.2

## 3.15.1

### Patch Changes

- Updated dependencies [[`1e2691f`](https://github.com/questpie/questpie/commit/1e2691f6d2f310860bf81db2219f23dd4d122d10)]:
  - questpie@3.15.1

## 3.15.0

### Patch Changes

- Updated dependencies [[`3e2dc5e`](https://github.com/questpie/questpie/commit/3e2dc5ed47b0b6fa279586d3ce3d27a2cc3154fb), [`0fd1da3`](https://github.com/questpie/questpie/commit/0fd1da363e432653b8c45cef02ed867d3bf34d47), [`018dfb5`](https://github.com/questpie/questpie/commit/018dfb5b77039d0148a59d371062d08d1b89b691)]:
  - questpie@3.15.0

## 3.14.0

### Patch Changes

- Updated dependencies [[`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92), [`d719ae2`](https://github.com/questpie/questpie/commit/d719ae2b94f9e5e83c398ca9d78fc49e7d757b92)]:
  - questpie@3.14.0

## 3.13.0

### Patch Changes

- Updated dependencies [[`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575), [`9423a47`](https://github.com/questpie/questpie/commit/9423a47da757508935f192f73cc99b3ea7bac575)]:
  - questpie@3.13.0

## 3.12.0

### Patch Changes

- Updated dependencies [[`2f6e776`](https://github.com/questpie/questpie/commit/2f6e776896a9381514a237447d4dcc85dad558d0)]:
  - questpie@3.12.0

## 3.11.0

### Patch Changes

- Updated dependencies [[`4ed62ec`](https://github.com/questpie/questpie/commit/4ed62ec7375e7f841a20e7c36c11e15bc4f63b39), [`fed686a`](https://github.com/questpie/questpie/commit/fed686a4a37a34a80783538c632e0597a4a98ec8), [`7c4060d`](https://github.com/questpie/questpie/commit/7c4060df2fbc663cc9d4e718cff4ce72cdd83663), [`6cddd5b`](https://github.com/questpie/questpie/commit/6cddd5b2ec2127db40aa6b97212254689b9f780f)]:
  - questpie@3.11.0

## 3.10.0

### Patch Changes

- Updated dependencies [[`d673da7`](https://github.com/questpie/questpie/commit/d673da7c463233222c8605851c9957cd2e90027d)]:
  - questpie@3.10.0

## 3.9.1

### Patch Changes

- Updated dependencies [[`9e14122`](https://github.com/questpie/questpie/commit/9e1412231f18b40db2c87c1ce35dc352842b5cff)]:
  - questpie@3.9.1

## 3.9.0

### Patch Changes

- Updated dependencies [[`835f985`](https://github.com/questpie/questpie/commit/835f98502bd98a2c2b3f34201ac6370f03105c93)]:
  - questpie@3.9.0

## 3.8.0

### Patch Changes

- Updated dependencies [[`590e6c4`](https://github.com/questpie/questpie/commit/590e6c433a73a44316e89d00eeeaa21b0d584e3b), [`a56e017`](https://github.com/questpie/questpie/commit/a56e0179f6016915996e9bd9a58c7279d070692a), [`81e4922`](https://github.com/questpie/questpie/commit/81e4922e7ed54a2ff2171e86a9ce45a07b7c433b), [`b15ce41`](https://github.com/questpie/questpie/commit/b15ce41ce2ed8378abd0ea3e42c8f577abe9ad6b)]:
  - questpie@3.8.0

## 3.7.0

### Patch Changes

- Updated dependencies [[`029f036`](https://github.com/questpie/questpie/commit/029f036053039e73f9a97d1fe4785ef8c05771f4)]:
  - questpie@3.7.0

## 3.6.1

### Patch Changes

- Updated dependencies [[`c8c4a84`](https://github.com/questpie/questpie/commit/c8c4a845b4f7442ff92123391b2636a9f15d9727)]:
  - questpie@3.6.1

## 3.6.0

### Patch Changes

- Updated dependencies [[`13aad6f`](https://github.com/questpie/questpie/commit/13aad6f57cfd8a6678b7c34d3e33ea324f954a81)]:
  - questpie@3.6.0

## 3.5.6

### Patch Changes

- Updated dependencies [[`ea701dd`](https://github.com/questpie/questpie/commit/ea701ddaa32f85056bbbcb7ba77099af349d6480)]:
  - questpie@3.5.6

## 3.5.5

### Patch Changes

- Updated dependencies [[`24c0f0e`](https://github.com/questpie/questpie/commit/24c0f0edcc22dd21da3070139e96cb9bab7601e0)]:
  - questpie@3.5.5

## 3.5.4

### Patch Changes

- Updated dependencies [[`4591b08`](https://github.com/questpie/questpie/commit/4591b08ff5f06196ea9303df2a5b0b08f9134c54)]:
  - questpie@3.5.4

## 3.5.3

### Patch Changes

- Updated dependencies [[`f678f70`](https://github.com/questpie/questpie/commit/f678f70121f8be87fd4a5be6a9b19a0ec3653d09), [`ed73b91`](https://github.com/questpie/questpie/commit/ed73b917e4a1a59908e186171a4ab837edb3be9f)]:
  - questpie@3.5.3

## 3.5.2

### Patch Changes

- Updated dependencies [[`bc0bc1d`](https://github.com/questpie/questpie/commit/bc0bc1dbfd24ddfa109218629fd97af52bcdf63e)]:
  - questpie@3.5.2

## 3.5.1

### Patch Changes

- Updated dependencies []:
  - questpie@3.5.1

## 3.5.0

### Patch Changes

- Updated dependencies [[`1964037`](https://github.com/questpie/questpie/commit/196403736308b1bc8ff9309f4e1673f39bf3a972)]:
  - questpie@3.5.0

## 3.4.1

### Patch Changes

- Updated dependencies [[`080da92`](https://github.com/questpie/questpie/commit/080da92a871df7f71263a3427145de9cd4fbdb58)]:
  - questpie@3.4.1

## 3.4.0

### Patch Changes

- Updated dependencies [[`42e0636`](https://github.com/questpie/questpie/commit/42e0636c8cf3dac1d2148878b4a76904a7b506b3)]:
  - questpie@3.4.0

## 3.3.0

### Patch Changes

- Updated dependencies [[`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434)]:
  - questpie@3.3.0

## 3.2.7

### Patch Changes

- Updated dependencies []:
  - questpie@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [[`40768c4`](https://github.com/questpie/questpie/commit/40768c4dc634dce6fa8c71ce1f23e0c7080ab1a9)]:
  - questpie@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies []:
  - questpie@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [[`ebee6b1`](https://github.com/questpie/questpie/commit/ebee6b161d46d2d6955d5c1839864bbc8d67cd69)]:
  - questpie@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [[`7607322`](https://github.com/questpie/questpie/commit/7607322cf6bbc0d933dd2c593edd3de618827b06)]:
  - questpie@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [[`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8)]:
  - questpie@3.2.2

## 3.2.1

### Patch Changes

- [#57](https://github.com/questpie/questpie/pull/57) [`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Enhance the existing Preview flow with visual editing support, draft patch synchronization, inline scalar editing, block preview annotations, and block insertion affordances wired to the existing block editor.

  Update the barbershop example, documentation, scaffolder templates, and bundled QUESTPIE skills to describe and preserve the single Preview system architecture.

  Cache admin auth branding snapshots to avoid React update loops on login pages, translate select option labels consistently across admin tables and related UI, reduce hook recursion noise for legitimate nested read flows, resolve generated app output next to re-exported server configs for CLI commands, and add configurable request logging with request/trace id propagation and scoped application log correlation.

  The observability work provides a foundation without introducing OpenTelemetry tracing or exporter dependencies yet.

  Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to QUESTPIE Cloud.

- Updated dependencies [[`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab), [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851)]:
  - questpie@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [[`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead)]:
  - questpie@3.2.0

## 3.1.0

### Patch Changes

- Updated dependencies [[`6186dfb`](https://github.com/questpie/questpie/commit/6186dfbb7fd4423f4ee0c5b1af78f3690f433dfb)]:
  - questpie@3.1.0

## 3.0.9

### Patch Changes

- Updated dependencies []:
  - questpie@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies []:
  - questpie@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [[`5d7639b`](https://github.com/questpie/questpie/commit/5d7639b28d4625c5d587ad256cbac98ba14ff886)]:
  - questpie@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [[`ea2ff8d`](https://github.com/questpie/questpie/commit/ea2ff8dea8ad7b20946ed91906374e25a2bb9ba5)]:
  - questpie@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [[`325599e`](https://github.com/questpie/questpie/commit/325599e70089bcdeb632d0e389614e6738a514cb)]:
  - questpie@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [[`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb)]:
  - questpie@3.0.4

## 3.0.3

### Patch Changes

- Updated dependencies [[`e40fc20`](https://github.com/questpie/questpie/commit/e40fc200dbd604e2ad8147b4dd1711d11b968b91), [`acfc1c0`](https://github.com/questpie/questpie/commit/acfc1c0b94a2cde684d17ae50b2c4c2278d8705c)]:
  - questpie@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [[`25b85ec`](https://github.com/questpie/questpie/commit/25b85ec54cfa7fdf38ee15548377d01191f0667a)]:
  - questpie@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [[`fca6096`](https://github.com/questpie/questpie/commit/fca60967ee1c2b6b8fb439230e663daea60b0465), [`3e8e7e1`](https://github.com/questpie/questpie/commit/3e8e7e1f1b5b7fe05c58fd582d0ee6ced05c6411)]:
  - questpie@3.0.1

## 3.0.0

### Major Changes

- [`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78) Thanks [@drepkovsky](https://github.com/drepkovsky)! - # QuestPie v3

  Full v3 architecture redesign — module system, core module extraction, service definitions, route conventions, and type-safe field methods.

  ## Breaking Changes

  - **`QuestpieBuilder` removed** — `q()`, `.use()`, `.build()` chain replaced by file convention + `questpie generate`
  - **RPC module removed** — replaced by `routes/*.ts` directory with `route()` builder
  - **`app.api.*` removed** — use `app.collections` / `app.globals` direct getters
  - **Positional callbacks → destructured** — `.fields((f) => ...)` → `.fields(({ f }) => ...)`
  - **`contextResolver` removed** — session/locale are scoped CRUD context params
  - **`RegisteredApp` type removed** — use `typedApp<App>(ctx.app)` instead
  - **`fetchFn` → `loader`** on all dashboard widget types
  - **Secure-by-default access** — authenticated session required when no access rules defined
  - **Audit module opt-in** — `auditModule` must be explicitly added via `.use(auditModule)`

  ## New Features

  - **Module system** — core infrastructure (search, realtime, auth, queue) wired as formal service definitions
  - **`fieldType()` + `FieldWithMethods`** — type-safe field chain methods (`.manyToMany()`, `.trim()`, `.autoNow()`, etc.)
  - **Hook type safety** — fully typed `ctx.data` in collection hooks, no more `{ [x: string]: any }` fallback
  - **Route system** — file-path conventions, method-specific route definitions, priority matcher
  - **Workflow transitions** — `transitionStage()` with scheduled transitions, audit logging, admin UI
  - **Version history** — full versions/revert parity across stack with admin UI
  - **Server actions** — real form field mapping, RPC execution, effects handling
  - **Admin field meta augmentation** — all field types properly augmented with admin meta

### Patch Changes

- Updated dependencies [[`202856b`](https://github.com/questpie/questpie/commit/202856bb3e7f17cb2898523f8911349f45686e78)]:
  - questpie@3.0.0

## 2.0.0

### Major Changes

- [#16](https://github.com/questpie/questpie/pull/16) [`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - ## Ship field builder platform, server-driven admin, and standalone RPC API

  ### `questpie` (core)

  #### Field Builder System (NEW)

  Replace raw Drizzle column definitions with a type-safe field builder. Collections and globals now define fields via a callback that receives a field builder proxy `f`:

  ```ts
  // Before
  collection("posts").fields({
    title: varchar("title", { length: 255 }),
    content: text("content"),
  });

  // After
  q.collection("posts").fields((f) => ({
    title: f.text({ required: true }),
    content: f.textarea({ localized: true }),
    publishedAt: f.datetime(),
  }));
  ```

  Built-in field types: `text`, `textarea`, `number`, `boolean`, `date`, `datetime`, `time`, `email`, `url`, `select`, `upload`, `json`, `object`, `array`, `relation`. Each field produces Drizzle columns, Zod validation schemas, typed operators for filtering, and serializable metadata for admin introspection — all from a single declaration.

  **Custom field types** — define your own field types with the `field<TConfig, TValue>()` factory. A custom field implements `toColumn` (Drizzle column), `toZodSchema` (validation), `getOperators` (query filtering), and `getMetadata` (introspection). Register custom fields on the builder via `q.fields({ myField })` and they become available as `f.myField()` in all collections:

  ```ts
  const slugField = field<SlugFieldConfig, string>()({
    type: "slug",
    _value: undefined as unknown as string,
    toColumn: (name, config) => varchar(name, { length: 255 }),
    toZodSchema: (config) => z.string().regex(/^[a-z0-9-]+$/),
    getOperators: (config) => ({
      column: stringColumnOperators,
      jsonb: stringJsonbOperators,
    }),
    getMetadata: (config) => ({
      type: "slug",
      label: config.label,
      required: config.required ?? false,
      localized: false,
      readOnly: false,
      writeOnly: false,
    }),
  });

  // Register:
  const app = q({ name: "app" }).fields({ slug: slugField });
  // Use:
  collection("pages").fields((f) => ({ slug: f.slug({ required: true }) }));
  ```

  **Custom operators** — the `operator<TValue>()` helper creates typed filter functions from `(column, value, ctx) => SQL`. Each field's `getOperators` returns context-aware operator sets for both column and JSONB access. Operators are automatically used by the query builder and exposed via the client SDK's `where` parameter.

  #### Reactive Field System (NEW)

  Server-evaluated reactive behaviors on fields via `meta.admin`:

  - **`hidden`** / **`readOnly`** / **`disabled`** — conditionally toggle field state based on form data
  - **`compute`** — auto-compute values from other fields
  - **Dynamic `options`** — load select/relation options on the server with dependency tracking and debounce

  Reactive handlers run server-side with full access to `ctx.db`, `ctx.user`, `ctx.req`. A proxy-based dependency tracker automatically detects which form fields each handler reads and serializes that info to the client for efficient re-evaluation.

  #### Standalone RPC API (NEW)

  New `q.rpc()` builder for defining type-safe remote procedures outside collection/global CRUD. RPC procedures are routed through the HTTP adapter at `/rpc/<path>` with nested routers, access control, and full type inference on the client SDK.

  ```ts
  const r = q.rpc<typeof app>();
  export const dashboardRouter = r.router({
    stats: r.fn({
      handler: async ({ app }) => {
        /* ... */
      },
    }),
  });
  ```

  Collections and globals also support scoped `.functions()` for entity-specific RPC, routed at `/collections/:slug/rpc/:name` and `/globals/:slug/rpc/:name`.

  #### Callable `q` Builder

  The `q` export is now a callable builder: use `q({ name: "my-app" })` to create a fresh `QuestpieBuilder`, or access `q.collection()`, `q.global()`, `q.job()` etc. as methods. Default field types are auto-registered. Standalone function exports (`collection`, `global`, `job`, `fn`, `email`, `auth`, `config`, `rpc`) are are also re-exported.

  #### Introspection API (NEW)

  Full server-side introspection of collection and global schemas for admin consumption: field metadata, access permissions, relation info, reactive config, validation schemas — all serialized from builder state. Admin UI consumes this directly instead of relying on client-side config.

  #### Queue Runtime Redesign (BREAKING)

  - Redesigned `QueueService` with proper lifecycle (`start`/`stop`/`drain`), graceful shutdown, and health checks
  - New Cloudflare Queues adapter alongside pg-boss
  - Worker handlers now receive `{ payload, app }` instead of `(payload, ctx)`
  - Workflow builder API refined with better type inference

  #### Realtime Pipeline Hardening (BREAKING)

  - `PgNotifyAdapter`: proper connection lifecycle, idempotent `start`/`stop`, owned vs shared client tracking, handler cleanup
  - `RedisStreamsAdapter`: graceful error handling in read loop, no longer auto-disconnects client on `stop()`
  - `streamedQuery` from `@tanstack/react-query` integrated as first-class citizen in collection query options

  #### Access Control (BREAKING)

  - **Removed** `access.fields` from collection/global builder — field-level access is now defined per-field via `access: { read, update }` in the field definition itself
  - CRUD generator evaluates field-level access at runtime, filtering output and validating input per field

  #### CRUD API Alignment (BREAKING)

  - Client SDK `update`/`delete`/`restore` now accept object params `{ id, data }` instead of positional args
  - Relation field names are automatically transformed to FK columns in create/update operations
  - `updateMany` and `deleteMany` added to HTTP adapter, client SDK, and tanstack-query
  - Better Auth drizzle adapter now correctly uses transactions

  #### Server-Driven Admin Config

  Admin configuration (sidebar, dashboard, branding, actions) is now defined server-side and served via introspection. The server emits serializable `ComponentReference` objects (`{ type, props }`) instead of React elements. A typed **component factory** `c` is available in all admin config callbacks:

  ```ts
  // Server-side (serializable, no React imports):
  .admin(({ c }) => ({
    icon: c.icon("ph:article"),       // => { type: "icon", props: { name: "ph:article" } }
    badge: c.badge({ text: "New" }),   // => { type: "badge", props: { text: "New" } }
  }))
  ```

  The client resolves these references via `ComponentRenderer` which looks up the matching React component from the admin builder's component registry. Built-in components (`icon` → Iconify, `badge`) are registered by default; custom ones are added via `qa().components({ myComponent: MyReactComponent })`.

  ***

  ### `@questpie/admin`

  #### Server-Driven Schema (BREAKING)

  Admin UI now consumes field schemas, sidebar config, dashboard config, and branding from server introspection instead of client-side builder config. `defineAdminConfig` is replaced by server-defined metadata.

  #### Builder API Cleanup (BREAKING)

  - **Removed** from `qa` namespace: `qa.collection()`, `qa.global()`, `qa.block()`, `qa.sidebar()`, `qa.dashboard()`, `qa.branding()` — these are now server-side concerns
  - Kept: `qa.field()`, `qa.listView()`, `qa.editView()`, `qa.widget()`, `qa.page()` for client-only UI registrations
  - Admin `CollectionBuilder` and `GlobalBuilder` completely rewritten — all schema methods (`.fields()`, `.list()`, `.form()`) removed; only UI-specific methods remain (`.meta()`, `.preview()`, `.autoSave()`, `.use()`)

  #### Reactive Fields UI (NEW)

  - `useReactiveFields` hook evaluates server-defined reactive config (hidden/readOnly/disabled/compute) client-side with automatic dependency tracking
  - `useFieldOptions` hook for dynamic options loading with search debounce and SSE streaming

  #### Block Editor Rework

  - Full drag-and-drop block editor with canvas layout, block library sidebar, tree navigation
  - Block field metadata unified between collections and blocks
  - Block prefetch values inferred from field definitions

  #### Actions System (NEW)

  Collection-level actions system with both client and server handler modes:

  - **Handler types**: `navigate` (routing), `api` (HTTP call), `form` (dialog with field inputs), `dialog` (custom component), `custom` (arbitrary code), `server` (server-side execution with full app context)
  - **Scopes**: `header` (list view toolbar — primary buttons + secondary dropdown), `bulk` (selected items toolbar), `single`/`row` (per-item)
  - **Server actions** run handler on the server with access to `app`, `db`, `session`; return typed results (`success`, `error`, `redirect`, `download`) with side-effects (`invalidate`, `toast`, `navigate`)
  - **Form actions** accept field definitions from the field registry (`f.text()`, `f.select()`, etc.) for type-safe input collection in a dialog
  - **Confirmation dialogs** configurable per action with destructive styling support
  - Built-in action presets: `create`, `save`, `delete`, `deleteMany`, `duplicate`

  #### Realtime Multiplexor

  Migrated from example code into core admin package for SSE-based live updates.

  #### Test Migration

  All admin tests migrated from vitest to bun:test; vitest dependency removed.

  ***

  ### `@questpie/tanstack-query`

  #### RPC Query Options (NEW)

  Full type-safe query/mutation option builders for RPC procedures with nested router support. The `createQuestpieQueryOptions` factory now accepts a `TRPC` generic for RPC router types, producing `.rpc.*` namespaced option builders.

  #### Realtime Streaming (NEW)

  - Re-exports `buildCollectionTopic`, `buildGlobalTopic`, `TopicConfig`, `RealtimeAPI` from core client
  - Collection `.find`, `.findOne`, `.count` option builders produce `streamedQuery`-based options for SSE real-time updates

  #### Batch Operations (NEW)

  - `updateMany` and `deleteMany` mutation option builders for collections
  - `key` builders for all collection/global operations

  ***

  ### `@questpie/openapi` (NEW PACKAGE)

  OpenAPI 3.1 spec generator for QUESTPIE instances. Generates schemas for collections (CRUD + search), globals, auth, and RPC endpoints. Includes a Scalar-powered API reference UI mountable via the adapter.

  ***

  ### `@questpie/elysia` / `@questpie/hono` / `@questpie/next`

  - All adapters accept `rpc` config to mount standalone RPC router trees alongside CRUD routes
  - Formatting standardized (tabs → spaces alignment)
  - `@questpie/hono`: `questpieHono` now correctly forwards RPC router to fetch handler

  ***

  ### `create-questpie` (NEW PACKAGE)

  Interactive CLI (`bunx create-questpie`) for scaffolding new QUESTPIE projects. Ships with a TanStack Start template including pre-configured collections, globals, admin setup, migrations, and dev tooling.

### Patch Changes

- Updated dependencies [[`dd3ea44`](https://github.com/questpie/questpie/commit/dd3ea441d30a38705084c6068f229af21d5fd8d4)]:
  - questpie@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies [[`7172275`](https://github.com/questpie/questpie/commit/71722757a95e1f30521ac1eeca1080a8691bb9fc)]:
  - questpie@1.1.1

## 1.1.0

### Patch Changes

- Updated dependencies [[`a7efd1e`](https://github.com/questpie/questpie/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002)]:
  - questpie@1.1.0

## 1.0.5

### Patch Changes

- Updated dependencies [[`a043841`](https://github.com/questpie/questpie/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9)]:
  - questpie@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [[`01562df`](https://github.com/questpie/questpie/commit/01562dfb6771a47eddcb797f36f951ae434f29c8)]:
  - questpie@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies []:
  - questpie@1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions

  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

- Updated dependencies [[`eb98bb9`](https://github.com/questpie/questpie/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77)]:
  - questpie@1.0.2

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

- Updated dependencies [[`87c7afb`](https://github.com/questpie/questpie/commit/87c7afbfad14e3f20ab078a803f11abf173aae99)]:
  - questpie@1.0.1

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

### Patch Changes

- Updated dependencies [[`934c362`](https://github.com/questpie/questpie/commit/934c362c22a5f29df20fa12432659b3b10400389)]:
  - questpie@1.0.0

## 0.0.2

### Patch Changes

- chore: include files in package.json
- Updated dependencies
  - questpie@0.0.2

## 0.0.1

### Patch Changes

- feat: initial release
- Updated dependencies
  - questpie@0.0.1
