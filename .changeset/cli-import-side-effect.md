---
"questpie": patch
---

fix(cli): importing `questpie/cli` no longer executes the CLI. `program.parse()` is now guarded by `import.meta.main`, so it only runs when the CLI file is the process entry (the `questpie` bin or a direct `bun run .../exports/cli.ts`). Previously, a `questpie.config.ts` importing `packageConfig` from `"questpie/cli"` during `bun x questpie generate` loaded a second module instance (src vs dist) whose top-level parse started the same generate again concurrently, corrupting `.generated/module.ts` files (truncated output with NUL bytes). Codegen also writes generated files atomically now (temp file + rename), so concurrent or killed runs can never leave truncated output behind.
