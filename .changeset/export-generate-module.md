---
"questpie": minor
---

`generateModule` is now actually exported from `questpie/codegen`.

The docs have described it as public API since the codegen page was written -
"convenience wrapper for npm packages that emit `.generated/module.ts` at build
time" - but it was never re-exported from `src/exports/codegen.ts`, and
`questpie`'s build entry is `src/exports/*` only, so it never reached `dist`.
Anyone following the documentation hit a module that could not be imported.

```ts
import { generateModule } from "questpie/codegen";

await generateModule({
	moduleName: "questpie-starter",
	rootDir: "./src/server/modules/starter",
});
```

Same discovery and same output as `questpie generate --module`, for packages
whose build is already a script and would rather not shell out to the CLI. It
does not change the rule that `.generated/module.ts` is generated and never
hand-written - it is another way to run the generator, not a way around it.

Also documented in the skill (`references/module-authoring.md`), which had no
mention of it.
