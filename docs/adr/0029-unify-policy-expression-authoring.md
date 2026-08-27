# ADR 0029: Unify Policy expression authoring

- Status: Accepted
- Date: 2026-08-28

## Context

ADR-0010 accepted relational Policy with boolean-only evidence reads and one
normalized program for artifacts and SQL lowering. Its public spelling splits
that program between `policy.exists(...)`, `policy.rows(...)`, Field operands,
and `query.and(...)`. The split suggests separate authorization and query
languages even though both already use one relational AST.

QUESTPIE needs one readable expression vocabulary without turning Policy into
ordinary TypeScript execution or allowing a Query filter to inspect hidden
authorization evidence.

## Decision

QUESTPIE exposes one capability-branded `expr` vocabulary from `"questpie"`.

- `expr.and(...)`, `expr.or(...)`, `expr.not(...)`, `expr.always()`, and
  `expr.never()` compose boolean expressions. Field operands retain their typed
  comparison methods, including `equal`, `in`, and `isNull`.
- These values use one normalized relational AST and one canonical serializer,
  dependency model, artifact projection, and SQL lowering. Query and Policy
  callbacks receive different branded capabilities over that kernel; sharing
  the kernel does not make every node legal in every callback.
- `expr.exists(collection, predicate)` is available only while authoring a
  Policy program. It is the ADR-0010 bounded, correlated, boolean-only Policy
  Evidence Read under a clearer spelling. It cannot appear in a Query filter,
  return an evidence row, or grant disclosure authority.
- `policy.authenticated()`, `policy.public()`, and
  `policy.rows(collection, callback)` remain Policy-specific constructors.
  Admission and reusable Collection-bound row predicates are authorization
  concepts, not generic boolean operators.
- Policy callbacks remain closed structural programs. Use ordinary TypeScript
  for author-time composition, named functions, branching that returns one
  supported expression, and value preparation. Runtime per-row branching,
  arbitrary I/O, database calls, Service calls, raw SQL, and values the compiler
  cannot lower remain invalid inside Policy.
- The existing Query-only `query` expression surface is retained temporarily
  while the separately approved S7 Query-authoring migration is implemented.
  It lowers to the same AST. This decision makes no permanent alias promise and
  does not admit `query.*` inside newly authored Policy examples.
- The compiler rejects `expr.exists` outside a Policy program before artifact
  emission. The diagnostic is `QP-DATA-025 unsupportedExpressionCapability` and
  identifies the invalid Origin.

This decision supersedes only the public `policy.exists(...)` spelling in
ADR-0010 and the implication in ADR-0019 that separate `query` and Policy
expression namespaces are permanent. Every other Policy guarantee remains
unchanged.

## Preserved authorization guarantees

- Policy remains the sole authored authorization model across direct, network,
  nested, recompute, Route-transition, worker, and Studio execution.
- An evidence read returns one boolean and does not recursively apply the
  evidence Collection's disclosure Policy. Returning a row or Relation still
  applies every source and target disclosure Policy.
- The compiler records every evidence Collection, Field, correlation, and
  mutable dependency. Recompute and post-lock rechecks retain those
  dependencies.
- Framework SQL intersects Policy row scope before operation predicates,
  caller filters, key lookup, counts, ordering, cursor boundaries, sentinels,
  locks, Relation disclosure, selection, and output.
- Missing and Policy-invisible rows and references retain the same
  nondisclosing outcomes. Constraint, validation, cursor, and error precedence
  cannot reveal protected existence.
- Policy decides authority only. It never supplies, rewrites, masks, or silently
  discards a value and never becomes PostgreSQL RLS.

## Consequences

- Policy reads as one expression program instead of alternating between
  `policy.*` and `query.*` boolean operators.
- Query and Policy reuse one compiler kernel while their branded capabilities
  make invalid combinations unrepresentable or compile-fatal.
- Reusable Policy predicates keep explicit operands and Collection binding.
  They cannot capture an unrelated outer row alias and smuggle it across a use
  site.
- `expr.never()` gives Field Policy an explicit fail-closed expression without
  adding another Policy helper.
- Removing the retained Query-only `query` surface belongs to S7 and requires
  its own migration, fixtures, diagnostics, and generated-artifact proof.

## Rejected alternatives

- Keep `policy.exists` beside `query.and` and explain the split only in prose.
- Expose `expr.exists` to Query filters, where it could confuse Policy evidence
  with disclosure-authorized relational filtering.
- Replace the structural AST with arbitrary async TypeScript callbacks or
  JavaScript post-filtering.
- Add permanent aliases for both `policy.exists` and `expr.exists`.
- Move admission or reusable row-predicate ownership out of `policy`.
