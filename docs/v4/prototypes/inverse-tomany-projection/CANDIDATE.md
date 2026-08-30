# Bounded inverse `toMany` candidate

Status: Proposed proof candidate; not Accepted authority

## Authority delta

The candidate preserves the accepted inverse Relation declaration, Data
Contract, Schema Projection, Policy, Query snapshot, generated client, Live
Query, and one-statement relational-kernel ownership. It proposes only:

1. Data Query Template v2 with the already shipped maximum of four Relation
   edges, while existing recursive-`toOne` v1 bytes remain readable and the
   compiler keeps emitting v1 for `toOne`-only graphs; and
2. one child-owned, literal-bounded inverse list per Query.

The exact supersession is ADR-0008's one-hop clause and projected-`toMany`
deferral. No other Accepted ADR clause changes.

## KISS result

Executable TypeScript evidence rejects inline and generated two-stage
authoring. Nested `comments.list(...)` is exact because the child Collection
already owns the needed Field and Relation types. Its literal-`first` shape is
disjoint from the root `list` overload with `parameters` and `page`. A private
source-identity brand lets the parent inverse reject a list from another
Collection.

The first slice deliberately limits `first` to a literal 1–50 and permits one
plural list in the whole template. Team Support Desk needs exactly fifty;
no current consumer earns nested cursors, several plural products, aggregates,
or quantifiers.

## Executable proof

- `authoring-types.test.ts` proves exact readonly-array output and rejects the
  wrong source Collection, parent Fields in child selection/order, nonliteral
  bounds, zero, fractions, and 51.
- `postgres/proof-kernel.test.ts` runs one PostgreSQL 17 statement and proves
  inverse correlation, child Policy before limit, payload-only filtering,
  deterministic total order, Field omission, empty arrays, root sentinel
  grouping, a read-only repeatable-read snapshot, row/byte failures, hostile
  ordinals, in-flight cancellation, deadline rollback, and connection reuse.
- `live-query/dependencies.test.ts` proves recursive selection traversal reaches
  the inverse Relation, child Collection, nested Relation, child and nested
  Policies, Policy evidence Collections, tenant fact, empty miss, ordering,
  root page, and child-list boundaries. It also proves change-fact matching and
  atomic dependency replacement only after a successful recomputation.
- `artifacts/v2.test.ts` binds canonical Template v2, Query Projection v2,
  the complete root filter/order/page contract, exact SQL and parameter/result
  descriptors, opaque-cursor-to-decoded-order binding, Policy and statement
  digests, App Contract optionality, and
  Runtime Build digest. It preserves both one-hop and recursive-`toOne` v1
  vectors and refuses forged linkage at readiness.
- `parity/executor.test.ts` proves direct, serialized generated-client, and
  watched entry paths use one linked artifact and decoder, including normalized
  limit, cancellation, and hostile-row failures.

Production implementation remains blocked until a fresh manifest-bound formal
acceptance returns PASS. After PASS, authority projection and implementation
are separate coherent commits.

## Deletion tracer

Team Support Desk adds `tickets.comments`. Its existing nullable-object
`tickets.detail` contract remains stable: the handler runs a Collection-owned
`tickets.list` plan containing a fifty-comment child list and unwraps its first
node. `notification.sendTicketSummary` keeps its existing
`ctx.queries.tickets.detail` call. It ignores the bounded comments member; that
small extra read is explicit and preferable to inventing an always-generated
`get` surface or adding an unrelated named Query in this slice.

The slice then deletes `src/comments/queries.ts`,
`src/comments/query-plan.ts`, the legacy `ticketDetailPlan`, the browser
`CommentPage` alias, `DetailState.comments`, the second comments Promise leg,
the `comments` panel prop, every `.nodes` access for comments, and stale Support
Desk design prose. The relation-binding unit test moves its nested-author
disclosure assertion to `tickets.detail`.

Type-negative generated-contract evidence proves
`queries["comments.page"]` is absent. PostgreSQL assertions prove exact order,
empty `[]`, nested-author Policy, and hidden-child behavior. Firefox refreshes
after adding a comment and asserts that the body returned by `tickets.detail`
is rendered; echoing the Mutation input is insufficient. Collaboration then
proves cross-tenant child nondisclosure, conditional Field output, ordering
changes, Policy revocation, and dependency replacement.

## Explicit absence

This candidate does not accept polymorphic Relations, synthetic many-to-many,
aggregates, counts, parent-membership quantifiers, child cursors, arbitrary
recursion, React, client dot projection, OpenAPI/MCP projection, or a second
query kernel.
