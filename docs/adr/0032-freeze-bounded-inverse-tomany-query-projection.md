# ADR 0032: Freeze bounded inverse `toMany` Query projection

- Status: Proposed
- Date: 2026-08-30

## Context

ADR-0008 accepts an explicit non-owning
`relation.toMany({ inverseOf: relationRef(...) })` in the Data Contract but
defers projecting that Relation as child arrays. It also describes structural
Query selection as one-hop even though the shipped compiler accepts four
resolved `toOne` edges and rejects a fifth with `QP-DATA-022`. The deferred
projection needs exact authoring, Policy, cost, result, observation, and
failure semantics before applications can depend on it.

An inverse Relation Definition deliberately carries only the owning `toOne`
identity. It does not import the source Collection Definition or its Fields.
Consequently an inline object under the inverse member cannot obtain exact
child Field types from ordinary TypeScript alone. An ambient application
registry, a generated authoring import, or a Relation-declaration redesign
would recover those types but would violate leaf-local authoring or reopen an
accepted decision.

Team Support Desk supplies the first useful tracer: a ticket detail needs its
first fifty newest comments and currently performs a second paged Query plus
browser mapping. Collaboration supplies the hostile authority and Live Query
consumer. Neither application needs independent continuation of several child
lists, aggregates, quantifiers, synthetic many-to-many, or a polymorphic
Relation.

## Decision

### Authoring and type ownership

A source Collection's existing `list` authoring member gains a structurally
disjoint child-selection overload:

```ts
select: {
  id: true,
  comments: comments.list({
    first: 50,
    where: ({ row }) => row.visibility.equal("public"),
    orderBy: { createdAt: "desc", id: "desc" },
    select: { id: true, body: true, createdAt: true },
  }),
}
```

This `list` form is not an Operation, Query Resource, database Relation,
cursor, or runtime call. It is a child-Collection-owned structural selection value. Its
brand carries the exact source Collection identity and its result carries the
exact readonly child-row type. The parent inverse member accepts only a list
whose source identity matches the Collection encoded by its accepted
`inverseOf`; the compiler then resolves and verifies the complete owning
Relation identity.

The overloads are intentionally distinguishable without contextual guessing.
Root `collection.list({ parameters, where, orderBy, select, page })` has
`parameters` and `page` and types `first` as `never`; nested
`collection.list({ first, where?, orderBy, select })` has `first` and types the
root members as `never`. Generated types and the compiler reject a mixed shape,
including one passed through a variable. Reusing the Collection's list verb keeps
the public model small while the branded return value preserves exact inverse
source and child-row inference.

The nested list grammar is closed:

- `first` is a required positive integer literal from 1 through 50;
- `select` is required, non-empty, and exact;
- `orderBy` is required, non-empty, and child-total; its ordered suffix must
  exactly match one declared child primary-key or unique Constraint whose
  participating Fields are non-null;
- every child order Field must also be selected directly and must be
  unconditionally visible under selected-output Field Policy; a missing or
  conditionally visible order Field is `QP-DATA-008 orderFieldNotSelected`, so
  the Query is unavailable rather than leaking relative order;
- `where` is optional and uses the existing structural scalar Query expression
  grammar over the child row;
- child `toOne` selections may continue within the shared Relation-depth
  ceiling;
- a template may contain at most one projected inverse list in total; and
- another projected `toMany`, child cursor, child `pageInfo`, aggregate,
  quantifier, offset, backward page, implicit order, or hidden tie-breaker is
  invalid.

`where` controls only which authorized children enter the returned array. It
never changes whether the parent row belongs to the root result. An absent,
empty, fully Policy-hidden, or fully filtered child set returns `[]`. A child
list never returns `null`.

The four-edge `QP-DATA-022` ceiling counts every selected or filtered Relation
edge, including the inverse edge. The fifth edge fails at the authored Origin.
This decision ratifies the already shipped four-edge ceiling and does not
permit arbitrary recursion.

### Canonical artifacts and generated contract

Data Query Template v1 remains byte-for-byte readable, including already
emitted recursive `toOne` selections within the shipped four-edge ceiling; its
bytes and digests are never reinterpreted. The compiler continues to emit v1
for every `toOne`-only selection graph and emits Data Query Template v2 only
when the graph contains a projected inverse list. No existing v1 artifact
requires regeneration. The v2 template adds the canonical root member
`maximumRelationEdges: 4`. Its inverse selection node contains the output key, resolved
inverse Relation identity, source Collection identity, literal `first`,
normalized child filter, ordered child terms, and recursive child selection.
Its canonical digest binds the root ceiling and all of those inverse-node facts.

