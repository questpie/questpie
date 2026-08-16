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

Run the closed acceptance protocol only after all deterministic gates pass.
Protocol v2 first requests one fresh stateless Claude Opus review at medium
effort. A valid primary verdict is final. Only primary `NO_RESULT` activates
the fixed pair of fresh stateless GPT-5.6-sol medium Spec and Standards reviews.
Invoke the repository wrapper:

```sh
bun run review:accept -- \
  --manifest path/to/acceptance-manifest.json
```

The v2 manifest owns the exact diff base, output path, proof heads, ordered
authority paths and SHA-256 digests, PASS-only verification, and acceptance
criteria. The wrapper checks a clean exact head, ancestry, packet order,
secret-like material, timeout/transport/empty output, exact reviewer profiles,
tool-free JSON events, request/digest binding, and explicit verdicts. Callers
cannot select a model, effort, provider, axis, prompt, or authority file.

Primary `PASS` or `BLOCKED` is final. After primary `NO_RESULT`, both
contingency axes must `PASS`; either `BLOCKED` blocks and any invalid or
unavailable axis is no result. Exploratory reviews never satisfy this gate.
Commit the resulting record and verify it without model credentials:

```sh
bun run review:accept:verify -- --record path/to/review.json
```

For `BLOCKED`, preserve the record, repair and commit a new clean head, rerun
every affected gate, and run one replacement fresh round. Record raw findings,
exact reviewed head, model, effort, packet digest, invocation identities, and
verdict. Project authority only after `PASS` and deterministic record
verification.
