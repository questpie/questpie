# Action Wire v3 / Effect Identity proof

This directory contains the executable candidate and the exact retained Wire
v2 input. It changes no production or public authority. The sibling
`../action-limits/` proof is integrated into the same branch for eventual joint
acceptance.

Run the deterministic gates:

```sh
bun run docs/v4/prototypes/action-wire-v3-effect-identity/check.ts
bun run docs/v4/prototypes/action-wire-v3-effect-identity/portable-check.ts
dependency_root="${QUESTPIE_DEPENDENCY_ROOT:-$(
  git worktree list --porcelain | sed -n 's/^worktree //p' |
    while IFS= read -r candidate; do
      if test -x "$candidate/node_modules/typescript/bin/tsc" &&
        test "$(git -C "$candidate" rev-parse HEAD:packages/compiler 2>/dev/null)" = "$(git rev-parse HEAD:packages/compiler)" &&
        test "$(git -C "$candidate" rev-parse HEAD:fixtures/collaboration 2>/dev/null)" = "$(git rev-parse HEAD:fixtures/collaboration)"; then
        printf '%s\n' "$candidate"
        break
      fi
    done
)}"
test -n "$dependency_root" || {
  echo "Set QUESTPIE_DEPENDENCY_ROOT to a matching worktree with node_modules" >&2
  exit 1
}
QUESTPIE_CANONICAL_ROOT="$PWD" QUESTPIE_DEPENDENCY_ROOT="$dependency_root" \
	  bun run docs/v4/prototypes/action-wire-v3-effect-identity/repository-check.ts
bun "$dependency_root/node_modules/typescript/bin/tsc" \
  --typeRoots "$dependency_root/node_modules/@types" \
  -p docs/v4/prototypes/action-wire-v3-effect-identity/tsconfig.json
bun test docs/v4/prototypes/action-limits/check.test.ts
bun "$dependency_root/node_modules/typescript/bin/tsc" \
  --typeRoots "$dependency_root/node_modules/@types" \
  -p docs/v4/prototypes/action-limits/tsconfig.json
bunx oxlint --deny-warnings docs/v4/prototypes/action-wire-v3-effect-identity/*.ts
bunx oxfmt --check docs/v4/prototypes/action-wire-v3-effect-identity
git diff --check
```

The combined limits seam is pinned in `acceptance-manifest.json`. Do not run
formal acceptance from this directory; only the integration owner may invoke
the manifest-driven review after every deterministic gate passes at its final
committed head.
