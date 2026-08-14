# API ergonomics gate proof

This bounded proof falsifies the public spelling reopened after BETA-01. It
compares factory families, compiles exact nested handler calls, measures editor
behavior, rejects same-kind leaf/prefix collisions, preserves cross-kind names,
tests prototype-sensitive segments with null-prototype runtime maps, relocates
the type fixture, proves Package isolation, and validates the capability map.

`EVIDENCE.json` records the deterministic declarations/editor/diagnostic
projection. `MEASUREMENTS.json` keeps the separate measured budget sample;
`ADVERSARIAL.md` records exploratory attacks that are not acceptance evidence.
`PROJECTION.json` is the single exact Operation input used by the runtime trie;
the TypeScript proof parses the generated declaration golden and requires its
leaf paths to equal that same input.

Run:

```sh
bun docs/v4/prototypes/api-ergonomics-gate/run.mjs
bun node_modules/typescript/bin/tsc \
  -p docs/v4/prototypes/api-ergonomics-gate/types/tsconfig.json \
  --pretty false --extendedDiagnostics
```