A compilation containing any v2 template emits Query Projection v2 and
PostgreSQL Query Plans v2; each entry names its template version and digest.
The v2 PostgreSQL entry also binds the exact statement bytes, ordered bind
parameters, result descriptors and nullability, compiler-owned ordinal
columns, child/root Policy Program digest, and a domain-separated statement
digest. The public `after` input remains an opaque cursor validated against its
template and scope; the plan binds only its decoded total-order tuple (the root
`id` boundary in this tracer) to PostgreSQL. Readiness recomputes those
bindings before the statement can run; the
PostgreSQL 17 tracer executes the same bound statement export used by the
linked direct, network, and watch proof.
The Runtime Build and App Contract bind those exact artifacts and the Runtime
refuses an unknown version, a v1/v2 digest mismatch, an unresolved inverse, a
forged result ordinal, or a result column outside the linked plan before
disclosure. A compilation containing only `toOne` traversal retains the
unchanged v1 projection and plans.

The Data Contract and Schema Projection do not change: the inverse Relation is
already present in the Data Contract and owns no PostgreSQL object. Operation
Wire does not gain a new frame or error grammar. The generated App Contract
projects the selected member as an exact `readonly Child[]`. A child Field with
conditional selected-output Policy is optional in `Child`, exactly as at the
root and under `toOne`; denial omits the property and never substitutes `null`.
Direct and network callers decode the same result codec.

The compiler reports `QP-DATA-026 invalidInverseList` with Origin and an
exact diagnostic class for a wrong source, invalid `first`, empty or unknown
selection, non-total order, a second plural list, a nested cursor, or an
unsupported child expression. `QP-DATA-022` remains the depth failure.

| Outcome                                                        | Exact boundary | Public behavior                                                                        |
| -------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `QP-DATA-022 relationDepthExceeded`                            | compile        | Fatal diagnostic with exact path and Origin; shorten or split the projection.          |
| `QP-DATA-026 invalidInverseList`                               | compile        | Fatal classed diagnostic with exact path and Origin; no artifact is emitted.           |
| `QP-DATA-008 orderFieldNotSelected`                            | compile        | Fatal diagnostic when a child order Field is not directly and unconditionally visible. |
| unknown version, digest mismatch, unresolved inverse, bad plan | readiness      | Runtime refuses readiness and serves no work; details remain internal.                 |
| forged result ordinal, disclosure guard, or result value       | execute/decode | Sanitized `INTERNAL`; no application or PostgreSQL detail reaches the caller.          |
| `QP-DATA-012` invalid root runtime bound                       | bind           | Whole-call `executionLimitExceeded`; SQL is not dispatched.                            |
| `QP-DATA-012` row, dependency, or semantic-byte excess         | execute/decode | Whole-call `executionLimitExceeded`; no partial result.                                |
| cancellation before dispatch                                   | bind           | `CANCELLED`; SQL is not dispatched.                                                    |
| cancellation while PostgreSQL runs                             | execute        | The statement is cancelled and snapshot rolled back; no partial result.                |
| deadline while PostgreSQL runs                                 | execute        | `DEADLINE_EXCEEDED`; statement and snapshot close; no partial result.                  |

### PostgreSQL, Policy, and nondisclosure

One structural Query still lowers to exactly one PostgreSQL statement in the
existing relational kernel. The statement first establishes the authorized,
filtered, ordered root page and its `first + 1` sentinel. For each root row,
one `LEFT JOIN LATERAL` applies, in order:

1. the exact inverse key correlation;
2. the child Collection's current read admission and row Policy;
3. the authored child filter;
4. the authored total child order; and
5. the literal child limit.

The Runtime groups the flattened rows by compiler-owned root and child
ordinals through the existing relational decoder, derives `hasNextPage` from
distinct root ordinals, and discards the complete sentinel group. No JSON
aggregation subkernel, per-parent statement, or parallel CRUD/query kernel is
introduced.

Child row Policy runs before ordering and limit, so hidden rows neither occupy
a visible slot nor reveal their existence. Existing selected-output Field
Policy applies to each visible child after row authorization. Child order
Fields are a stricter boundary: each is directly selected and unconditionally
visible, or compilation fails with `QP-DATA-008` before an artifact is emitted.
A missing or denied target Policy fails compilation or readiness exactly as for `toOne`;
PostgreSQL constraint names, SQL text, row counts, Policy evidence, and hidden
child identities never enter a public failure.

