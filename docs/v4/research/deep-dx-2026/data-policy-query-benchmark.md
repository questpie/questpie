# Data, Collection, Policy, and Query DX benchmark

- Date: 2026-08-26
- Status: research evidence, not product authority
- Scope: application-facing CRUD, lifecycle, Policy, and read-model jobs
- Constraint: this report records transferable principles and approval
  questions. It deliberately does not choose a final QUESTPIE interface.

## QUESTPIE baseline that the redesign must preserve

The current contract is unusually demanding because the same compiled model
must serve application ergonomics and security/correctness guarantees:

- one Collection owns Fields, Relations, constraints, migration identity, and
  its compiled Policy;
- Policy is the sole authored authorization model and is intersected before
  filters, counts, cursor boundaries, ordering, locks, and disclosure;
- a Policy evidence read returns only a boolean, does not disclose its target
  row, and does not recursively apply the target Collection's presentation
  Policy;
- missing and Policy-invisible rows are indistinguishable;
- Query owns one bounded consistent read snapshot;
- Mutation owns one transaction, current-row lock/recheck, candidate Policy,
  database constraints, result receipt, and durable acceptance;
- caller-supplied Fields and trusted server-derived assignments require
  different authority even though Policy must inspect the final candidate;
- structural plans remain compiler-readable values, while named Query and
  Mutation Resources own network/direct contracts;
- cursor bytes bind the structural template, parameters, and the Policy facts
  actually reached by execution.

These are Accepted constraints, not inconveniences to erase. See
[ADR-0008](../../../adr/0008-freeze-the-foundational-data-and-structural-query-contract.md),
[ADR-0010](../../../adr/0010-freeze-trusted-context-and-relational-policy.md),
and
[ADR-0011](../../../adr/0011-freeze-query-mutation-and-explicit-lifecycle.md).

## Current application evidence

Team Support Desk reveals five concrete problems rather than hypothetical API
preferences:

1. `tickets.list`, `listByStatus`, `listByTeam`, and
   `listByStatusAndTeam` duplicate plans, Operation codecs, output adapters,
   and browser dispatch because bounded optional/list parameters are not
   projected through the current authoring/runtime path.
2. The Ticket Policy repeats active-membership and staff predicates across
   read, create, update-row, update-candidate, and Field decisions.
3. Authors alternate between `query.and`, Field methods, `policy.exists`,
   `policy.rows`, and `policy.authenticated`; the security boundary is real,
   but the namespace split and nesting make it hard to read.
4. A named Mutation's trusted `closedAt` assignment is currently presented to
   Collection update as an ordinary patch, so Policy must grant the human
   caller authority over a Field the client cannot supply.
5. Selection and output codecs are restated around structural plans, including
   timestamp repair functions, even though one compiler owns the plan and the
   generated Operation contract.

The detailed evidence and honest line estimates live in
[Team Support DX Evidence](../../implementation/team-support-desk/DX-EVIDENCE.md).

## Comparative findings

### Drizzle: local relational shape and callback-scoped names

