# Proof construction and acceptance

## Construct

1. Read `docs/v4/research/framework-api-atlas/PROOF-MAP.md`, the ticket's
   Accepted ADR inputs, and only linked evidence. Inspect every worktree before
   editing; create a dedicated clean proof worktree and leave accepted proof
   worktrees unchanged.
2. Make the smallest executable proof that can falsify the proposed invariant.
   Include hostile and negative cases, exact artifacts/digests, relevant
   PostgreSQL and TypeScript measurements, and relocation/isolation checks.
3. Commit deterministic proof evidence. Run its focused runner, format/lint,
   the smallest typecheck, and `git diff --check`. Record exact commands and
   results in an acceptance manifest.

## Accept

Run exactly one fresh stateless Claude Opus review at medium effort only after
all deterministic gates pass. Invoke the repository wrapper:

```sh
bun run review:accept -- \
  --manifest path/to/acceptance-manifest.json \
  --authority path/to/relevant-authority.md \
  --diff-base <exact-parent-commit> \
  --output path/to/review.json
```

Add one `--authority` for each required authority document. The wrapper checks
all paths, a clean exact head, manifest consistency, secret-like material,
packet order, timeout/transport/empty output, and an explicit `PASS` or
`BLOCKED` verdict. It fixes model `opus`, effort `medium`, stateless mode, and
no tools. Exploratory Claude runs are evidence only and never satisfy this
gate.

For `BLOCKED`, repair and commit a new clean head, rerun every affected gate,
and run one replacement fresh review. Record raw findings, exact reviewed head,
model, effort, and verdict. Project authority only after `PASS`.
