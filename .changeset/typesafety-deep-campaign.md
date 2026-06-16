---
"questpie": minor
"@questpie/admin": minor
---

Deep type-safety campaign — break the codegen type cycles and make acyclicity structural.

The generated `.generated/` output is now a strict one-way layered DAG (`names.gen.ts` → `entities.gen.ts` → `context.gen.ts` → `index.ts`), which makes the `AppContext⇄config` and `ctx → user-code` cycles impossible by construction. A new CI check (`check:codegen-layers`) enforces no-upward-import / no-cycle on the generated layers.

Fixes:
- Module-contributed collections that were re-declared across a module-nesting boundary (e.g. the admin module re-declaring starter's `user`) collapsed to `never` — so `collections.user.create()` had `never` inputs and a `{}` return. The module fold now OVERRIDE-merges same-key collection contributions instead of intersecting them.
- `ctx.services.<other>` inside a service's `create()` no longer triggers a self-referential type cycle (routed through an ambient `Questpie.Services` registry + a flat per-key seam).
- Per-category name registries (`Questpie.<Cat>Keys`) are now emitted for ALL discovered categories (routes/services/blocks/emails/views/components/field-types + collections/globals/jobs) via generic discovery, instead of a hardcoded collections/globals/jobs subset.

Notes:
- Types are tightened. After regenerating (`questpie generate`), you may see new type errors that surface previously-hidden bugs — this is intended.
- The public `#questpie` import surface and the runtime API are unchanged; the layered split is internal to the generated output.