Drizzle's relational query API keeps nested selection, nested filtering,
ordering, and relation loading in one local object. It infers nested result
types, supports partial selections, and deliberately supplies aliased columns
through callbacks so nested/self-referential scopes remain correct. Its docs
also state that a relational read is emitted as one SQL statement.
[Drizzle relational queries](https://orm.drizzle.team/docs/rqb)

Worth borrowing:

- one visually local read shape for fields, relations, nested filters, and
  nested ordering;
- callback-provided, scope-correct operands instead of imported global table
  references;
- output inference directly from the selected shape;
- relation vocabulary that makes to-one/to-many navigation discoverable.

Do not copy:

- `RAW` SQL, generic SQL functions, or arbitrary subqueries: they would bypass
  QUESTPIE's closed compiler, dependency observation, Policy, cursor scope, and
  type budget;
- ambiguous include/exclude selection rules (Drizzle ignores exclusions when
  positive selections coexist); QUESTPIE diagnostics must reject an ambiguous
  contract;
- unbounded nested relation loading and offset pagination. QUESTPIE must own
  deterministic total order, bounded pages, Policy-aware cursors, and
  dependency limits.

### Kysely: one composable expression algebra

Kysely exposes a context-typed `ExpressionBuilder`; expressions compose in
`where`, `select`, `having`, joins, ordering, and helpers. The callback limits
autocomplete to tables visible in the current scope. Its official recipe also
shows `and`, `or`, `not`, `exists`, and subqueries as members of one algebra,
and separate guidance shows immutable conditional query construction.
[Kysely expressions](https://kysely.dev/docs/recipes/expressions),
[conditional filters](https://kysely.dev/docs/examples/where/conditional-where-calls)

Worth borrowing:

- one small boolean-expression vocabulary rather than unrelated `query` and
  `policy` grab bags;
- contextual scope supplied by a callback, with reusable expressions that do
  not assume more Collections than their declared scope;
- first-class `true`, `false`, `and`, `or`, `not`, and existential operations;
- immutable composition for optional filters.

Do not copy:

- a general SQL expression or subquery type. QUESTPIE needs a closed normalized
  AST with Resource identities, dependency facts, bounded correlation, and
  deterministic bytes;
- dynamic builder mutation as the public structural-plan model. A QUESTPIE
  plan must be statically inspectable and have stable cursor/watch identity;
- a global database type or table-name strings. The generated App Contract is
  the exact source, and public declarations cannot expose an ORM database
  generic.

The central design lesson is not to move `policy.exists` into `query`. It is to
share one expression kernel while projecting a narrower Policy evidence
capability that can only produce a boolean and can never disclose rows.

### Prisma: discoverability and relation quantifiers

Prisma makes routine reads discoverable through generated model methods,
object-shaped filters, nested `select`/`include`, and relation quantifiers such
as `some`, `every`, and `none`. Result types follow the selected shape. It also
documents both offset and cursor pagination tradeoffs explicitly.
[Prisma filtering](https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting),
[relation queries](https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries),
[pagination](https://www.prisma.io/docs/orm/v6/prisma-client/queries/pagination)

Worth borrowing:

- autocomplete starts from the domain noun, not a separate planner manual;
- nested selection and nested relation filters read as the requested result;
- `some`/`none`/`every` communicate relation intent better than handwritten
  correlated parenthesis trees;
- generated input/result types are named and ordinary application objects are
  easy to pass between modules.

Do not copy:

- an always-available generic CRUD client. QUESTPIE's public client surface is
  named Operations; internal Collection CRUD must remain Policy-aware without
  becoming automatically public;
- unrestricted nested writes. Cross-Collection invariants belong to a named
  Mutation with one explicit transaction and durable boundary;
- offset pagination as a default, implicit result-size breadth, or provider-
  dependent filter semantics;
- conflating a relation filter with relation disclosure. A row may prove a
  boolean Policy fact without being readable as application data.

### Ecto: caller changes, trusted changes, and database truth

Ecto Changesets distinguish `cast/4` for external parameters from `change/2`
for trusted application values. Validations run before database constraints;
the docs warn that pre-query uniqueness validation is unsafe while database
constraints preserve integrity. Associations can use opinionated helpers, but
Ecto directs complex cross-schema work to explicit `Ecto.Multi`, whose named
operations are inspectable and transactionally composed.
[Ecto Changeset](https://ecto.hexdocs.pm/Ecto.Changeset.html),
[Ecto Multi](https://ecto.hexdocs.pm/Ecto.Multi.html)

Worth borrowing:

- provenance is part of the write model: external/caller input is not the same
  authority as application-derived change;
- a changeset-like value can make current row, sparse supplied input,
  normalized values, trusted assignments, candidate, errors, and constraints
  independently inspectable;
- simple Collection changes and complex named transactions have different
  interfaces while preserving the same database authority;
- database constraints remain the race-safe truth and surface as typed errors.

Do not copy:

- runtime callback pipelines whose order or side effects the compiler cannot
  prove;
- allowing trusted application code to skip candidate Policy merely because a
  value used a trusted assignment path;
- association casting that silently owns cross-Collection lifecycle;
- arbitrary transaction functions or a raw repository handle in Mutation.

Ecto supplies the strongest precedent for solving the `closedAt` mismatch:
track provenance separately through candidate construction, then authorize the
complete candidate. It does not imply any particular QUESTPIE spelling.

### Cedar and OpenFGA: fail closed, name domain relations, test decisions

Cedar separates required principal/action/resource scope from optional
conditions, uses implicit deny when no permit matches, lets explicit deny
override permits, and validates policies against a typed schema. Its schema
also supports reusable common types. OpenFGA models domain-specific relations,
supports intersections and typed conditions, and recommends modelling the
application domain rather than a generic meta-model. Its guide treats example
relationship tuples and authorization assertions as part of model design.
[Cedar policy construction](https://docs.cedarpolicy.com/policies/syntax-policy.html),
[Cedar schema](https://docs.cedarpolicy.com/schema/schema.html),
[OpenFGA concepts](https://openfga.dev/docs/concepts),
[OpenFGA design principles](https://openfga.dev/docs/best-practices/modeling-design-principles)

Worth borrowing:

- denial is the structural default; omission must not accidentally broaden
  access;
- authorization predicates should be named in application language
  (`activeMember`, `staff`, `requester`) and independently testable;
- schema/type validation and negative authorization assertions belong in the
  compiler/test experience, not only runtime tests;
- relational facts and request-time attributes have explicit origins and
  precedence.

Do not copy:

- a second authorization store or remote authorization round-trip. QUESTPIE
  Policy must observe current PostgreSQL facts in the owning Query snapshot or
  Mutation transaction;
- a free-standing action/resource policy language that duplicates Operation,
  Collection, Field, Context, and candidate semantics;
- returning graph/evidence details to callers. Policy evidence remains
  boolean-only and nondisclosing;
- generic user-defined policy extensibility before ownership, SQL pushdown,
  dependency observation, and diagnostic bounds are proven.

## Cross-library principles worth carrying into design

1. **One kernel, capability-scoped projections.** Query filtering, Policy row
   scope, candidate checks, and evidence should share normalized scalar and
   boolean nodes, but each scope exposes only legal operands and results.
2. **Locality beats namespaces.** Callback scopes should provide fields,
   relations, parameters, boolean combinators, and the exact evidence
   capability needed at that location; authors should not memorize which
   global namespace owns `and` versus `exists`.
3. **Provenance survives normalization.** Caller input, schema default,
   trusted assignment, and current stored value must remain distinguishable
   until Field authority and final candidate Policy have both run.
4. **Relations express intent.** To-one navigation and to-many quantifiers can
   reduce correlated boilerplate, but evidence, returned relation data, counts,
   and nested pages remain distinct projections with distinct disclosure.
5. **Composition must preserve static identity.** Optional filters and reusable
   fragments are valuable only if the compiler can derive one deterministic
   plan, parameter codec, cursor scope, watch dependency set, and diagnostic
   Origin.
6. **The common path should be generated, not ambient.** Internal CRUD can
   exist for every Collection while only named Query/Mutation Resources enter
   the public client and contract projections.
7. **Errors teach the model.** Invalid relation depth, unbounded list input,
   unsupported correlation, mixed selection modes, provenance escalation, and
   recursive evidence need Origin-bound compile diagnostics.

## Traps specific to QUESTPIE

- A beautiful generic filter object can still be wrong if Policy is applied
  after pagination or if a nested relation has a different disclosure policy.
- Reusable Policy fragments can accidentally capture one Collection alias,
  Principal fact, or Tenant fact and become invalid in another scope.
- Conditional plan construction can produce multiple cursor identities or
  incomplete watch dependencies unless normalized choices are part of the
  compiled parameter contract.
- Relation quantifiers can hide unbounded fanout, recursive Policy graphs, or
  `every` vacuous-truth surprises; each requires explicit semantics and limits.
- Automatic CRUD becomes an authorization bypass if “internally available” is
  confused with “network exposed” or if named Mutations can write outside the
  Collection kernel.
- Lifecycle convenience becomes hooks again if arbitrary async callbacks can
  query, mutate, call Services, or emit effects in a compiler-labelled phase.
- Output inference is unsafe unless the compiler can materialize and validate
  the runtime codec; a TypeScript return type is not a wire contract.

## Questions the approval packet must answer

### CRUD kernel and lifecycle

1. Which CRUD capabilities exist for every Collection internally, and how are
   named Operations the only public exposure mechanism?
2. What immutable representation carries caller input, normalized input,
   defaults, trusted assignments, current row, and final candidate?
3. Can trusted assignments bypass caller Field authority while still being
   checked by validation, candidate Policy, and constraints? Who may create
   them?
4. Which lifecycle phases are closed pure programs, which are named Mutation
   application logic, and which are durable post-commit work?
5. How do CAS, row locks, bulk writes, audit writes, and multi-Collection
   invariants compose without a raw transaction handle?

### Expression and Policy model

6. What is the smallest shared boolean algebra, and which capability-scoped
   views are exposed in Query filters, row Policy, candidate Policy, and Field
   decisions?
7. Where do constants, combinators, Field comparisons, relation quantifiers,
   and evidence live so a Policy reads naturally without erasing authority?
8. What is the type and artifact identity of a reusable predicate fragment?
   Which Principal/Tenant/row dependencies may it capture?
9. How does the API visibly distinguish boolean evidence from disclosed
   relation data, counts, and ordinary nested reads?
10. Which evidence correlations and nesting depths are legal, bounded, and
    cycle-free? How are unsupported graphs diagnosed?
11. Can Policy phases reuse a named domain predicate without broadening its
    applicable row/candidate scope or hiding dependency facts?

### Structural Query and generated Operations

12. How can one static plan express optional nullable/list filters without
    four Operation variants or runtime-shaped AST ambiguity?
13. Are selection, nested relations, filters, order, and page one local shape,
    or separately reusable values? How is each choice reflected in result
    inference and Origin diagnostics?
14. Which nested to-one and to-many reads are supported, with what independent
    filter/order/page limits and Policy intersections?
15. How are `some`, `none`, and `every` defined, especially empty-relation
    semantics and Policy-hidden related rows?
16. How does one semantic Query with several `ctx.data` reads retain one
    read-only repeatable-read snapshot and one observed dependency set?
17. When may a structural plan infer its runtime parameter/output codecs, and
    when must the author pin a codec?
18. Can generated named input/result aliases eliminate application-side
    `Awaited<ReturnType<...>>` without creating a second contract source?

### Diagnostics and acceptance evidence

19. What does autocomplete expose at each callback, and what imports disappear
    from the normal example?
20. What are the hard budgets for relation depth, rows, list parameters,
    dependencies, expression nodes, TypeScript instantiations, and emitted
    declaration size?
21. Which negative fixtures prove no Policy bypass, no disclosure through
    evidence, no provenance escalation, no pagination-before-Policy, and no
    direct/network/worker drift?
22. Against Team Support Desk, which files and handwritten lines disappear,
    and which correctness gains honestly remove zero lines?

## Research conclusion

The strongest direction is architectural, not syntactic: preserve one deep
relational kernel, project it through strictly smaller capabilities, and make
the generated application surface feel domain-local. Kysely demonstrates why
one scoped expression algebra composes well; Drizzle and Prisma demonstrate
why nested reads should be visible in one local result shape; Ecto demonstrates
why caller and trusted write provenance must remain separate; Cedar/OpenFGA
demonstrate why authorization deserves named, typed, testable domain rules.

The approval packet should compare materially different interfaces against the
22 questions above. This evidence does not justify renaming `policy.exists`,
adding generic relation traversal, or replacing `defineCollectionOperations`
in isolation.
