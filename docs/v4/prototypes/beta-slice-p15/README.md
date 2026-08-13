# P15 beta slicing proof

This proof converts the accepted ideal contract into release slices without a
temporary public architecture. `SLICE.json` is machine-checked for complete
ownership, dependency closure, and named absence stories.

```sh
bun run docs/v4/prototypes/beta-slice-p15/check.ts
bun run docs/v4/prototypes/beta-slice-p15/negative-control.ts
bunx oxfmt --check docs/v4/prototypes/beta-slice-p15
git diff --check
```
