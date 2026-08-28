# Collection lifecycle acceptance candidate

This directory stages ADR-0031 for formal acceptance. It is not current product
authority and authorizes no production implementation.

- `compiler-artifact/compiler.ts` and `compiler.test.ts` are the executable
  TypeScript-lowering, canonical-artifact, hostile-decoding, and interpreter
  proof. They replace the rejected hand-authored instruction model.
- `operation-transaction/proof-kernel.ts` and `check.test.ts` exercise the
  issue-mapping and lifecycle-order boundary against PostgreSQL 17, including
  rollback, nondisclosure, budgets, transaction-stable time, and receipt replay.
- `authority-projection.json` carries a lossless Git diff relative to
  `a2ea015d0`. It starts from the `d28df9c2d` draft and repairs only the blocked
  constraint, evidence-attribution, compatibility-label, ADR-status, and
  HANDOFF staging findings. It is review evidence, not a patch to apply blindly.
- `acceptance-manifest.json` binds the fresh candidate head, authority inputs,
  deterministic gates, and acceptance criteria.
- `REVIEW-CODEX-EXCEPTION-BLOCKED.md` preserves the exact human-authorized
  GPT-5.6-sol high verdict for `c473f9129`.
- `REVIEW-CODEX-EXCEPTION-REPLACEMENT-BLOCKED.md` preserves its exact
  replacement verdict for `2236f3b24`. Both records remain non-authoritative;
  the repairs in this candidate answer only their stated findings.

The pinned review attempted at `d28df9c2d` returned terminal
`NO_RESULT: transport` and intentionally wrote no record. That exact head was
not retried. The authorized substitute reviews of `c473f9129` and `2236f3b24`
returned `BLOCKED`; this fresh candidate is the next finding-only repair. No
live ADR index, specification, glossary, public guide, or handoff text projects
ADR-0031 until a committed `PASS` record exists.

After `PASS`, one separate authority-projection commit changes the ADR status
to `Accepted`, projects the reviewed result into the ADR index, SPEC, CONTEXT,
contract docs, public guide, and HANDOFF, and reruns their affected gates.
