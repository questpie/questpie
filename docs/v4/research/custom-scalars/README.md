# Custom scalar and Field extensibility research

- Status: research only; no acceptance authority
- Date: 2026-08-15
- Base: `8eab4aa28c624a277f6967cdb909b61f232dbcef`
- Scope: future scalar/codec and stored-Field extensibility
- Explicit non-scope: BETA-05/#292, production code, public documentation,
  PostgreSQL extension installation, non-B-tree Index authoring, and RLS

## Executive recommendation

QUESTPIE should not restore v3's universal custom-Field facility.

The smallest promising first vertical is a **semantic scalar refinement** over
an already accepted scalar representation. It should be a declarative value,
not a new Resource Kind, registry entry, callback bundle, ORM column, or
runtime plugin. The compiler embeds one normalized scalar contract wherever it
is used; generated types may retain a nominal brand; Runtime decode, encode,
canonicalization, wire validation, Seed validation, and generated declarations
consume that same contract. A semantic scalar gains no database, relational,
cursor, Index, default, or embedded-JSONB capability automatically.

A genuinely new PostgreSQL type is a materially different problem. It needs a
separate, later database-capability decision that owns physical type identity,
extension requirements, binding, result decoding, migration, fingerprint,
drift, operators, ordering, and supported Index contracts. PostGIS geometry or
pgvector cannot honestly be represented by an arbitrary SQL type string plus a
JavaScript validator.

The recommended sequence is therefore:

1. deepen the existing built-in scalar implementation behind one internal
   contract and prove cross-surface parity;
2. prove a semantic branded refinement such as `email` or `ulid` over a
   built-in representation;
3. separately prove whether that refinement earns a stored Field projection;
4. consider an extension-backed PostgreSQL capability only with its own real
   adapter, migration, catalog, performance, and hostile evidence.

The package registry/plugin model should be rejected. It has high apparent
flexibility but a shallow interface: every extension author must understand
compiler evaluation, TypeScript augmentation, code generation, PostgreSQL,
query operators, Runtime decoding, migrations, Studio, and wire compatibility.

## Authority and terminology

The following accepted constraints govern any future decision:

- ADR-0019 requires one scalar/codec kernel behind `codec.*`, database-capable
  `field.*`, and compatible embedded-JSONB `value.*` projections. Operation
  owns no scalar grammar.
- ADR-0008 freezes the current scalar, Field, embedded-value, structural Query,
  cursor, and schema artifact v1 contracts. A new scalar cannot silently enter
  those versioned unions.
- ADR-0007 rejects ambient registries, runtime Module/plugin merge, implicit
  Package activation, public compiler hooks, and import-order ownership.
- ADR-0009 requires compiler-owned static executable pairing and rejects a
  handler registry or stale generated authority.
- ADR-0021 keeps beta.1 bounded. Custom scalars and extension-backed Fields are
  not part of BETA-05 or the current implementation queue.
- PostgreSQL is the only durable adapter in v1. Public Index remains B-tree
  only, and there is no RLS claim.

Three jobs are easy to conflate and must be named separately:

1. **Field contribution**: a Package Augmentation adds an ordinary Field using
   an already accepted `field.*` constructor. This composition job already has
   an accepted owner and does not require scalar extensibility.
2. **Semantic scalar refinement**: an application gives a built-in wire/runtime
   representation a stricter domain meaning, validation contract, and perhaps
   nominal TypeScript brand.
3. **Database-capable scalar**: a new physical PostgreSQL representation and
   its complete schema/query/runtime contract enter the compiler.

Calling all three a “custom Field” would erase the important authority and
compatibility differences.

## Current v4 implementation inventory

The accepted architecture says “one kernel”, but the implementation currently
repeats scalar knowledge across several modules. This is not evidence for a
public extension seam; it is evidence that the private module should be
deepened before extensibility is attempted.

