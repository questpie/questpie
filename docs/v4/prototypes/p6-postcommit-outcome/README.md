# P6R1 post-commit outcome proof

This bounded proof closes the one conflict between Accepted P3 post-commit
recovery and the closed Accepted P6 Operation Wire v1. It preserves v1, freezes
one v2 framework transaction outcome, carries forward the v1 result and
declared-error grammar, proves exact general Call Identity text, and retains the
reviewed authority projection as an ancestor commit. Retained v1 Queries remain
executable; v1 Mutations fail before Context Resolution or Operation execution.
`P6-GOLDENS.mjs.b64` preserves the exact Accepted P6 source blob inside the
packet because the historical proof head is not an ancestor of BETA-06.

Run:

```sh
bun run docs/v4/prototypes/p6-postcommit-outcome/check.ts
bun run docs/v4/prototypes/p6-postcommit-outcome/negative-control.ts
bun run docs/v4/prototypes/p6-postcommit-outcome/portable-check.ts
bun node_modules/typescript/bin/tsc -p docs/v4/prototypes/p6-postcommit-outcome/tsconfig.json
bunx oxlint --deny-warnings docs/v4/prototypes/p6-postcommit-outcome/*.ts
bunx oxfmt --check docs/v4/prototypes/p6-postcommit-outcome/{DECISION.md,README.md,REVISION.json,acceptance-manifest.json,wire-v1.json,wire-v2.json,check.ts,negative-control.ts,portable-check.ts,tsconfig.json}
git diff --check
```

The candidate head intentionally does not contain ADR-0023. Exact projection
commit `823d199e` is an ancestor and exact revert `64e7cf11` removes it before
review. `PROJECTION.patch.b64` is a lossless copy of the same diff, so the
review packet and CI do not depend on history traversal. A fresh stateless
Opus-medium `PASS` is required before restoring that projection.
