# QUESTPIE v4 handoff

## Objective

Continue the docs-first design of QUESTPIE v4. Produce a complete concept v1,
a proof-driven roadmap, and then implement the smallest Barbershop tracer that
can falsify the architecture.

## Workspace

- Worktree: `/Users/drepkovsky/questpie/repos/questpie-v4`
- Branch: `feat/v4`
- State: documentation-only clean slate
- Package manager: Bun 1.3.13

Do not use the v3 worktree as the implementation target. V3 is evidence only.

## Read in this order

1. `SPEC.md`
2. `CONTEXT.md`
3. `docs/adr/README.md`, then ADR-0006 and ADR-0007
4. `docs/v4/implementation-gates.md`
5. The relevant sections of `docs/v4/schema-lifecycle.md` and
   `docs/v4/definition-composition.md`

Load `docs/v4/product-area-matrix.md`, `docs/v4/v3-evidence-map.md`, and
research notes only when a concrete question needs them.

## Current state

`SPEC.md` owns product direction, exclusions, and tracer order. `CONTEXT.md`
owns framework language. Do not restate either model in this handoff.

Two verticals are accepted and projected into public documentation:

- schema, migrations, Drift, and Seeds: `docs/v4/schema-lifecycle.md`, ADR-0006,
  public `schema-lifecycle.mdx`, [GitHub map #261](https://github.com/questpie/questpie/issues/261);
- Definition discovery and composition: `docs/v4/definition-composition.md`,
  ADR-0007, public `definition-composition.mdx`,
  [GitHub map #276](https://github.com/questpie/questpie/issues/276).

Both maps are future queues. No child task is `ready-for-agent` until all
tracer-critical concept gates close.

## Next grilling session

Define the remaining Field, Collection, Relation, Constraint, and structural
data-Query grammar before writing runtime code. ADR-0006 and
`docs/v4/schema-lifecycle.md` already freeze the PostgreSQL-facing schema
artifact v1 subset. This grill must preserve that subset or explicitly supersede
ADR-0006 with a new artifact version.

- complete Definition Contracts, runtime values, row shapes, and generated App
  Contract types for the accepted schema subset;
- explicit classification of additional Field and Relation capabilities,
  including polymorphic Relations, without silently adding them to schema
  artifact v1;
- Collection behavior above the accepted keys, Indexes, Constraints, Relation
  cardinality, ownership, and referential actions;
- one typed structural query grammar with projection, filtering, ordering,
  pagination, Relation traversal, and declared dependency semantics;
- Definition and member contract bytes with golden fixtures consumed by the
  accepted Package Inventory and Compiled Manifest;
- escape hatches that remain explicit and capability-scoped without exposing
  ORM implementation types.

Do not introduce Policy evaluation, Auth, mutation execution, transport,
environment, storage, workflow, or Studio syntax while grilling this slice.
Map their required boundaries, but leave their exact APIs to their own
verticals.

## Next session flow

1. Load the files in **Read in this order** and create
   `docs/v4/data-model-and-query-grammar.md`. This step is complete when the
   workbench names its authority, scope, and the accepted schema artifact v1
   baseline.
2. Record a capability matrix for Fields, Collections, Constraints, Relations,
   and structural data Queries. Mark each entry `accepted baseline`, `v1`,
   `escape hatch`, `deferred`, or `rejected`. This step is complete when no
   proposed capability silently changes schema artifact v1.
3. Grill one question first: can one closed Query model express selection,
   filtering, ordering, pagination, and Relation traversal with canonical bytes
   and explicit dependency semantics? Use Claude Opus for candidate design and
   adversarial review. This step is complete when the workbench has one minimal
   candidate and a hostile-case matrix.
4. Prove the semantic model on a throwaway `feat/v4-query-grammar-proof` branch.
   Build one self-contained logic prototype at
   `docs/v4/prototypes/query-grammar-proof.html` with free-play controls, guided
   hostile cases, and visible normalized Query plus dependency state. Commit
   the prototype only on that branch and record its commit and verdict in the
   workbench. This step is complete when the proof answers the question or
   falsifies the candidate.
5. If the semantic proof survives, create a separate minimal Bun TypeScript
   fixture for exact row, selection, and Relation inference plus compiler
   instantiation measurements. Keep it outside production packages. This step
   is complete when the candidate passes the agreed type assertions and budget,
   or the workbench records why it failed.
6. Fold only validated decisions into the workbench, `CONTEXT.md`, and an ADR
   when the decision is durable and expensive to reverse. Project accepted
   behavior into public docs, run the three Opus documentation reviews, and
   publish a blocked GitHub implementation map. The vertical is complete only
   when the completion conditions below pass; implementation tasks remain
   without `ready-for-agent` until all tracer-critical concept gates close.

## Method for every remaining grill

Map one tracer-critical vertical through the complete layer stack:

```text
authoring API → discovery/compiler → canonical artifacts → PostgreSQL/Runtime
→ protocol and CLI → generated client → Studio/operations
```

At each layer, record only constraints that affect this vertical. Classify each
capability as `v1`, `escape hatch`, `deferred`, or `rejected`. An escape hatch
must state which guarantees it preserves and loses; it cannot bypass stored
migration, Policy, or receipt history.

Use a throwaway proof when a risky semantic or TypeScript choice can be tested
before acceptance. A proof answers one question, does not define public API,
and does not authorize production implementation. The Barbershop tracer and
its gates remain canonical in `SPEC.md` and `docs/v4/implementation-gates.md`.

## Completion condition for the next task

The next task is complete when the remaining Field, Collection, Relation,
Constraint, and structural data-Query grammar has:

- a user-facing specification with exact TypeScript and generated-output
  examples;
- closed canonical Definition and member payloads with digestible golden bytes;
- preservation of the accepted PostgreSQL lowering and round-trip matrix, with
  every proposed addition classified explicitly;
- explicit Relation, referential-action, query-dependency, and pagination
  semantics;
- capability classifications and bounded escape hatches;
- `CONTEXT.md` or ADR changes only when a term or durable decision changes;
- an adversarial matrix, implementation gates, and a tracer task graph;
- no unresolved choice that would change semantic identity, Compiled Manifest
  bytes, Schema Projection bytes, or generated App Contract types;
- no public ORM types, implicit query behavior, or generic bypass flag.