| Concern                            | Current owner/location                                                                                | Duplication or gap                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public codec descriptor            | `packages/questpie/src/field-contract.ts`, `packages/questpie/src/index.ts`                           | `CodecKind` has only boolean/integer/object/text/uuid while stored and embedded grammars contain eight scalar kinds. Codec options also omit the bounds carried by Field/value descriptors. |
| Public stored Field constructors   | `packages/questpie/src/index.ts`                                                                      | A separate constructor table builds `FieldDefinition` descriptors for eleven Field variants.                                                                                                |
| Public embedded value constructors | `packages/questpie/src/value.ts`                                                                      | Repeats scalar names, option types, nullability, and TypeScript value mapping independently of `codec` and `field`.                                                                         |
| Compiler normalization             | `packages/compiler/src/schema/field-contract.ts`                                                      | Reimplements text/integer/bigint/numeric rules, embedded recursion, defaults, and the closed kind dispatch.                                                                                 |
| Generated TypeScript               | `packages/compiler/src/generate.ts`, `packages/compiler/src/data/generated-contract.ts`               | Separate kind switches render codec, Field, and embedded value TypeScript; unsupported values can fall through to `never` or broad string-like mappings.                                    |
| Relational discovery/lowering      | `packages/compiler/src/relational/discovery.ts`, `packages/compiler/src/relational/postgres/model.ts` | Reconstructs scalar contracts and PostgreSQL parameter types from Field descriptors with another kind table.                                                                                |
| PostgreSQL schema lowering         | `packages/compiler/src/schema/postgres-ddl.ts`, `packages/compiler/src/schema/postgres-catalog.ts`    | Separate semantic-to-physical and physical-to-fingerprint tables must remain exactly inverse.                                                                                               |
| Seed validation/canonicalization   | `packages/compiler/src/seed/committed-seed.ts`, `packages/compiler/src/seed/json-codec.ts`            | Repeats UUID, time, date, bigint, numeric, text, integer, JSON container, and canonical-byte rules.                                                                                         |
| Context input Runtime decoding     | `packages/runtime/src/execution/context-input.ts`                                                     | Handwritten decoder supports only the smaller boolean/integer/text/uuid/object codec subset. BETA-03 review already identified parity risk here.                                            |
| Query binding/result decoding      | `packages/runtime/src/relational/query.ts`                                                            | Defines another `ScalarCodecV1`, value validator, canonicalizer, timestamp/date parser, and PostgreSQL result conversion.                                                                   |
| Cursor encoding/decoding           | `packages/runtime/src/relational/cursor.ts`                                                           | Defines a parallel scalar union and validator with its own constraints and 2,048-byte envelope logic.                                                                                       |

The duplication is behavioral, not merely textual. A scalar change currently
requires coordinated edits across authoring types, compiler normalization,
artifacts, generated declarations, SQL parameters, PostgreSQL row decoding,
Seeds, Context input, wire input/output, Query scope bytes, and cursors. Missing
one site can create a compatibility or nondisclosure defect rather than a
simple type error.

### Deepening opportunity

Name the conceptual module **Scalar Contract**. Its reason to change is “the
canonical meaning and capability projection of one runtime value kind.” Its
small internal interface should hide:

- descriptor normalization and exact-key validation;
- runtime decode and encode;
- canonical comparable bytes;
- TypeScript value projection;
- allowed Field/value/parameter/result/cursor capabilities;
- PostgreSQL bind/result representation for built-ins;
- validation limits and stable failure classes.

The interface is the test surface. A table-driven conformance fixture should
exercise every accepted built-in through codec, Field, embedded value, Seed,
wire, PostgreSQL bind/result, Query parameter, selected result, and cursor
surfaces. Tests should not call private kind-specific helpers.

The dependencies are:

- canonicalization and TypeScript projection: in-process;
- PostgreSQL lowering and catalog verification: local-substitutable through the
  existing real PostgreSQL test lane;
- generated contract emission: in-process compiler work;
- Package composition: in-process compiler input, not a runtime adapter.

No new external seam is earned. PostgreSQL is the one durable adapter, and the
current fake SQL objects used by focused tests are test stand-ins rather than a
second database adapter.

The exact package topology remains an open implementation decision. Two viable
placements require measurement:

- a private scalar domain consumed by compiler and Runtime through emitted
  normalized contracts; or
- a private shared implementation workspace bundled into the single published
  `questpie` package.

Adding pass-through `scalar.ts` files independently to compiler and Runtime
would fail the deletion test: deleting them would merely move the same kind
switches back into callers.

## V3 behavioral evidence

V3 commit `11617485` proves that users value custom semantic and stored Field
jobs:

- `fieldType(name, { create, methods })` let a Package define a named Field and
  type-specific fluent methods;
