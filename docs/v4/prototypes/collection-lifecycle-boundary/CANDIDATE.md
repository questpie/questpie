# Collection lifecycle acceptance candidate

This directory stages ADR-0031 for formal acceptance. It is not current product
authority and authorizes no production implementation.

- `check.ts` is the deterministic executable boundary proof.
- `authority-projection.json` preserves the exact authority and public-doc
  projection proposed at candidate commit `d28df9c2d` as lossless Git-diff
  lines relative to its parent `a2ea015d0`. It is review evidence, not a patch
  to apply blindly.
- `acceptance-manifest.json` binds the fresh candidate head, authority inputs,
  deterministic gates, and acceptance criteria.
- `REVIEW.json` must not exist until the pinned protocol-v2 reviewer returns
  `PASS` or `BLOCKED` for the fresh committed candidate.

The review attempted at `d28df9c2d` returned terminal `NO_RESULT: transport`
and intentionally wrote no record. That exact head is not retried. No live ADR
index, specification, glossary, public guide, or handoff text projects ADR-0031
until a committed `PASS` record verifies successfully.

After `PASS`, one separate authority-projection commit changes the ADR status
to `Accepted`, projects the reviewed result into the ADR index, SPEC, CONTEXT,
contract docs, public guide, and HANDOFF, and reruns their affected gates.
