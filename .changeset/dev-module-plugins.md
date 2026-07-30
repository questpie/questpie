---
"questpie": patch
---

`questpie dev` no longer strips module-contributed codegen on every save.

Two code paths assembled the codegen plugin list and they had drifted.
`questpie generate` runs a pre-pass that reads `modules.ts` and merges the
plugins declared there. `questpie dev` did not: it built the watch graph from
core plus `runtimeConfig().plugins`, and ran every debounced regeneration from
`runtimeConfig().plugins` alone.

Scaffolded apps declare no `plugins` in `runtimeConfig` — all four
create-questpie templates leave it out — so module plugins reach codegen
exclusively through `modules.ts`. Every watch-triggered regeneration therefore
ran core-only.

That is destructive, not merely incomplete. `writeGeneratedFiles` does
`rm -rf outDir` before writing, so the first file save after starting
`questpie dev` replaced a complete `.generated` with one missing the
`views`, `components` and `blocks` categories and every collection extension,
and stopped regenerating the `admin-client` target entirely. It reported no
error. The next thing the developer touched failed to compile, pointing
nowhere near codegen — and re-running `questpie generate` silently repaired it,
which is the worst possible debugging signal.

The watch graph also missed the directories those targets own, so changes there
triggered no regeneration at all.

`devCommand` now runs the same `extractModulePlugins` pre-pass and uses the
merged list for both the watch graph and each regeneration.