- built-in `email` and `url` Fields showed the common semantic-refinement job:
  string storage plus stronger validation and editor affordances;
- `f.from(column, schema)` exposed the important but much more dangerous
  extension-backed job, including a documented PostGIS example;
- generated `f.<name>` factories made application authoring convenient;
- Admin could choose a renderer from Field metadata.

Those jobs are positive evidence. The mechanism is negative evidence:

- `FieldTypeRegistry` used ambient global augmentation and fell back to broad
  `string` when empty;
- convention directories and codegen plugins formed registries whose behavior
  depended on scanning and merged plugin contributions;
- `fieldType` combined ORM column construction, Zod validation, query operators,
  fluent builder methods, Admin metadata, and runtime state in one shallow
  extension interface;
- Proxy wrapping and repeated `any` preserved chain methods at the cost of
  exact static guarantees;
- `f.from` accepted an arbitrary Drizzle column or factory, defaulted missing
  validation to `unknown`, assigned generic operators, and allowed an arbitrary
  type-name string;
- a Package plugin could add discovery rules, builder methods, callbacks,
  transforms, and whole generated files, recreating a public compiler framework.

V4 should preserve “define an email/ULID once and reuse its exact type” and
“support a proven PostgreSQL extension-backed value eventually”. It should not
preserve “arbitrary callbacks and registries gain every scalar capability”.

## Competing interface models

The sketches below are deliberately non-authoritative. They make the required
interface facts concrete enough to compare depth, locality, and seam placement.

### Model A — semantic branded refinement over a built-in carrier

Illustrative shape:

```ts
const email = scalar.semantic({
	name: "email",
	representation: codec.text({ maxLength: 254 }),
	rules: [scalar.rule.format("email")],
});

const input = codec.semantic(email);
const stored = field.semantic(email, { nullable: false });
const embedded = value.semantic(email, { nullable: false });
```

Interface invariants:

- `representation` is one accepted scalar contract, not an arbitrary codec
  callback;
- rules are a closed, canonical, bounded AST and may only refine, never change,
  the carrier representation;
- decode rejects noncanonical carrier values before semantic validation;
- no I/O, clock, random, database call, normalization callback, or arbitrary
  regular expression runs from the descriptor;
- generated TypeScript branding is nominal only and cannot bypass Runtime
  validation;
- `field.semantic` and `value.semantic` exist only when compilation proves the
  carrier's corresponding projection; neither grants new operators or Indexes.

What the implementation hides:

- canonical descriptor bytes and digest;
- rule validation and bounded evaluation;
- brand emission in app/package/client declarations;
- one decode/encode/canonicalization path across Context, Operations, durable
  payloads, Channels, Seeds, Query bindings, and results;
- migration comparison for a stored refinement and named check constraints
  where the rule is database-enforceable.

Depth and trade-offs:

- High leverage for email, URL, slug, country code, and perhaps ULID over an
  accepted carrier.
- Smallest interface and no new Resource Kind or adapter seam.
- Cannot express PostGIS, pgvector, custom casts, arbitrary operators, or a new
  physical PostgreSQL type. That limitation is a feature.
- A generic pattern rule is not automatically safe; the first proof should use
  one closed non-regex rule or a compiler-owned bounded pattern grammar.

### Model B — database-capable Scalar Definition

Illustrative shape:

```ts
export const point4326 = defineScalar({
	name: "geo.point4326",
	wire: codec.object({ lat: codec.numeric(), lng: codec.numeric() }),
	postgres: postgresScalar.geometry({ dimensions: 2, srid: 4326 }),
	capabilities: scalar.capabilities({ equality: true }),
});

const location = field.scalar(point4326, { nullable: false });
```

Interface invariants:

- a Scalar Definition has stable identity, Owner, Origin, versioned contract,
  Package Inventory entry, and exact Runtime Build binding;
- `postgres` is a closed compiler-known variant, never a SQL string, Drizzle
  builder, function name, cast, operator callback, or arbitrary DDL;
- each advertised capability has complete lowering, binding, result decoding,
  migration, catalog, drift, hostile, and performance evidence;
- extension presence, type/typmod, schema qualification, supported PostgreSQL
  majors, and upgrade compatibility are explicit;
- relational equality, order, cursor, set, Policy, and Index capabilities are
  independently earned. Equality does not imply order; order does not imply a
  B-tree contract.

