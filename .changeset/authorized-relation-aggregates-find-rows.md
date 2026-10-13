---
"questpie": minor
---

Authorize hasMany relation aggregates through the target collection and add bounded `findRows`.

- `with: { relation: { _count: true } }` and `_aggregate` on a hasMany relation, from a collection or a global, now run through the target collection's own read pipeline. They honour its read access rule, soft delete, read hooks and the caller's transaction. Previously the aggregate ran as raw SQL and returned counts for rows the caller could not read.
- Value aggregates (`_sum`, `_avg`, `_min`, `_max`) are refused when the field has a read rule (403 for `read: false`, 400 for a dynamic rule) or when an `afterRead` hook could rewrite the value (400). `_count` is not affected by `afterRead`. An aggregate over a non-initial workflow stage returns 400.
- New backend-only `collections.<name>.findRows(options, context)` returns a plain row array without a total `COUNT`. `limit` is required (1–100); `offset` and `groupBy` are rejected. `find` and `findOne` are unchanged.