### Bounds, transaction, cancellation, and retry

The root page remains capped at 100 and a child list at 50, so one statement
materializes at most 5,050 flattened root-child positions including the root
sentinel group. A parent with no child consumes one returned root position, not
a synthetic child. This decision does not invent a general 10,000-row Query
ceiling; that budget belongs to bounded Mutation lifecycle capability work.
The 1,048,576-byte Operation result ceiling and Live Query limit of 256
dependency tokens remain unchanged. The Runtime rejects a result exceeding the
5,050-position structural bound with `QP-DATA-012 executionLimitExceeded` and
returns no partial application data. The byte bound
is terminal over the decoded semantic result; the design does not claim that
PostgreSQL materializes no intermediate bytes beyond it.

The statement joins the same read-only repeatable-read Query snapshot and
inherits its deadline and cancellation signal. Cancellation before dispatch
does no database work; cancellation or deadline during execution cancels the
statement and closes the snapshot. No partial root or child array is exposed.

QUESTPIE does not automatically retry the Query handler or statement. A caller
may issue a new call after a pre-result cancellation or failure. A Live Query
recomputation is a new authorized snapshot under the accepted Change Ledger
contract, not a retry of the prior statement.

### Live Query and observability

Dependency compilation recursively visits the complete selection graph. It
records the inverse Relation identity, source child Collection, child Policy
and reached Policy evidence, correlation endpoint, empty-result miss, authored
filter, ordering boundary, root page sentinel, and child list boundary. A committed child
insert, update, delete, correlation move, or Policy-fact change that can alter
the authorized list makes the watch dirty. Recompute replaces the complete
dependency set as before.

Direct execution, Fetch, the generated client, and watched recomputation use
the same linked plan and decoder. Operational observations may report the
template identity, selected Relation identities, bounded work, cancellation,
limit class, and recomputation reason. They do not expose child values,
protected Fields, hidden cardinality, Policy evidence, SQL, or PostgreSQL
detail.

## Consequences

- Ticket detail can own its bounded comments payload and delete a second Query,
  request, mapper, and Promise leg without gaining cursor-connection ceremony.
- Child inference stays local to the child Collection; the inverse Relation
  declaration remains literal and cycle-free.
- The single-list restriction prevents Cartesian plural products in the
  first implementation and has an explicit later extension point.
- Independent child continuation remains an ordinary child Query. A future
  nested connection needs its own consumer and proof.
- True polymorphic Relations remain deferred. A discriminated value recipe or
  future `codec.variant` does not weaken referential integrity by pretending an
  unchecked `(kind, id)` pair is a Relation.

## Supersession ledger

This decision supersedes ADR-0008's fixed one-hop structural selection clause,
its deferral of projected `toMany` arrays, and the workbench section 15 claim
that the data-diagnostic registry ends at `QP-DATA-014`. The replacement keeps
the existing v1 codes and explicitly registers the already-shipped
`QP-DATA-022 relationDepthExceeded` plus
`QP-DATA-026 invalidInverseList`. It also establishes a shared maximum of four
Relation edges plus the one bounded inverse-list grammar above. Codes
`QP-DATA-015` through `QP-DATA-021` and `QP-DATA-023` through `QP-DATA-025` are
not implicitly registered by this decision.

It preserves ADR-0008's Relation declaration, Data Contract, Schema
Projection, exact selection, filter, total-order, cursor, Policy-scope, and
one-statement ownership. It preserves ADR-0010 Policy and nondisclosure,
ADR-0011 Query snapshot and Operation ownership, ADR-0012 Live Query and Change
Ledger semantics, ADR-0014 generated client and Runtime ownership, ADR-0019's
shared relational kernel, and ADR-0027's tracer-led delivery rule.

No clause accepts aggregates, quantifiers, synthetic many-to-many,
polymorphic Relations, arbitrary recursive depth, nested cursors, React,
client dot projection, OpenAPI/MCP projection, or a second relational kernel.

## Rejected alternatives

- Inline inverse objects whose child types require an ambient registry or
  generated authoring contract.
- Changing the accepted inverse Relation declaration to import the source
  Collection Definition.
- A cursor connection for each parent before a consumer needs independent
  continuation.
- JSON aggregation or N+1 child statements as a second relational decoder.
- Hidden ordering, unbounded child arrays, or applying child filters to parent
  membership.
- Calling an unchecked polymorphic `(kind, id)` association a Relation.
