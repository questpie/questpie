---
"questpie": major
---

**BREAKING: removes the last of `questpie`'s deprecated API.** Internal use of
deprecated symbols in the package is now zero.

Removed:

- the no-argument `job()` overload, marked "@deprecated TApp generic removed".
  Nothing called it — all four job definitions use `job({ … })`, which is
  unchanged.
- `QuestpieConfig.searchConfig`, and the four types that existed only to
  describe it: `SearchConfig`, `SearchStrategy`, `BM25Config` and
  `EmbeddingsConfig`. The field was accepted by the type and read by nothing;
  configure search through `search: { adapter }`.

`extractAppServices` is **not** removed — it is retagged `@internal`. Its
`@deprecated` said "remains for internal framework use but should not be called
directly in user code", which is what `@internal` means and what this codebase
already uses in 45 other places. Nothing replaces it and the framework calls it
in nine places on purpose; the wrong tag was making those reads look like debt.
