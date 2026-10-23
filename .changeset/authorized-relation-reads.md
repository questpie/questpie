---
"questpie": minor
---

Caller-authored relation predicates now apply the target collection's read access before testing `some`, `none`, `every`, `is`, or `isNot`; many-to-many predicates also apply junction access. An unreadable target behaves as an empty set, including in parent counts. Trusted server-authored access predicates and system-mode reads retain their existing behavior. Policies receive the concrete target predicate for each read; decisions are not cached across predicates.

Upgrade note: parent reads that previously inferred hidden related rows can now return different results and totals. Review relation filters in user-facing reads. Filters added by beforeRead hooks receive the same treatment; put trusted authorization predicates in the collection's read rule. Localized relation predicates now resolve against the target's translations with locale fallback rather than an outer table's column.

For hasMany and manyToMany hydration, limit and offset now apply per parent after target authorization and filtering, rather than once across the entire parent batch. For example, two parents with limit: 1 can each receive one readable child. Bounded many-to-many results honor orderBy with a target-id tie breaker; unbounded junction ordering is unchanged. Non-negative integer bounds, including digit strings from query parameters, are accepted; malformed bounds return BAD_REQUEST. No schema migration is required.