What the implementation hides:

- extension/type ownership checks and provider profile;
- physical type and typmod normalization;
- binary/text parameter and result representation;
- schema projection, Migration Plan, Committed Migration, fingerprint, and
  drift mappings;
- exact query/operator and generated type projections;
- deployment compatibility and old Runtime Build retirement.

Depth and trade-offs:

- Potentially deep for a real extension vertical because it concentrates a
  large proof behind one scalar reference.
- Much larger authority change: it adds a Resource Kind or equivalent
  compiler-owned identity and extends several versioned artifacts.
- A universal `postgresScalar.custom(...)` would be shallow and unsafe. The
  first accepted variant must be concrete, such as one ULID representation or
  one 2D PostGIS point contract.
- It cannot enter beta.1 and must not smuggle non-B-tree Index or native SQL
  authority through Field authoring.

### Model C — Package registry/plugin

Illustrative shape:

```ts
export default defineQuestpiePlugin({
	scalars: {
		point: {
			codec: pointCodec,
			column: (name) => geometry(name, { srid: 4326 }),
			operators: pointOperators,
			renderType: "Point",
		},
	},
});
```

The interface appears flexible because a Package can inject validators,
columns, operators, generated types, and runtime code. Its implementation is
thin: it forwards extension-owned behavior into every compiler and Runtime
phase. Callers must understand the entire system, so leverage and locality are
poor.

It conflicts with accepted v4 direction:

- generic compiler/plugin interface;
- runtime or build-time registry;
- executable callbacks in structural compilation;
- Package installation or order affecting semantics;
- ORM and provider types in normal Definitions;
- ambient generated registry/type augmentation;
- a provider matrix and parallel scalar kernels;
- tests reaching plugin internals instead of one caller seam.

Recommendation: reject this model, including disguised variants named
`registerScalar`, `scalarProvider`, `fieldAdapter`, or config `plugins`.

## Comparison

| Criterion             | Model A: semantic refinement              | Model B: database Definition                     | Model C: registry/plugin                         |
| --------------------- | ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Interface size        | Small                                     | Medium if concrete; enormous if generic          | Enormous despite compact object syntax           |
| Depth                 | High for semantic values                  | High only for one fully proven database vertical | Low; complexity leaks to extension authors       |
| Locality              | Scalar Contract module                    | Scalar Contract plus schema/PostgreSQL domains   | Distributed across every compiler/Runtime caller |
| New Resource identity | No                                        | Yes or an equally strong compiler identity       | Ambient registry key                             |
| Arbitrary code        | No                                        | No in the authored contract                      | Yes                                              |
| New PostgreSQL type   | No                                        | Yes, explicitly                                  | Yes, implicitly                                  |
| Package behavior      | Ordinary explicit value import            | Activated Package Definition and inventory       | Plugin discovery/merge                           |
| Generated type safety | Prove nominal brand and exact carrier     | Prove exact named type and codec                 | Usually relies on augmentation/casts             |
| Fits current beta.1   | No public surface; internal deepening can | No                                               | No                                               |
| Recommendation        | Prove first                               | Research later per concrete type                 | Reject                                           |

## Recommended module and seam placement

The preferred conceptual structure is:

```text
public restricted projections
  codec.*       field.*       value.*
        \          |          /
         normalized Scalar Contract
           /        |        \
  generated types  runtime codec  schema/query capabilities
                                      |
                              PostgreSQL lowering/catalog
```

The **Scalar Contract** module has one conceptual interface even if compiler
and Runtime consume different emitted projections. The compiler owns
normalization and capability derivation. The Runtime consumes immutable
compiled contracts and never discovers scalar implementations. Schema and
relational domains ask the scalar seam for explicit capabilities instead of
switching on kinds or importing provider callbacks.

PostgreSQL lowering remains below its owning schema or relational domain. A
generic provider directory or public scalar adapter seam is not justified.
When a future concrete extension is accepted, its PostgreSQL implementation is
an internal adapter below the owning domain, not a user-supplied adapter.

## Open authority decisions

These questions require a focused grill and proof before any public syntax:

1. Is semantic scalar refinement a product requirement for 4.0, a later beta,
   or only an internal kernel-hardening concern?
2. Does a semantic scalar have Resource Identity, or are its complete canonical
   bytes embedded by value at each use? How does a Package update change it?
