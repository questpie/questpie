---
"questpie": minor
"@questpie/admin": minor
"@questpie/elysia": minor
---

Close a set of holes where the framework promised something and quietly did not
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
