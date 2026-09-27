---
"questpie": minor
---

Normalize passage text and queries for case- and accent-insensitive lexical retrieval while preserving source text and citation offsets. Export versioned search normalization and original-text match ranges from `questpie/shared`.

Add opt-in `typoTolerance: "bounded"` for title passages: at most one adjacent transposition or extra typed letter across up to four query terms, below exact/prefix matches, with authorization and document caps applied before the result limit. Identifier-shaped and short queries are excluded.

Preserve the per-document passage cap after hybrid rank fusion as well as within each retrieval arm.

Passage consumers must generate and apply a schema migration for `normalized_text` and the updated generated `fts` expression, bump their passage profile id, and reindex existing documents. Existing rows retain their original lexical index until reindexed; changing the profile prevents mixing index generations.