3. Which closed refinement rules exist? Are formats a fixed enum, is there a
   bounded pattern AST, or must the first vertical add one named built-in?
4. Does refinement only validate, or may it normalize? Current canonical
   codecs reject noncanonical values; implicit lowercase/trim would change that
   contract.
5. Is the generated type structurally the carrier (`string`) or nominally
   branded? Where is the brand symbol declared across app/package/client
   isolation?
6. Can one semantic scalar project into codec, Field, and embedded value, or
   must each projection be separately declared and accepted?
7. Which validation rules become named PostgreSQL Constraints so managed and
   external writers cannot bypass them? What happens to rules not expressible
   in schema artifact v1?
8. How do semantic-version changes classify wire, behavior, schema, migration,
   cursor, retained durable payload, and Runtime Build compatibility?
9. Which operators are inherited from a carrier? A domain refinement may need
   equality but should not automatically inherit ordering or string search.
10. Can a refined value enter Query parameters, set canonicalization, total
    order, cursors, Policy evidence, Relation keys, and primary/unique keys?
11. What are the maximum descriptor, validation-program, value, nesting, and
    execution-cost budgets?
12. How do CLI, Studio, OpenAPI, MCP, and generated clients name and explain an
    unsupported or omitted semantic scalar without a second registry?
13. What stable diagnostics distinguish malformed descriptor, invalid value,
    unsupported projection, incompatible Package inventory, schema drift, and
    Runtime Build mismatch?
14. For a new PostgreSQL type, who owns extension installation and upgrade?
    Which provider observations enter compatibility without making versions or
    catalog OIDs canonical identity?
15. What is the first adversarial pair that earns a general database-capability
    interface? One implementation does not justify an adapter seam.

## Hostile matrix for a future proof

| Case                                                          | Required outcome                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Descriptor has unknown/extra member                           | Compile fails with stable Origin diagnostic; no artifact emitted.                                         |
| Same semantic name, different canonical contract              | Collision or Package inventory mismatch; import order cannot choose.                                      |
| Cyclic or over-depth refinement                               | Compile fails within an explicit depth/byte budget.                                                       |
| Nondeterministic callback, clock, random, environment, or I/O | Impossible in the interface or rejected by controlled structural evaluation.                              |
| Malformed wire value                                          | Rejected before Context, Policy, handler, database access, or disclosure.                                 |
| Value valid for carrier but invalid for semantic rule         | Same rejection across direct, Fetch/client, nested, worker, recompute, and Studio paths.                  |
| Generated type brand forged with a cast                       | Runtime validation still rejects invalid bytes; TypeScript branding grants no authority.                  |
| Seed contains invalid/noncanonical value                      | Seed artifact creation fails; no partial artifact or receipt.                                             |
| PostgreSQL returns an invalid value                           | Runtime fails closed before result/event disclosure.                                                      |
| External writer bypasses an application-only rule             | Either database Constraint rejects it or Drift/unsupported guarantee is explicit; no silent safety claim. |
| Query list contains duplicate equivalent encodings            | Validate before deduplication, canonicalize by scalar bytes, enforce authored bound.                      |
| Cursor carries old scalar contract or noncanonical value      | Exact version/template/scope rejection before SQL with nondisclosing recovery.                            |
| Scalar used in unsupported filter/order/Relation/Index        | Compile fails; no fallback operator, runtime post-filter, or raw SQL.                                     |
| Package installed but not activated                           | No scalar capability enters compilation.                                                                  |
| Package activated but inventory digest changed                | Compilation/deployment refuses pending explicit acceptance.                                               |
| Semantic contract changes without physical type change        | Behavior/wire compatibility changes explicitly even if no Migration is needed.                            |
| Physical type/typmod changes                                  | Reviewable Migration Plan and exact Drift comparison; never an implicit cast.                             |
| Required extension missing or incompatible                    | Startup/apply refuses before traffic; provider failure is not an application validation error.            |
| Multi-instance old/new Runtime Builds                         | Separate wire/schema/executable compatibility prevents mixed scalar interpretation.                       |
| Slow or adversarial validation input                          | Bounded cost and size fail as resource limits; no ReDoS or unbounded recursion.                           |
| Secret-bearing or raw invalid value in diagnostics/events     | Redacted closed facts only; no raw payload in the Execution Envelope.                                     |

