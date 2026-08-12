# P1 executable Definition compiler proof

This directory is an executable witness for the bounded P1 contract in
`docs/v4/research/framework-api-atlas/PROOF-MAP.md`. It is not a production
compiler or Runtime implementation.

The proof keeps the accepted foundational artifacts from `d03358b7` fixed and
tests only:

- the six current-virtual `#questpie/app` Definition factories;
- first sync, stale-output refusal, exact stock-TypeScript contexts, and
  Package-local isolation;
- inline/imported handler slicing, output-inference rounds, explicit cycle
  pins, and body-versus-contract artifact changes;
- Collection Operation Set expansion, Context and Policy ownership facts,
  collisions, Origins, explanation, determinism, and relocation;
- Runtime Build/static-slot pairing and every P1 size, type, and editor budget.

Run the complete proof with Bun:

```bash
bun docs/v4/prototypes/executable-definition-compiler/run.mjs
```

The command writes only to an operating-system temporary directory. Committed
goldens remain ordinary source-controlled evidence.
