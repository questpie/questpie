# Acceptance determinism decision

## Problem

The accepted acceptance gate is one fresh stateless Claude Opus-medium review
over a packet the wrapper assembles at call time. The verdict it produces is
trusted, but what it read is not pinned. `claude-acceptance-review.ts` takes the
authority set from command-line flags, builds the diff with default Git
settings, and writes a record that nothing can re-derive. Two honest operators
can therefore hand the same commit to the reviewer and get different packets,
and a committed record cannot be checked without re-running a model.

That is not hypothetical. The diff was reorderable through `diff.orderFile`,
attributable through `core.attributesFile` and `info/attributes`, and shaped by
whatever `diff.*` settings the operator's own Git configuration carried.

## Decision

Keep exactly one reviewer and one verdict. Add determinism, safety, and
credential-free verification around it.

A committed manifest owns the exact diff base, output path, proof heads, ordered
authority paths with SHA-256 digests, PASS-only deterministic gates, and
acceptance criteria. Callers select nothing: no model, effort, provider, axis,
prompt, or authority file.

The packet is built from one exact clean commit. Every byte comes from
`git show <head>:<path>`, never the working tree. Authority digests must match.
The diff pins `core.quotePath`, prefixes, rename detection, algorithm, context
and inter-hunk context, an empty order file, an empty attributes file, and
`GIT_ATTR_SOURCE`, and refuses to run when Git administrative attributes are
present. Authority, manifest, diff, and record are scanned for secret-like
material.

The primary transport proves itself before the packet is sent: the pinned
executable must report a version and declare every pinned option in its own
help output. A reviewer that is absent or rejects an argument is a fail-closed
error, not a review outcome, because such an invocation could never have
produced a verdict. A reviewer that could have answered and did not is
`NO_RESULT`, which is terminal here and writes no artifact, carrying a bounded
secret-scanned diagnostic so its provenance is auditable.

The record binds ticket, manifest path, reviewed head, diff base, packet digest,
sanitized primary disposition, verdict, and timestamp. `verify-acceptance-review.ts`
re-derives the packet from the reviewed commit and validates the committed
record with no model credentials, so CI can check acceptance evidence.

## Ownership

- `acceptance-review-packet.ts` owns canonical packet construction.
- `acceptance-packet-secrets.ts` owns prohibited-material detection.
- `acceptance-review-safety.ts` owns clean-tree, output-path, and committed-byte
  preconditions.
- `claude-acceptance-primary.ts` owns the pinned transport, its fail-closed
  availability proof, and no-result classification.
- `acceptance-review-record.ts` owns record validation.
- `acceptance-review.ts` orchestrates one review.
- `verify-acceptance-review.ts` is the credential-free CI seam.

These are repository-quality internals. They create no production provider
interface and no public QUESTPIE API.

## Deliberately excluded

No second provider, no fallback transport, no provider registry, no
caller-selectable model or effort, and no model-selection seam. A `NO_RESULT`
fails closed and is retried by a human deciding to retry.

This slice is the determinism and safety half of the earlier P22R1 proof on
`proof/v4-acceptance-v2`, which also proposed a provider-contingent fallback and
its ADR. That branch is preserved as evidence and is not proposed for merge. The
fallback existed because the Claude transport was unavailable; it is available
again, and BETA-07 was accepted through four rounds on it, so the contingency is
deferred until an outage makes it necessary rather than shipped speculatively
alongside a security-sensitive rewrite.
