# ADR 0011: Freeze Query, Mutation, and explicit lifecycle

- Status: Accepted
- Date: 2026-08-13

## Context

QUESTPIE needs semantic reads and writes that preserve exact generated types,
relational Policy, PostgreSQL consistency, and the useful jobs of v3 CRUD and
lifecycle hooks. A runtime CRUD dispatcher, raw transaction handle, or general
`before*`/`after*` hook catalogue would split ownership and make transaction,
retry, and durable-work behavior ambiguous.

## Decision

QUESTPIE compiles Query, Mutation, and Collection Operation authoring into
ordinary statically bound Operation Resources.

- `defineQuery` and `defineMutation` come from the Current App Contract in
  `#questpie/app`. Each local exported Definition owns one inline handler,
  exact input and error codecs, inferred or explicitly pinned output, Policy,
  exposure, limits, Origin, and Executable Slot.
- Query receives a generated read-only `ctx.data` and owns one bounded
  consistent read snapshot. It cannot write, dispatch, access a database or raw
  SQL handle, open a transaction, bypass Policy, obtain System Authority, or
  call an external Action through its Context.
- Mutation receives generated Policy-aware reads and writes and owns exactly
  one PostgreSQL transaction. Nested Collection calls, validation, business
  writes, transactional audit writes, result receipt, and typed dispatch intent
  join that transaction. The Context exposes a transaction-stable
  `operationTime`, stable `callId`, cancellation signal, and immutable deadline,
  but no raw transaction handle.
- `defineCollectionOperations(collection, body)` is closed compile-time
  shorthand. Selected `list`, `get`, `create`, `update`, and `delete` members
  lower before Manifest emission to ordinary Query or Mutation Resources with
  their own identity, Owner, Origin, codecs, Policy, limits, observation path,
  snapshot or transaction, and generated alias. The set is not a Resource or a
  runtime dispatcher.
- Caller input is exact and rejects unknown keys. Sparse caller Field authority
  runs before closed pure normalization. Schema defaults and closed server
  `values` then construct the complete candidate before validation, candidate
  Policy, and PostgreSQL Constraints.
- `createdAt` and `updatedAt` remain ordinary Fields. Any server value or
  `updatedAt` change is an explicit Mutation-owned assignment. Policy decides
  authority and never supplies or rewrites a value.
- The fixed Mutation order is decode, admission, consistency boundary, row
  scope and lock, sparse caller Field authority, pure normalization, schema
  defaults, closed server values, complete candidate validation, candidate
  Policy, PostgreSQL Constraints, selection, output authority, output
  validation, commit, and encoding.
- Handler output is inferred only when the compiler can materialize a supported
  closed runtime codec at its Origin. An explicit output pin determines and
  validates the contract, including recursive output, and cannot cast an unsafe
  JavaScript value.
- A Mutation call identity is scoped by application, Tenant, Operation,
  Principal, and `callId`, and is bound to the canonical input digest. The
  transaction stores its result receipt. Exact duplicate delivery and response
  loss replay the stored result without applying the business change twice;
  reuse with changed input fails.
- Cancellation before commit rolls back. Cancellation or response loss after
  commit reports a recoverable committed-result ambiguity and never claims
  rollback. Direct and wire adapters use the same Operation engine and agree on
  results, declared errors, nondisclosure, and transaction outcomes.
- Lifecycle jobs have explicit owners: closed Field normalization, closed
  server values, a named Mutation for cross-Collection invariants and audit, a
  transaction-owned typed dispatch intent for later durable work, and an Action
  for external effects. There is no general hook catalogue.

## Consequences

- Generated server and client contracts contain the exact application
  Collections, Operation inputs, selections, results, errors, and mode-specific
  capabilities without `any`, `unknown`, ORM types, or a whole-App registry.
- A semantic Query can reuse a structural data plan through
  `ctx.data.run(plan, input)`. Structural Query remains a value; semantic Query
  remains a Resource.
- PostgreSQL constraints stay authoritative under races, but raw database
  detail never crosses the public Operation boundary.
- P3 reserves `ctx.dispatch` only as typed transaction-owned intent. P5 owns
  acceptance, delivery, attempts, leases, fencing, retries, and retention.
- P4 owns observed read dependencies, Change Ledger capture, reconciliation,
  watch resume/reset, and realtime delivery. P6 owns production Fetch framing,
  Runtime lifecycle, and Studio.
- The foundational Index authoring surface remains B-tree-only. P3 adds no
  expression, partial, operator-class, native-SQL, raw-SQL, or generic `using`
  authority and makes no PostgreSQL RLS claim.

## Rejected alternatives

- A runtime CRUD dispatcher or separate Admin data backend.
- Per-handler capability maps, raw database or transaction handles, implicit
  System elevation, or Policy bypass.
- Automatic timestamp Fields, hidden update hooks, arbitrary normalizer/value
  callbacks, or a general lifecycle Resource.
- In-memory `afterCommit`, detached promises, external effects inside the
  Mutation transaction, or P3-owned Reaction delivery.
- Treating an output annotation as a cast or silently serializing functions,
  classes, cycles, `Map`, `Set`, broad index signatures, `any`, or `unknown`.
- Claiming rollback after commit, automatic retry without stable call identity,
  or exactly-once external effects.
- Expanding the accepted Index or RLS surface from proof-only PostgreSQL
  measurements.
