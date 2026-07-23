---
"questpie": patch
---

Collection engine hardening: transaction-scoped row locks, CRUD refactor, and a function-preserving deep-merge.

- Add typed transaction-scoped collection row locks for cross-collection invariants.
- Refactor the CRUD builder/generator with grouped-find result typing.
- Replace `structuredClone` in `deepMerge` with a function-preserving `safeClone`, so app configs that hold callbacks (e.g. Better Auth `sendVerificationEmail`) merge without a `DataCloneError`.