## Sequenced issue map

This is an investigation map, not an implementation queue. Every item remains
blocked until its predecessor closes and no item changes BETA-05.

### CS-01 — Freeze the scalar conformance inventory

Blocked by: none

Artifacts:

- machine-readable matrix of every current built-in across codec, Field,
  embedded value, Seed, generated type, Query parameter/result, cursor, and
  PostgreSQL representation;
- negative matrix for unsupported cross-projections;
- exact current canonical bytes and diagnostics.

Acceptance: proves current behavior without adding syntax or changing artifact
versions.

### CS-02 — Deepen the private built-in Scalar Contract module

Blocked by: CS-01

Artifacts:

- one internal seam for normalization/capability projection;
- one Runtime codec interpreter over emitted contracts;
- replacement caller-seam tests and deletion of superseded helper-only tests;
- topology and size-ratchet evidence.

Acceptance: all existing bytes remain stable; compiler/Runtime/Seed/cursor
parity and PostgreSQL 16/17/18 pass. This issue still adds no public custom
scalar.

### CS-03 — Grill semantic refinement authority

Blocked by: CS-02

Artifacts:

- one concrete product job, preferably email and ULID as distinct hostile
  cases;
- decisions for identity, closed rule grammar, validation versus normalization,
  brands, Package use, versioning, diagnostics, limits, and projections;
- at least the three interface models from this report compared through exact
  application/package/client examples.

Acceptance: focused decision only; no production implementation.

### CS-04 — Prove codec-only semantic refinement

Blocked by: CS-03

Artifacts:

- executable compiler/runtime/type prototype;
- canonical artifact and generated declaration goldens;
- direct/Fetch/client/worker/recompute parity where applicable;
- complete hostile and performance evidence.

Acceptance: fresh stateless review. Public authority changes only after PASS.

### CS-05 — Decide and prove stored/embedded projections

Blocked by: CS-04

Artifacts:

- explicit `field` and `value` projection decision;
- schema/migration/fingerprint/Seed/Query/cursor contract;
- raw/external-writer and PostgreSQL 16/17/18 evidence;
- exact absence story for unsupported operators and Indexes.

Acceptance: a codec-only scalar does not acquire database capabilities merely
because this issue exists.

### CS-06 — Research one extension-backed PostgreSQL scalar

Blocked by: CS-05

Artifacts:

- primary-source report for one concrete type such as PostGIS 2D point;
- physical type/typmod, extension, migration, catalog, drift, bind/result,
  operator, and provider contract;
- explicit B-tree-only interaction and absence story for spatial/vector Index.

Acceptance: research narrows the next proof; it does not create a generic
adapter.

### CS-07 — Prove the database-capable Definition or reject it

Blocked by: CS-06 and a second materially different concrete scalar candidate

Artifacts:

- two real variants showing whether a shared interface is earned;
- package activation/inventory, Runtime Build, rolling compatibility, managed
  PostgreSQL, migration, drift, hostile, and performance proof;
- comparison against adding each variant as a compiler-owned closed built-in.

Acceptance: if the shared interface is shallower than two closed variants,
reject the general seam and keep compiler-owned variants.

## Stop conditions

Stop and open a new focused authority decision if implementation requires any
of the following:

- arbitrary JavaScript validation/normalization callbacks in structural
  artifacts;
- raw SQL type/default/operator/cast/index strings;
- Drizzle/Kysely/Zod identity in normal public Definitions or declarations;
- ambient TypeScript augmentation or a scalar registry;
- implicit Package activation or runtime plugin discovery;
- automatic inheritance of relational, cursor, Index, or database capabilities;
- a non-B-tree Index or PostgreSQL extension installation claim;
- reinterpretation of existing schema, cursor, wire, Seed, or Runtime Build
  bytes without an explicit artifact version.

## Bottom line

The useful v3 job is domain-specific values with exact types and eventual
PostgreSQL extensibility. The durable v4 answer is not a more polished plugin.
It is a deeper Scalar Contract module with capability-scoped projections.

Prove semantic refinement first because it supplies high leverage through a
small interface and preserves the accepted one-kernel model. Treat a new
physical PostgreSQL scalar as its own schema/query/runtime vertical. Reject the
registry/plugin model because deleting it would spread its complexity back
across every caller—the hallmark of a shallow module.
