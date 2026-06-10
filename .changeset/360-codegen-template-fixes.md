---
"questpie": patch
"@questpie/admin": patch
---

Codegen template fixes — `questpie generate` output now typechecks again. (1) Builder module augmentations emit an IDENTICAL type parameter list to the class (`TState extends CollectionBuilderState`) — the renamed `TState$1` param broke declaration merging (TS2428) and made the merged symbol two-generic (TS2314); the admin package's own augmentation is aligned too (targets `questpie/builders`, constrained params). (2) Job handler `collections` typing is emitted as explicit literal maps of local collection imports again — routing through `AppCollections` (`typeof _modules`) created a type cycle whenever a job file was part of the module graph, silently collapsing the mapped type (TS2339). (3) File discovery skips `.test.`/`.spec.` files and `__tests__` directories in convention dirs — a stray `foo.test.tsx` in `admin/blocks/` was discovered as a block and its dotted key generated unparseable TypeScript in the admin-client target.
