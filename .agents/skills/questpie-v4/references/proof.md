# Proof construction and acceptance

Use this branch only for a focused Kernel claim or an exceptional release
semantic boundary as classified by `docs/v4/DELIVERY-FLOW.md`. Ordinary Product
and tracer work follows the implementation branch and does not create proof
heads, acceptance manifests, or model-review records.

## Construct

1. Read the ticket's Accepted ADR inputs and only linked evidence. Read the
   historical `docs/v4/research/framework-api-atlas/PROOF-MAP.md` only when the
   claim depends on an accepted proof recorded there. Inspect every worktree
   before editing; create a dedicated clean proof worktree and leave accepted
   proof worktrees unchanged.
2. Make the smallest executable proof that can falsify the proposed invariant.
   Include hostile and negative cases, exact artifacts/digests, relevant
   PostgreSQL and TypeScript measurements, and relocation/isolation checks.
3. Use two working days as the default construction budget. At the boundary,
   shrink, split, or defer an unresolved claim. Never waive evidence or stop a
   deterministic PostgreSQL, load, or soak run required by the narrowed claim.
4. Commit deterministic proof evidence. Run its focused runner, format/lint,
   the smallest typecheck, and `git diff --check`. Record exact commands and
   results in an acceptance manifest.

## Accept

Run exactly one fresh stateless Claude Opus review at medium effort only when
the proof accepts a new or superseding public Kernel/architecture ADR, or an
exceptional release semantic boundary whose consistency deterministic gates
cannot settle. Run it only after every deterministic gate passes. Invoke only
the pinned manifest-driven repository wrapper:

```sh
bun run review:accept:v2 -- --manifest path/to/acceptance-manifest.json
```

The committed manifest owns the diff base, output path, proof heads,
ordered authority paths with SHA-256 digests, PASS-only gates, and criteria, so
a caller selects no model, effort, provider, axis, prompt, or authority file.
Every packet byte is read from the exact reviewed commit rather than the working
tree, and the diff pins prefixes, renames, algorithm, context, an empty order
file and an empty attributes file so no local Git configuration can reshape it.

The reviewer proves itself before the packet is sent: the pinned executable must
report a version and declare every pinned option. An absent or
argument-rejecting reviewer is a fail-closed error rather than a review outcome.
A reviewer that could have answered and did not is a terminal `NO_RESULT` that
writes no artifact and carries a bounded secret-scanned diagnostic. There is one
reviewer and one verdict; no fallback transport exists.

The manifest hashes are generated packet-integrity bindings, not a manually
maintained documentation digest table. Retain them. Runtime semantic and
integrity digests are also outside the documentation-diet rule and remain
governed by their product contracts.

Commit the resulting record and verify it without model credentials. CI verifies
accepted records through this credential-free command:

```sh
bun run review:accept:verify -- --record path/to/review.json
```

For `BLOCKED`, repair and commit a new clean head, rerun every affected gate,
and run one replacement fresh review. Record raw findings, exact reviewed head,
model, effort, and verdict. Project authority only after `PASS`.
