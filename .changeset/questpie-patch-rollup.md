---
"@questpie/admin": patch
"@questpie/vite-plugin-iconify": patch
"create-questpie": patch
"questpie": patch
---

Prepare the next patch release across admin, core, scaffolding, and the Iconify Vite plugin.

- Improve admin browser titles, metadata, dashboard widget sizing, form sidebar responsiveness, upload previews, localized validation messages, and file-first chrome/theme customization paths.
- Route admin server Drizzle imports through the `questpie` Drizzle re-exports so admin tests and published package consumers do not require a duplicate direct Drizzle resolution.
- Improve migration and seed validation robustness, route/context propagation, and stricter CLI path/category/integer option parsing.
- Harden project scaffolding with `.env` creation, non-interactive database/codegen/skills options, generated-project QUESTPIE agent skills, and fresh-app verification scripts.
- Fix `@questpie/vite-plugin-iconify` package exports so the published package resolves to the built `dist/index.mjs` entrypoint with bundled declarations.
