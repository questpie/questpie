---
"questpie": minor
---

Run QUESTPIE on Node runtimes (e.g. Next.js), not just Bun.

- **DB driver by runtime:** the `db.url` config now selects `node-postgres`
  (via the optional `pg` peer dependency) when running on Node, and keeps the
  native `bun:sql` driver on Bun. One `db.url` config works on both runtimes;
  Bun servers are unchanged.
- **Extensionless codegen imports:** the generated `.generated/` layer files
  (`index → context.gen → entities.gen → names.gen`) now emit extensionless
  import specifiers instead of `.js`. Every supported bundler resolves these
  under `moduleResolution: "bundler"` (Vite, Bun, and — unlike the `.js` form —
  Turbopack/Next.js). Regenerate to pick up the new form; the old `.js` output
  keeps working until then.
