# Action Wire v3 / Effect Identity proof

This directory contains the executable candidate and the exact retained Wire
v2 input. It changes no production or public authority. The sibling
`../action-limits/` proof is integrated into the same branch for eventual joint
acceptance.

Run the deterministic gates:

```sh
bun run docs/v4/prototypes/action-wire-v3-effect-identity/check.ts
bun run docs/v4/prototypes/action-wire-v3-effect-identity/portable-check.ts
QUESTPIE_CANONICAL_ROOT="$PWD" \
	  bun run docs/v4/prototypes/action-wire-v3-effect-identity/repository-check.ts
bun /home/drepkovsky/code/questpie-v4/node_modules/typescript/bin/tsc \
  --typeRoots /home/drepkovsky/code/questpie-v4/node_modules/@types \
  -p docs/v4/prototypes/action-wire-v3-effect-identity/tsconfig.json
bun test docs/v4/prototypes/action-limits/check.test.ts
bun /home/drepkovsky/code/questpie-v4/node_modules/typescript/bin/tsc \
  --typeRoots /home/drepkovsky/code/questpie-v4/node_modules/@types \
  -p docs/v4/prototypes/action-limits/tsconfig.json
bunx oxlint --deny-warnings docs/v4/prototypes/action-wire-v3-effect-identity/*.ts
bunx oxfmt --check docs/v4/prototypes/action-wire-v3-effect-identity
git diff --check
```

Do not run formal acceptance from this directory yet. The integration owner
must first adjudicate the combined limits seam and create a pinned protocol-v2
manifest for the committed combined head.
