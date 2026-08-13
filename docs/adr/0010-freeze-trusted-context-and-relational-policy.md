# ADR 0010: Freeze trusted Context and relational Policy

- Status: Accepted
- Date: 2026-08-13

## Context

Every execution surface needs the same trusted Principal, Tenant, Authority,
and application values without making transport data authoritative. Context
Resolution must preserve v3's useful once-per-request setup and scoped cleanup
without exposing its raw database, Service, Queue, or implicit-System
capability bag.

Authorization must also follow mutable relational facts. A cached role in
Context cannot prove that a membership is still active inside a Query snapshot,
after a Mutation lock wait, during recomputation, or on a durable attempt. V3
`access` jobs therefore survive, but its transport-dependent and in-memory
mechanisms do not.

## Decision

QUESTPIE has one compiler-owned application Context and one authored Policy
model.

- `defineContext({ input, resolve })` declares transport-neutral input and one
  exact resolved result. A root Execution resolves it once, coalesces concurrent
  consumers, freezes its facts, propagates them to nested work, and disposes
  execution-scoped Services in reverse creation order after success or failure.
- Context failure occurs before Policy or a handler. Resolution receives only
  Principal, decoded input, and bounded read-only `bootstrap.get` by exact
  Collection key and selection. Bootstrap exposes no raw SQL, database,
  all-Collection map, write, Queue, Service, or System capability.
- Generated `client.withContext(input)` creates an immutable client scope.
  Direct roots use `app.execution({ principal, context }, callback)`. Route
  transitions, realtime recomputations, durable attempts, and Studio create
  deliberate fresh roots; nested work inherits the current root.
- Principal, Tenant, Authority, and resolved Context values are immutable
  Execution facts. Ordinary input cannot select Authority. System Authority
  requires an unforgeable trusted Runtime capability and is not an ambient
  Policy bypass.
- `definePolicy(collection, body)` binds one closed typed Policy program to one
  Collection. `policy.exists(collection, predicate)` provides bounded,
  compiler-authored, boolean-only relational evidence with exact nested row
  types. It cannot disclose the evidence row.
- Policy owns operation admission, existing-row scope, sparse supplied caller
  Field authority, selected-output Field omission, current stored row, and
  complete candidate-row authority. It decides and never supplies, rewrites,
  or silently discards a value.
- An evidence read does not recursively apply the target Collection's
  disclosure Policy. Any returned row or Relation does apply the source and
  target disclosure Policies. The compiler records every evidence Collection,
  Field, correlation, and mutable dependency.
- Framework-owned SQL intersects Policy scope before caller filters, counts,
  cursor boundaries, `first + 1` sentinels, ordering, locks, and disclosure.
  JavaScript post-filter fallback is forbidden. One normalized Policy program
  feeds artifacts and SQL lowering.
- Missing and Policy-invisible keyed rows share one nondisclosing result.
  Missing and invisible references share one normalized result. Constraint,
  validation, cursor, and error precedence cannot reveal protected existence.
- After a lock wait, write execution must recheck the current row, mutable
  evidence, and candidate authority inside the owning transaction before it
  writes. P3 owns the transaction and write mechanics.
- Equivalent Execution facts make the same decision for direct, network,
  nested, recompute, Route-transition, worker, and Studio paths. Context
  convenience values never replace current relational Policy evidence.
- Policy is the sole authored product model. P2 accepts Policy-enforced
  framework SQL and emits no PostgreSQL RLS projection or database-enforced
  authorization claim.

## Consequences

- Context input has one exact generated type independent of its wire encoding.
  The resolved return supplies exact generated `tenant` and `values` types.
- Policy callbacks derive exact row and operand types from their Collection
  arguments without an ambient registry, recursive App generic, ORM type, or
  repeated generic.
- Conditional output Fields are omitted, not null-masked. Sparse input checks
  inspect only canonical segment-array paths actually supplied by the caller.
- Policy dependencies include mutable membership role, status, and scope facts;
  P4 must observe them and replace dependency sets on recomputation.
- A future durable-work contract must persist a run-as strategy and create a
  fresh root; it cannot serialize mutable Context or infer authority from worker
  location.
- Broad RLS, maintenance/System surfaces, recursive Policy graphs, advanced
  joins, typed JSON-interior Policy, and concrete Auth Packages remain focused
  later contracts.
- The foundational Index authoring contract remains B-tree-only. P2 adds no
  access method, expression, partial predicate, operator class, native SQL, or
  generic `using` authority.
- P2 does not accept Query snapshots, Mutation transaction ownership, write
  application, validation/Constraint execution, retries, call identity,
  network error bytes, or any production Runtime implementation.

## Rejected alternatives

- A Request-, header-, URL-, worker-payload-, or protocol-specific Context
  Definition.
- Multiple application Context roots, mutable scoped clients, nested Context
  replacement, or serialized resolved Context.
- Raw database, all-Service, Queue, write, or System access during Context
  bootstrap.
- Treating Tenant, cached membership, selected role, missing Request, direct
  execution, Studio, or worker location as authorization or elevation.
- A separate Admin access model, handler-selected Policy, v3 `access`, response
  redaction hooks, or JavaScript row post-filtering.
- Returning relational evidence rows or recursively applying their disclosure
  Policy while computing boolean evidence.
- Distinguishable missing/invisible row errors or leaked database constraint
  detail.
- Authored PostgreSQL RLS as a second Policy language or an unproven derived
  RLS claim.
