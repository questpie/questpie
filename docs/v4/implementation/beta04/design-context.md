# BETA-04 design context

Issue #291 is one bounded vertical: read a stable forward page of Messages
through the current Company/Space/Membership Policy. It extends the BETA-03
execution root; it does not create a second Runtime or a public database
abstraction.

## Fixed decisions

- Policy and Query share one compiler-owned relational program with restricted
  boolean-evidence and row-returning projections. Runtime consumes the compiled
  program and never evaluates a broader row set in JavaScript.
- PostgreSQL executes one parameterized statement in one repeatable-read,
  read-only snapshot. Policy row scope precedes caller filtering, keyed lookup,
  ordering, cursor boundaries, the `first + 1` sentinel, Relation disclosure,
  and selected output.
- Policy evidence is Boolean-only. Returning a Membership row or following a
  Relation applies the target Collection's disclosure Policy; using that same
  row as evidence does not disclose it.
- The issue's count hostile does not add an aggregate API. Generated Query
  capabilities expose no `count`; type evidence and the nondisclosure transcript
  prove there is no count oracle. Page length and `hasNextPage` derive only from
  the authorized `first + 1` base.
- Policy-protected execution emits `DataCursorV2` with the sibling
  `policyScopeDigest` fixed by the ADR-0008 revision. It does not reinterpret a
  v1 cursor. Scope failures use the single versioned
  `QP-DATA-013 cursorScopeMismatch` result before SQL.
- `QP-POLICY-001 missingDefaultPolicy` and
  `QP-POLICY-002 ambiguousDefaultPolicy` are the only accepted Policy diagnostic
  spellings in this slice. Row denial, Relation denial, revocation, role change,
  and forged Tenant facts are nondisclosing outcomes, not diagnostics.
- The happy-path page orders only by directly selected, unconditionally
  disclosed Fields. Conditional omission is proved on a non-order output Field.
  A general diagnostic registry for unlowerable Policy programs or a
  conditionally hidden order Field remains a separate authority decision; this
  slice cannot invent those codes.

## Package ownership

- `questpie/src/relational/` owns only structural authoring and exact types.
- `compiler/src/relational/` owns normalization, validation, projections,
  dependency/explain joins, and PostgreSQL lowering.
- `runtime/src/relational/` owns closed cursor binding and the one PostgreSQL
  Query adapter. The existing execution root supplies trusted Principal,
  resolved Tenant, ordinary Authority, cancellation, and cleanup.
- `questpie` remains the only published package. Compiler and Runtime stay
  private; no provider, contracts, ORM, repository, or test-only package is
  introduced.

## Fixture boundary

The collaboration fixture gains only the Membership facts, stable Message page
Index, verified Context bootstrap, one default Message Policy, one default
Membership disclosure Policy, and one Message page Query needed by this tracer.
Schema changes use a new committed migration and immutable follow-up Seed; the
accepted BETA-02 migration and Seed are not rewritten.

## Explicitly deferred

RLS, raw SQL authoring, aggregate/count APIs, backward or offset pagination,
JSON-interior operators, network/client/direct transport, Mutation ownership,
general Runtime Build validation, and a provider matrix remain outside BETA-04.
