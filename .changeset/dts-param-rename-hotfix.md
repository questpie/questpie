---
"questpie": patch
---

HOTFIX: the published 3.6.0 `.d.ts` broke declaration merging for every npm consumer — the dts bundler renamed `CollectionBuilder`'s type parameter to `TState$1` (name collision with a module-private `infer TState` in the same emitted file), so the generated `interface CollectionBuilder<TState extends CollectionBuilderState>` augmentation no longer merged (TS2428) and all collections degraded to `any` in published-package consumers. The colliding infer is renamed, and a new CI dist-types gate typechecks a real example against the BUILT `.d.mts` output (plus declaration-shape assertions on all augmentation-target classes) so dts-emit regressions of this class can never ship again.
