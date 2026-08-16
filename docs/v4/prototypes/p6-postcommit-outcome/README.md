# P6R1 post-commit outcome proof

This bounded proof closes the one conflict between Accepted P3 post-commit
recovery and the closed Accepted P6 Operation Wire v1. It preserves v1, freezes
one v2 framework transaction outcome, proves exact general Call Identity text,
and retains the reviewed authority projection as an ancestor commit.

Run:

```sh
bun run docs/v4/prototypes/p6-postcommit-outcome/check.ts
bun run docs/v4/prototypes/p6-postcommit-outcome/negative-control.ts
bun run docs/v4/prototypes/p6-postcommit-outcome/portable-check.ts
bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/p6-postcommit-outcome/tsconfig.json
bunx oxlint --deny-warnings docs/v4/prototypes/p6-postcommit-outcome/*.ts
bunx oxfmt --check docs/v4/prototypes/p6-postcommit-outcome
git diff --check
```

The candidate head intentionally does not contain ADR-0023. Exact projection
commit `fa7ee83d` is an ancestor and exact revert `df044e5a` removes it before
review. `PROJECTION.patch.b64` is a lossless copy of the same diff, so the
review packet and CI do not depend on history traversal. A fresh stateless
Opus-medium `PASS` is required before restoring that projection.
