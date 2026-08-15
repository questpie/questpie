# ADR 0008: Freeze the foundational data and structural Query contract

- Status: Accepted
- Date: 2026-08-12

## Context

ADR 0006 fixed the transactional schema artifact protocol, but its scalar
baseline did not close nested data, deterministic text cursors, bounded list
parameters, regular Collection keys, or the generated Data contract. Deferring
those choices would let runtime implementation choose artifact bytes and public
types indirectly.

Nested data also has incompatible ownership models. Inline columns need full
Field capabilities, embedded JSONB needs bounded value codecs, and normalized
entities need independent identity and lifecycle. Treating them as one generic
object would hide those differences or synthesize database Resources that the
author did not declare.

## Decision

The foundational v1 contract is the exact contract in
`docs/v4/data-model-and-query-grammar.md` and the reopened unreleased Schema
Projection in `docs/v4/schema-lifecycle.md`.

- Every regular Collection has exactly one named primary-key Constraint. `id`
  remains an ordinary Field. A keyless or externally managed read model needs a
  separate future contract.
- `shape.inline` groups ordinary column Fields. `field.object` and
  `field.array` store closed bounded `value.*` codecs in one JSONB column.
  `field.json` stores tagged open JSON. An entity with identity, Relations,
  independent Policy, unbounded cardinality, pagination, or its own lifecycle
  is an explicit Collection. The compiler never synthesizes a hidden
  Collection.
- Canonical Field paths are non-empty segment arrays. Dotted strings are never
  parsed as paths. Embedded JSONB properties have codecs but no Field identity
  and are not structural Query targets in v1.
- SQL `NULL` is distinct from top-level JSON `null` through the tagged open-JSON
  value representation.
- Foundational text semantics use `questpie.binary`, lowered to explicit
  PostgreSQL collation `C`. Query templates and cursors have no environment
  order-context digest.
- Structural Query v1 has exact selection, closed filters, explicit total
  ordering, forward cursor pagination, one-hop Relations, and declared
  dependencies. Pages have a hard maximum of 100 rows.
- Bounded runtime scalar-list parameters use canonical-set semantics. Binding
  validates the authored bound before deduplication, rejects null members,
  deduplicates and sorts canonical values, and accepts the empty set. `in([])`
  is false and `notIn([])` is true.
- `createdAt` and `updatedAt` are ordinary timestamp Fields. `default: "now"`
  initializes them; automatically advancing `updatedAt` belongs to the later
  transaction-owned Mutation contract.
- The Compiled Manifest v1 gains the required Data Contract Projection without
  changing its version because no Manifest Digest or deployed v1 reader exists.

## Consequences

- Schema, Data Contract, Query Template, scope, cursor, dependency, Package
  contract, and generated App Contract bytes share one closed source model.
- Inline leaves remain independently constrainable and queryable. Embedded
  values remain bounded and typed without pretending to be normalized rows.
- Locale-sensitive text order, JSON interior queries, whole-JSON equality,
  projected `toMany`, aggregates, backward or offset pagination, and native
  statements require focused later contracts.
- Policy-equivalent cursor scope, Mutation authority, transaction ownership,
  and observed Live Query state remain later verticals and cannot reinterpret
  these bytes silently.

## Revision: explicit Field binding for authored checks

The initially accepted one-phase check signature
`constraint.check(({ fields }) => fields.endsAt.greaterThan(fields.startsAt))`
is superseded before beta.1 by the explicit sibling-Field binding
`constraint.check<typeof appointmentFields>(({ fields }) =>
fields.endsAt.greaterThan(fields.startsAt))`, where the Collection also uses
`fields: appointmentFields`.

TypeScript cannot infer a callback generic from a sibling `fields` property of
the surrounding `defineCollection` call. A broad fallback such as
`Record<string, FieldDefinition>` would make every property possibly absent and
would erase exact missing-Field and incompatible-scalar errors. Extracting the
Fields object and passing `typeof appointmentFields` preserves its literal keys
and scalar kinds without `any`, widening, or a second builder phase.

This is an intentional source incompatibility for the unreleased one-phase
signature. It changes only authored TypeScript: the callback still evaluates
once to the same closed check-expression tree. For an equivalent expression,
the Schema Projection, Migration Plan, generated SQL, Committed Migration,
checksums, and Schema Fingerprint bytes are unchanged, so this signature repair
does not create a migration. The exact authoring form is projected in the
internal and public schema lifecycle pages.

## Rejected alternatives

- Keyless regular Collections.
- A special `field.id()` or `primaryKey: true` Field modifier.
- Database-default or environment-versioned foundational text ordering.
- Unbounded list parameters or order-sensitive membership operands.
- Dotted path strings.
- One nested-object abstraction that mixes columns, JSONB, and normalized
  entities.
- Hidden mini-Collections synthesized from nested declarations.
- Whole-JSON or JSON-interior Query operators without a closed operand and path
  protocol.
