# @questpie/vite-plugin-iconify

## 0.0.2

### Patch Changes

- [#41](https://github.com/questpie/questpie/pull/41) [`affb27e`](https://github.com/questpie/questpie/commit/affb27efff0837d181351793c5db3434e34616cb) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Prepare the next patch release across admin, core, scaffolding, and the Iconify Vite plugin.

  - Improve admin browser titles, metadata, dashboard widget sizing, form sidebar responsiveness, upload previews, localized validation messages, and file-first chrome/theme customization paths.
  - Add an admin-managed user avatar upload field backed by the assets collection while keeping Better Auth's `image` URL field compatible.
  - Expose a media upload sheet from upload-enabled collection list views.
  - Route admin server Drizzle imports through the `questpie` Drizzle re-exports so admin tests and published package consumers do not require a duplicate direct Drizzle resolution.
  - Improve migration and seed validation robustness, route/context propagation, and stricter CLI path/category/integer option parsing.
  - Harden project scaffolding with `.env` creation, non-interactive database/codegen/skills options, generated-project QUESTPIE agent skills, and fresh-app verification scripts.
  - Fix `@questpie/vite-plugin-iconify` package exports so the published package resolves to the built `dist/index.mjs` entrypoint with bundled declarations.
