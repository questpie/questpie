# Data model and structural Query grammar

- Status: Accepted for the foundational v1 contract
- Date: 2026-08-12
- Authority: workbench for grilling sequence item 3 in `SPEC.md`
- Baseline: ADR-0006, ADR-0007, `docs/v4/schema-lifecycle.md`, and
  `docs/v4/definition-composition.md`

## 1. Purpose and authority

This workbench closes the foundational Field, Collection, Constraint, Relation,
and structural data-Query contract. The first Barbershop application is an
end-to-end acceptance witness, not the capability ceiling of the framework.
It proves one coherent path through the contract; absence from that example is
not a reason to omit a generally necessary data capability.

The accepted scalar schema artifact v1 remains the proven baseline. Revision 6
reopens the unreleased artifact with nested and JSONB-backed Field structure,
deterministic text ordering, and runtime scalar-list parameters. Those additions
change Schema Projection, Data Contract Projection, generated types, Query
Template bytes, diagnostics, lowering, introspection, and drift. They are not
are accepted together with the affected artifact bytes and generated contract
after the section 16 proofs and focused acceptance review.

This workbench does not define Policy evaluation, Principal, Auth, operation
handlers, Mutation execution, transport, environment bindings, storage,
workflow, Change Ledger matching, or Studio syntax. It names the exact data
facts those later verticals receive without choosing their APIs.

The first semantic and TypeScript proofs in section 16 preserved the core
model. The first Opus adversarial review returned `revise` with 15 blockers.
Revision 2 incorporated them; the second review again returned `REVISE` with
15 narrower correctness, authority, naming, and proof-honesty blockers.
Revision 4 incorporated three adversarial repair rounds and received focused
`PASS` for its scalar core. Revision 6 preserves that core, has executable
goldens plus a TypeScript budget proof for the reopened capabilities, and
received a focused Opus-medium acceptance `PASS` on 2026-08-12.

## 2. Accepted baseline that cannot move

The following facts come from accepted authority rather than this grill:

1. A Collection is a `collection` Resource with one explicit Qualified
   Resource Name, Owner, Origin, and closed Definition Contract.
2. Fields, Constraints, Indexes, and Relations are Collection members. Their
   semantic identities do not derive from file, export, Package, or PostgreSQL
   names.
3. The scalar baseline has `uuid`, `text`, `boolean`, `integer`, `bigint`,
   `numeric`, `timestamp`, and `date` Fields. This revision extends the
   unreleased v1 projection with inline leaves plus `object`, `array`, and
   `json` Fields; it does not claim those variants were in the earlier proof.
4. Schema Projection v1 has primary-key, unique, and closed check Constraints;
   B-tree Indexes; and foreign-key-owning `toOne` Relations.
5. A `toOne` Relation references an equal-length primary or unique key and
   owns its PostgreSQL foreign-key Constraint. Its actions are `restrict`,
   `cascade`, `setNull`, or `noAction`.
6. Schema, migration, fingerprint, and Seed artifacts use the exact canonical
   bytes, identities, lowering, checksums, and receipt rules in ADR-0006 and
   `schema-lifecycle.md`.
7. Definitions and accepted Augmentations resolve before runtime. Runtime does
   not discover or merge them.
8. Collection Augmentation v1 adds only Fields, Constraints, and Indexes.
9. Authored Definition types stay Resource-local. Typed references do not
   recursively compute the application. The generated App Contract is the
   exact application-wide type authority.
10. Public declarations contain no Drizzle, Kysely, or other ORM identity and
    no broad `string`, `any`, ambient registry, or fallback discriminant.

This grill adds a non-schema inverse traversal to the Compiled Manifest's Data
Contract Projection. A `dataQuery` is an unbranded structural value, not a
Resource or discovered Definition. It has no Resource Identity, Owner, Origin,
or independent Compiled Manifest entry. It is normalized only when reached from
the structural graph of an evaluated Definition. An unreachable template
produces no artifact bytes, digest, or diagnostic. A reached template and its
module obey the Controlled Structural Evaluator; its type-only `#questpie/app`
import is erased first. The later Query Resource grill owns the branded
Definition and reachability edge, so `questpie build` cannot normalize a
standalone template yet. That Resource can embed one exact template without
changing its bytes. The template, inverse traversal, and Data Contract
Projection never enter the Schema Projection. Revision 6 nested Field
declarations do enter the candidate Schema Projection and therefore can produce
Migration Plan and Committed Migration changes; Query-only structure still
cannot.

### Naming and supersession audit

Every Definition and Relation authoring name in this vertical passes the first
naming audit below. The second audit covers Query, generated-contract,
artifact, and diagnostic names. A new name says which old name it replaces and
whether it supersedes accepted authority or only rejects v3 compatibility.

| Concern                         | Pinned v3 evidence                                                    | Accepted or candidate v4 name                             | Decision boundary                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection Definition factory   | `collection("appointments").fields(...)`                              | `defineCollection({ name: "appointments", fields: ... })` | `defineCollection` is already accepted by schema artifact v1 and ADR-0006. Changing it would supersede the public authoring API, but would not by itself require a new Schema Projection version.   |
| Seed Definition factory         | v3 builder/plugin forms                                               | `defineSeed({ ... })`                                     | Accepted by schema artifact v1.                                                                                                                                                                     |
| Collection Augmentation factory | no v4-equivalent authority                                            | `defineCollectionAugmentation({ ... })`                   | Accepted by ADR-0007 composition.                                                                                                                                                                   |
| Owning Relation                 | v3 `belongsTo` behavior                                               | `relation.toOne({ target, fields, references })`          | Accepted by schema artifact v1; the cardinality name is deliberate.                                                                                                                                 |
| Inverse Relation                | v3 `hasMany` behavior; accepted schema v1 permits only owning `toOne` | `relation.toMany({ inverseOf: relationRef(...) })`        | Candidate non-schema authoring in this grill. It deliberately extends the Collection `relations` map without extending `SchemaProjectionV1`; it avoids ambiguous `source` plus `via` strings.       |
| Structural predicate            | v3 `where` object                                                     | authoring `where`, artifact `filter`                      | `where` is author-facing grammar; `filter` is the closed normalized node. The mapping is explicit and one-way.                                                                                      |
| Structural ordering             | v3 `orderBy`                                                          | authoring `orderBy`, artifact `order`                     | The authoring name stays familiar while the artifact uses a short canonical member.                                                                                                                 |
| Pagination                      | v3 numeric `page` in parts of CRUD                                    | `page: query.forwardCursor(...)`                          | The shared word remains, but v1 accepts only the explicit cursor form.                                                                                                                              |
| Compiled Manifest members       | Accepted v1 has `application`, `composition`, and `schema`            | required `data: DataContractProjectionV1`                 | This anticipated additive member supersedes the closed interface in `definition-composition.md`. `format` and `version: 1` remain because no Manifest Digest exists; v1 readers now require `data`. |

Query and generated-contract naming:

| Concern                         | Pinned v3 evidence                                  | Candidate v4 name                                                                                                             | Decision boundary                                                                                                                                       |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural Query factory        | Collection CRUD/query chains                        | `dataQuery<Collection>()({...})`                                                                                              | New two-stage unbranded template factory; outer type binding preserves inner literal inference and does not replace a `define*` Resource factory.       |
| Relation member reference       | Definition imports and builder references           | `relationRef(collection, relation)`                                                                                           | New literal typed reference used to avoid a circular Definition import; never a broad string lookup.                                                    |
| Query clauses                   | Chained query methods                               | `from`, `parameters`, `select`, `where`, `orderBy`, `page`                                                                    | One closed object grammar. `where`, `orderBy`, and `page` retain familiar words; the rest are new.                                                      |
| Parameter codecs                | Ad hoc handler/query inputs                         | `query.parameter.<codec>()`, `.list(...)`, and `.cursor()`                                                                    | Mirrors accepted scalar Field codec names. Scalar and scalar-list parameters are non-null; cursor is the only nullable parameter.                       |
| Nested declaration              | v3 nested `object` Field                            | `shape.inline({ fields })`, `field.object({ properties })`, `field.array({ items })`, `field.json()`                          | Separates column grouping, typed JSONB values, and open JSON. No form synthesizes a hidden Collection.                                                  |
| Nested Field reference          | Dotted string paths                                 | typed authoring segment tuple; artifact Field identity plus `path`                                                            | Inline leaves are Fields with non-empty paths. Embedded properties are codec members, not Query-addressable Fields. Dotted parser strings are rejected. |
| Boolean and Relation predicates | v3 object operators                                 | `query.and/or/not/always`, Relation `exists/notExists`                                                                        | Full words replace SQL abbreviations and keep boolean child order explicit.                                                                             |
| Scalar operators                | v3/SQL shorthand varied by surface                  | `equal`, `notEqual`, `in`, `notIn`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `isNull`, `isNotNull` | Deliberately rejects `eq`/`ne`/`lt`/`gte` aliases; shared spellings align checks and Queries where semantics overlap.                                   |
| Order direction                 | v3 and accepted Index artifact use `"asc"`/`"desc"` | authoring `.ascending({ nulls })` / `.descending({ nulls })`; artifact `"asc"` / `"desc"`                                     | Fluent methods stay readable; canonical bytes reuse the accepted short artifact spelling.                                                               |
| Generated data root             | v3 database/client-specific generated types         | `AppContract["data"]["collections"]`, alias `AppData`                                                                         | New engine-neutral generated surface fixed here.                                                                                                        |
| Generated Collection shapes     | v3 ORM/CRUD shapes                                  | `row`, `insert`, `update`, `relations`                                                                                        | Concrete plain-TypeScript members. Later Mutation authority may narrow inputs without silently renaming the structural shapes.                          |
| Page result                     | v3 numeric page/list results                        | `nodes`, `pageInfo`, `endCursor`, `hasNextPage`                                                                               | Adopts familiar connection vocabulary without claiming GraphQL Relay compatibility.                                                                     |

Projection and dependency member naming:

| Surface               | Canonical members                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data Field            | `codec`, `nullable`, `hasDefault`                                    | Runtime value codec, null acceptance, and whether insert omission is legal. `hasDefault` records behavior without duplicating the schema default payload.                                                                                                                                                                                                             |
| Data Projection root  | `applicationIdentity`                                                | The semantic identity string distinguishes this member from the accepted Schema Projection's physical application settings and the Manifest's application-name record. The superseded candidate `application` is rejected on this projection.                                                                                                                         |
| Data Relation         | `target`, `fields`, `references`, `inverseOf`                        | `target` always names the traversal target. Canonical projections use a qualified Collection identity; the generated App Contract uses a finite `{ name, identity, fields }` target descriptor. `fields` and `references` retain owning `toOne` key order; `inverseOf` appears only on an inverse `toMany`. The superseded candidate `relatedCollection` is rejected. |
| Page dependency       | `orderFields`, `uniqueConstraint`, `direction`                       | Complete semantic order, the selected total-order witness, and page direction. These are artifact members, not authoring methods.                                                                                                                                                                                                                                     |
| Collection-read roles | `output`, `filter`, `order`, `cursor`, `joinLocal`, `joinReferenced` | Closed reasons why lowering must read a Field. Join-role orientation is defined in section 14.                                                                                                                                                                                                                                                                        |

Canonical and diagnostic naming:

| Family               | Candidate names                                                                                                                                                     | Decision boundary                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Data formats         | `questpie.data-contract-projection`, `questpie.data-query-template`, `questpie.data-query-scope`, `questpie.data-cursor`, `questpie.data-query-dependency-template` | New versioned protocols use the accepted dotted `questpie.<artifact>` pattern.                                                 |
| Runtime binding      | `DataQueryBindingV1`                                                                                                                                                | Runtime-only normalized value, not a standalone canonical artifact; it has no format tag or digest domain.                     |
| Definition contracts | `questpie.collection-definition-contract`, `questpie.collection-augmentation-contract`                                                                              | New closed contracts under ADR-0007 structural-contract hashing, not top-level artifacts.                                      |
| Digest domains       | corresponding lowercase `questpie-...-v1\0` prefixes                                                                                                                | Reuses the accepted hyphenated prefix convention; each prefix maps to one format.                                              |
| Data diagnostics     | `QP-DATA-*`                                                                                                                                                         | New registry for resolved data/query semantics. Discovery remains `QP-COMPOSE-*`; schema-member failures remain `QP-SCHEMA-*`. |

No agent can silently change a name already accepted by ADR-0006, ADR-0007, or
this workbench. A future rename records the superseded API, compatibility
effect, unchanged or versioned artifact bytes, and migration effect separately.

## 3. Capability classification

`accepted baseline` means the capability already exists in schema artifact v1.
`v1` means this grill accepts it above that baseline. `escape hatch` names a
bounded alternate path and its lost guarantees. `deferred` requires another
grill. `rejected` is intentionally unavailable.

### Fields

| Capability                                                                       | Classification    | Contract                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| UUID, text, boolean, integer, bigint, numeric, timestamp, and date schema Fields | accepted baseline | Exact options and PostgreSQL lowering remain in schema artifact v1.                                                         |
| Canonical runtime codec for every accepted Field                                 | v1                | Section 4 fixes accepted input and emitted value forms.                                                                     |
| Exact read, insert, and update row shapes                                        | v1                | Generated from resolved Field nullability and defaults.                                                                     |
| Literal, `randomUuid`, and `now` defaults                                        | accepted baseline | They affect insert optionality but never fabricate a returned value before PostgreSQL returns it.                           |
| Inline column grouping with `shape.inline({ fields })`                           | v1                | A logical path over full Fields; no owning value and no PostgreSQL column of its own.                                       |
| Closed JSONB value objects with `field.object({ properties })`                   | v1                | One JSONB column with a recursively closed `value.*` schema and typed property paths.                                       |
| Closed JSONB value arrays with `field.array({ items, maximumItems })`            | v1                | One bounded JSONB array column; items use `value.*`, have no identity, Relation, Policy, or lifecycle.                      |
| Open JSON with `field.json()`                                                    | v1                | One JSONB column with exact tagged `JsonValue` validation but no typed interior paths.                                      |
| Enum, binary, ranges, generated columns, vectors, and full-text Fields           | deferred          | Each changes schema or runtime value bytes and needs a focused capability proof.                                            |
| Extension-backed Fields such as pgvector or PostGIS geometry                     | deferred          | A focused PostgreSQL capability must add explicit codecs, schema lowering, introspection, drift, and query operators.       |
| Deterministic text ordering under `questpie.binary`                              | v1                | Explicit PostgreSQL `C` collation, verified before execution; no database-default collation may leak into the order.        |
| Locale-sensitive text comparison or implicit case folding                        | rejected          | Foundational v1 has one portable binary text order. Locale-aware ordering requires a named, versioned collation capability. |
| Arbitrary SQL type or public ORM column                                          | rejected          | It bypasses schema projection, codecs, generation, and drift.                                                               |

### Collections and Constraints

| Capability                                                                                                 | Classification    | Contract                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Explicit Collection identity, Fields, primary/unique/check Constraints, B-tree Indexes, and physical names | accepted baseline | No new schema shape.                                                                                       |
| Composite primary and unique keys                                                                          | accepted baseline | Field order is significant and preserved.                                                                  |
| Exactly one primary key on every regular Collection                                                        | v1                | A named `constraint.primaryKey` is mandatory; zero or multiple primary-key Constraints are compile errors. |
| Keyless or externally managed read model                                                                   | deferred          | It requires a separate explicit Resource contract and cannot weaken regular Collection identity.           |
| Exact resolved Collection map in the App Contract                                                          | v1                | Includes Owner Fields plus its literal accepted Augmentation tuple.                                        |
| Exclusion, partial, expression, and deferrable Constraints                                                 | deferred          | They require new schema artifact members and round-trip proof.                                             |
| Extension-owned indexes, PostGIS indexes, and TimescaleDB hypertables                                      | deferred          | A named PostgreSQL capability must preserve reviewed artifacts, receipts, drift, and dependency facts.     |
| Generic Collection metadata bag or lifecycle callbacks                                                     | rejected          | Metadata must belong to a named later capability; callbacks cannot enter canonical structure.              |

### Relations

| Capability                                                      | Classification    | Contract                                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreign-key-owning `relation.toOne`                             | accepted baseline | Stored on the source Collection and projected unchanged to schema artifact v1.                                                                                                     |
| Explicit inverse `relation.toMany` traversal                    | v1                | Owned by the target Collection, points to one source `toOne`, and exists only in the Data Contract Projection.                                                                     |
| `toOne` nested selection                                        | v1                | One traversal hop; result is always nullable at the public boundary.                                                                                                               |
| `exists` and `notExists` Relation filtering                     | v1                | One traversal hop over `toOne` or inverse `toMany`.                                                                                                                                |
| Projected `toMany` arrays                                       | deferred          | Per-parent ordering, limits, cost, and pagination need their own proof.                                                                                                            |
| Synthetic many-to-many Relation                                 | deferred          | V1 models the join Collection and two explicit `toOne` Relations.                                                                                                                  |
| Polymorphic Relation                                            | deferred          | It cannot silently become an unchecked `(kind, id)` pair in schema artifact v1.                                                                                                    |
| Multiple explicit nullable foreign keys plus a check Constraint | accepted baseline | This is the v1 alternative when a closed set of target kinds is required. Each Relation remains ordinary and explicit.                                                             |
| Relation from a Collection Augmentation                         | deferred          | Cross-owner reference authority remains outside Collection Augmentation v1. An app cannot add an inverse member to a sealed Package Collection without vendoring that composition. |
| Implicit inverse name synthesized on another Owner              | rejected          | A source Definition cannot add a member to a target Owner.                                                                                                                         |
| Generic target string or unvalidated soft Relation              | rejected          | Every traversal resolves one semantic Relation identity.                                                                                                                           |

### Structural data Queries

| Capability                                                                                      | Classification        | Contract                                                                                                      |
| ----------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Exact scalar and one-hop `toOne` selection                                                      | v1                    | Output aliases and member references normalize explicitly.                                                    |
| Boolean filters, scalar comparisons, set membership, null tests, and one-hop Relation existence | v1                    | Closed operator matrix in section 9.                                                                          |
| Explicit base-Collection ordering                                                               | v1                    | No default order. Every term names direction and null placement.                                              |
| Forward cursor pagination                                                                       | v1                    | Requires a proved total order and returns a connection shape.                                                 |
| Bounded runtime scalar-list parameters                                                          | v1                    | Closed item codec, declared maximum, canonical set binding, and exact empty/null semantics.                   |
| Typed paths to inline Field leaves                                                              | v1                    | Canonical paths are segment arrays and each leaf has one complete Field identity.                             |
| Query paths into typed JSONB object/array interiors                                             | deferred              | Embedded properties have codecs but no Field identity; v1 selects the owning Field as one typed value.        |
| Offset, backward cursor, unbounded list, and implicit first page                                | rejected for v1       | They weaken the bounded execution and cursor contract; this is independent of the Barbershop witness.         |
| Aggregation, grouping, distinct, computed selection, window functions, and locking              | deferred              | Each changes output inference or execution guarantees.                                                        |
| Arbitrary joins                                                                                 | deferred              | V1 traverses declared Relations only.                                                                         |
| Conditional query-shape branching                                                               | rejected              | Bindings supply values, never AST fragments. Separate closed templates express separate shapes.               |
| Native PostgreSQL query reservation                                                             | deferred escape hatch | Section 15 fixes its required boundary; no executable API exists before Policy and Operation authority close. |
| Generic `unsafe`, unknown operator, or engine expression                                        | rejected              | No generic bypass flag exists.                                                                                |

## 4. Runtime scalar values

QUESTPIE validates values at every Data boundary before lowering and after
reading PostgreSQL. It does not use a TypeScript annotation as runtime
validation.

| Field                         | TypeScript value | Canonical runtime value                                                                      |
| ----------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `uuid`                        | `string`         | Lowercase 8-4-4-4-12 hexadecimal text; version and variant nibbles are unrestricted.         |
| `text`                        | `string`         | Unicode NFC string satisfying declared bounds.                                               |
| `boolean`                     | `boolean`        | JSON boolean.                                                                                |
| `integer`                     | `number`         | JSON safe integer within PostgreSQL `int4` and declared bounds.                              |
| `bigint`                      | `string`         | Canonical base-10 `int8` text; never a JavaScript `bigint` or number on the public boundary. |
| `numeric`                     | `string`         | Canonical fixed-scale decimal text satisfying precision and scale.                           |
| `timestamp` without time zone | `string`         | `YYYY-MM-DDTHH:mm:ss.SSS`, with no offset.                                                   |
| `timestamp` with time zone    | `string`         | UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`.                                                              |
| `date`                        | `string`         | `YYYY-MM-DD`.                                                                                |

The exact lexical rules are the scalar codecs already accepted in
`schema-lifecycle.md`. Query literals, parameter bindings, cursor order values,
Seed values, returned rows, and generated-client values use those same codecs.
Non-NFC Data values are rejected at every Data/value boundary; QUESTPIE never
silently normalizes or rewrites caller text. Origin and Build Input path
normalization is a separate filesystem rule from ADR-0007.
No layer converts bigint or numeric to a lossy number, accepts an offset for a
UTC timestamp, or relies on locale formatting.

The UUID codec validates shape and lowercase hexadecimal bytes only. PostgreSQL
stores any 128-bit UUID, including nil, UUIDv7, UUIDv8, and legacy values; a
legal stored row cannot become unreadable because its version or variant nibble
falls outside an application regex.

This already permits application-supplied UUIDv7 values on the accepted
PostgreSQL baseline. Native database generation with `uuidv7()` is a separate
baseline decision: PostgreSQL 18 provides the function and is supported through
November 2030, while, as checked on 2026-08-11, the current managed Supabase documentation exposes
PostgreSQL 17 rather than 18. Raising `requiredPostgres.minimumMajor` from 16 to
18 and replacing the accepted `randomUuid`/`gen_random_uuid()` default would
supersede schema artifact v1 and currently conflict with the managed Supabase
tracer. It therefore remains an explicit cross-vertical choice, not a silent
codec change in this grill. Evidence:
[PostgreSQL 18 UUID functions](https://www.postgresql.org/docs/18/functions-uuid.html),
[PostgreSQL version policy](https://www.postgresql.org/support/versioning/), and
[Supabase PostgreSQL upgrades](https://supabase.com/docs/guides/platform/upgrading).

`null` is a value only for a nullable Field or nullable query parameter.
`undefined` is never a canonical value. An absent insert/update property means
"not supplied" and is resolved before any canonical database command is
formed. QUESTPIE's generated project enables `exactOptionalPropertyTypes`.
Runtime validation still rejects an explicitly present `undefined` property
when a consumer compiles with weaker TypeScript options.

### 4.1 Candidate nested and JSON values

Revision 6 separates three concepts that v3's single nested-object surface
blurred:

```ts
const customers = defineCollection({
	name: "customers",
	fields: {
		address: shape.inline({
			fields: {
				city: field.text({ nullable: false }),
				location: postgis.geographyPoint({ nullable: true, srid: 4326 }),
			},
		}),
		preferences: field.object({
			nullable: false,
			properties: {
				locale: value.text({ nullable: false }),
				marketingEmail: value.boolean({ nullable: false }),
			},
		}),
		tags: field.array({
			nullable: false,
			items: value.text({ nullable: false }),
			maximumItems: 100,
		}),
		metadata: field.json({ nullable: true }),
	},
});
```

`shape.inline` is a structural group, not a Field. It has no runtime value,
nullability, default, codec, semantic Field identity, or PostgreSQL column. Its
leaves are ordinary full Fields and may use a focused extension Field such as
PostGIS once that Field has its own accepted schema/query/drift contract. Inline
shapes may nest to eight shape segments. Their generated row shape mirrors the
authored object, while each leaf remains independently nullable, selectable,
indexable, constrainable, and stored in its own column. Physical column names
are derived or overridden per leaf; no group-level PostgreSQL name exists.

`field.object` and `field.array` are Fields stored in exactly one `jsonb`
column. Their interiors use a separate closed `value.*` vocabulary. A Value
node has a codec and nullability, but cannot declare a default, physical name,
Constraint, Index, Relation, Policy, hook, extension Field, generated column,
or lifecycle. This makes an unsupported `postgis.geographyPoint()` inside an
object a type and structural-evaluation error rather than a feature that fails
later. Closed objects reject unknown properties at every write boundary and
after every database read.

The candidate built-in Value grammar is the eight accepted scalar codecs plus
recursive `value.object({ properties })` and `value.array({ items,
maximumItems })`. Object keys use the 1-to-63 lower-camel ASCII member grammar.
Object and array nesting is limited to eight Value containers, and a
`maximumItems` integer from 1 through 1,000 is mandatory for every array node.
Arrays preserve element order and duplicates. Every JSONB-backed Field also
has a maximum canonical UTF-8 JSON size of 1,048,576 bytes; a deployment may
lower but not raise it without changing this contract.

`field.json` accepts a tagged public value `{ kind: "json", value: JsonValue }`,
where `JsonValue` is the recursive union `null | boolean | string | number |
JsonValue[] | { [key: string]: JsonValue }`. The tag is mandatory on every
Data, transport, cursor, and Seed boundary: an outer `null` means SQL `NULL`,
while `{ kind: "json", value: null }` means top-level JSON `null`. Numbers must be finite
canonical JSON numbers; `undefined`, sparse arrays, non-NFC strings and object
keys, non-plain objects, duplicate decoded keys, and values outside the size
bound are rejected. Object keys sort by Unicode code-point order in canonical
JSON bytes. Open JSON exposes only whole-Field selection plus `isNull` and
`isNotNull`; it supplies no typed interior path or whole-value equality in v1.

An embedded value has no independent identity. If a concept needs its own ID,
Relation, Policy boundary, mutation lifecycle, unbounded growth, independent
querying, or pagination, the author models an explicit Collection and Relation.
QUESTPIE never extracts or synthesizes a hidden mini-Collection. Studio may
render an embedded editor, but it cannot change that ownership decision.

Schema and Data Contract Field records carry both `identity` and a non-empty
segment-array `path`. For an inline leaf, `path` contains every shape key
followed by the leaf key,
for example `{ identity: "collection:customers/field:address/field:city",
path: ["address", "city"] }`. Every segment is a validated member key and the
path resolves before normalization. Top-level authoring accepts the ergonomic
one-segment string `"id"`; nested authoring uses a typed segment tuple such as
`["address", "city"]`. `"address.city"` is one ordinary key and is never parsed
as a path.

An embedded property such as `preferences.locale` is part of the owning
`field.object` codec, not a Field and has no independent Field record. V1 generated
row types expose its typed value through the whole `preferences` Field, but
filter, selection, ordering, cursor, Index, Constraint, Relation, dependency,
and physical-name protocols cannot address the property independently. Array
indices, wildcards, and all embedded-interior Query paths are deferred.

The exact `FieldTypeV1`, `EmbeddedPropertyV1`, `EmbeddedValueCodecV1`, and
Schema Projection Field declarations live once in `schema-lifecycle.md`; this
chapter does not redeclare them. An inline shape disappears as an artifact
node; each leaf retains its complete semantic identity, path, physical name,
type, nullability, default, and collation. JSONB-backed Fields retain their
closed embedded codec. Fields sort by semantic identity; object `properties`
sort by raw key bytes.
Array item order is data and is never sorted. Constraints, Indexes, Relations, data
dependencies, and physical-name records reference complete Field identities.
Local Definition contracts use `FieldPathV1` because they are encoded before
application-wide identity resolution. Schema and Data Contract Field records
carry both identity and path. No surface stores or parses a joined dotted path.
A path change is a semantic schema change even if an explicit physical column
name keeps the PostgreSQL object unchanged. Schema lifecycle pins the
corresponding member-contract payload, migration operations, introspection
fingerprint, drift diagnostics, and golden bytes.

## 5. Row shapes and generated App Contract

For a Field with runtime value `V`, only nullability changes the property value:

```ts
type FieldValue<V, Nullable extends boolean> = Nullable extends true
	? V | null
	: V;
```

Read rows map every key to `FieldValue`. Insert rows require every non-nullable
Field without a default; a nullable Field or any Field with a default uses an
optional property of that same value type. Update patches make every Field an
optional property. Property optionality, not a second value alias, distinguishes
the three shapes. Runtime
validation rejects an empty patch; v1 does not add a public conditional type to
approximate non-empty objects. Whether a Mutation may update a primary key,
generated value, or Relation key is deferred to the Mutation grill; the
structural patch type does not silently claim that authority.

`id`, `createdAt`, and `updatedAt` have no reserved Field behavior. An author
declares `id` as an ordinary Field and gives key semantics to one named
`constraint.primaryKey({ fields: ["id"] })`. Timestamp Fields are equally
ordinary: `default: "now"` can initialize explicit `createdAt` and `updatedAt`
Fields, but it does not update either value later. Automatically advancing
`updatedAt` belongs to the later transaction-owned Mutation design; schema
compilation never inserts a hidden callback or lifecycle member.

For the accepted Barbershop Collections the generated output is concrete.
`DataFieldDescriptor<Identity, Codec, Value, Nullable, HasDefault>` is a shallow library
type whose runtime members are the semantic Field identity, codec, nullability,
and default flag; `Value` is a type-only slot used for inference. A Relation
target repeats only the target's name, identity, and Field descriptors. It does
not carry the target's Relations or create a recursive application graph:

```ts
interface AppointmentFieldDescriptors {
	id: DataFieldDescriptor<
		"collection:appointments/field:id",
		{ kind: "uuid" },
		string,
		false,
		true
	>;
	tenantId: DataFieldDescriptor<
		"collection:appointments/field:tenantId",
		{ kind: "uuid" },
		string,
		false,
		false
	>;
	customerName: DataFieldDescriptor<
		"collection:appointments/field:customerName",
		{ kind: "text"; minLength: null; maxLength: 160 },
		string,
		false,
		false
	>;
	startsAt: DataFieldDescriptor<
		"collection:appointments/field:startsAt",
		{ kind: "timestamp"; withTimezone: true },
		string,
		false,
		false
	>;
	endsAt: DataFieldDescriptor<
		"collection:appointments/field:endsAt",
		{ kind: "timestamp"; withTimezone: true },
		string,
		false,
		false
	>;
	status: DataFieldDescriptor<
		"collection:appointments/field:status",
		{ kind: "text"; minLength: null; maxLength: 24 },
		string,
		false,
		true
	>;
}

interface TenantFieldDescriptors {
	id: DataFieldDescriptor<
		"collection:tenants/field:id",
		{ kind: "uuid" },
		string,
		false,
		true
	>;
	slug: DataFieldDescriptor<
		"collection:tenants/field:slug",
		{ kind: "text"; minLength: null; maxLength: 80 },
		string,
		false,
		false
	>;
	name: DataFieldDescriptor<
		"collection:tenants/field:name",
		{ kind: "text"; minLength: null; maxLength: 160 },
		string,
		false,
		false
	>;
}

export interface AppContract {
	data: {
		collections: {
			appointments: {
				name: "appointments";
				identity: "collection:appointments";
				fields: AppointmentFieldDescriptors;
				uniqueConstraints: {
					primary: {
						kind: "primaryKey";
						identity: "collection:appointments/constraint:primary";
						fields: readonly ["id"];
					};
				};
				row: {
					id: string;
					tenantId: string;
					customerName: string;
					startsAt: string;
					endsAt: string;
					status: string;
				};
				insert: {
					id?: string;
					tenantId: string;
					customerName: string;
					startsAt: string;
					endsAt: string;
					status?: string;
				};
				update: {
					id?: string;
					tenantId?: string;
					customerName?: string;
					startsAt?: string;
					endsAt?: string;
					status?: string;
				};
				relations: {
					tenant: {
						kind: "toOne";
						identity: "collection:appointments/relation:tenant";
						target: {
							name: "tenants";
							identity: "collection:tenants";
							fields: TenantFieldDescriptors;
						};
					};
				};
			};
			tenants: {
				name: "tenants";
				identity: "collection:tenants";
				fields: TenantFieldDescriptors;
				uniqueConstraints: {
					primary: {
						kind: "primaryKey";
						identity: "collection:tenants/constraint:primary";
						fields: readonly ["id"];
					};
					slugUnique: {
						kind: "unique";
						identity: "collection:tenants/constraint:slugUnique";
						fields: readonly ["slug"];
					};
				};
				row: { id: string; slug: string; name: string };
				insert: { id?: string; slug: string; name: string };
				update: { id?: string; slug?: string; name?: string };
				relations: {
					appointments: {
						kind: "toMany";
						identity: "collection:tenants/relation:appointments";
						target: {
							name: "appointments";
							identity: "collection:appointments";
							fields: AppointmentFieldDescriptors;
						};
						inverseOf: "collection:appointments/relation:tenant";
					};
				};
			};
		};
	};
}

export type AppData = AppContract["data"];
```

The real generated file uses exact full Qualified Resource Name keys. Row,
insert, update, relation, and target descriptors are concrete object types.
Only the bounded `DataFieldDescriptor` helper is generic; no ORM type,
whole-application generic registry, or recursive Relation graph enters the
surface. Query operators derive from each descriptor's codec, while selection
values derive from its type-only `Value`. `uniqueConstraints` preserves exact
key tuples so the generated Collection specialization can prove a total-order
suffix without hard-coding `id` in the generic builder.

## 6. Relation ownership and cardinality

### Owning `toOne`

The accepted `relation.toOne` remains the only schema-owning Relation. The
source Collection owns the member and its foreign-key Constraint. PostgreSQL
`MATCH SIMPLE` semantics apply: if any local Field is null, the foreign key is
not checked and traversal produces `null`. Composite local and referenced Field
order remains significant.

Even when every local Field is required, public nested `toOne` selection has
type `SelectedTarget | null`. This stable boundary leaves room for later
Policy filtering and for explicit external inconsistency diagnostics without
changing generated query output types. It does not weaken the database
Constraint.

Referential actions have only their PostgreSQL meanings. `cascade` does not
create a QUESTPIE Mutation, Reaction, or query event by itself. The later
Change Ledger grill must prove how database cascades are captured.

### Non-owning inverse `toMany`

An inverse traversal is an explicit member on the Collection that owns the
inverse name:

```ts
// src/data/tenants.ts
import {
	constraint,
	defineCollection,
	field,
	relation,
	relationRef,
} from "questpie";

export const tenants = defineCollection({
	name: "tenants",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		slug: field.text({ nullable: false, maxLength: 80 }),
		name: field.text({ nullable: false, maxLength: 160 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		slugUnique: constraint.unique({ fields: ["slug"] }),
	},
	relations: {
		appointments: relation.toMany({
			inverseOf: relationRef("appointments", "tenant"),
		}),
	},
});
```

`relationRef("appointments", "tenant")` has declaration type
`RelationReference<"appointments", "tenant">`. Both arguments remain literal
parameters; the public value does not widen them to `string` or carry a target
row graph. The compiler resolves the exact identity
`collection:appointments/relation:tenant` against the complete application and
requires it to be a schema-owning `toOne` whose target is the declaring
Collection. A missing identity is `QP-COMPOSE-004`; a resolved but mismatched
Relation is `QP-DATA-003`. Neither becomes a target-side patch or an
import-order lookup.

The inverse uses a literal reference rather than importing the `appointments`
Definition value because the owning `toOne` already imports `tenants`; importing
back would create a module cycle. Resolution still happens against the complete
compiled application, not against evaluation order.

The inverse identity is
`collection:tenants/relation:appointments`. It appears in the Data Contract
Projection and generated App Contract but never in `SchemaProjectionV1`.
Changing it therefore changes semantic Compiled Manifest bytes and generated
types without creating a Migration Plan. The member Owner is `tenants`; the
`appointments` Definition receives no target-side patch.

An inverse has no PostgreSQL object, so `postgres: { name }` is not a valid
`relation.toMany` option and reports `QP-SCHEMA-001 invalidDefinition` when it
reaches compiler validation. Its semantic identity is also not a valid
`questpie.json` `postgres.physicalNames` target and reports `QP-SCHEMA-003
invalidReference`. Neither path can create a shadow foreign-key name or an
inert override.

An inverse is always `toMany` in v1, even if the source local Fields also have a
unique Constraint. An inferred inverse `toOne` is deferred so cardinality
cannot change when an unrelated Constraint changes.

## 7. Structural query authoring

A structural Data Query is a closed, serializable template value. It is not a
top-level Resource, Operation handler, or executable callback artifact. The
factory callback runs only to construct branded expression nodes; no callback
enters canonical bytes.

```ts
import type { AppData } from "#questpie/app";
import { dataQuery, query } from "questpie";

export const appointmentPage = dataQuery<
	AppData["collections"]["appointments"]
>()({
	from: "appointments",
	parameters: {
		tenantId: query.parameter.uuid({ nullable: false }),
		statuses: query.parameter.list(query.parameter.text(), {
			maximumItems: 20,
		}),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		customerName: fields.customerName,
		startsAt: fields.startsAt,
		status: fields.status,
		tenant: relations.tenant.select(({ fields: tenant }) => ({
			slug: tenant.slug,
			name: tenant.name,
		})),
	}),
	where: ({ fields, parameters }) =>
		query.and(
			fields.tenantId.equal(parameters.tenantId),
			fields.status.in(parameters.statuses),
		),
	orderBy: ({ fields }) => [
		fields.startsAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
```

`tenantId` in this example is an ordinary domain filter parameter. It is not a
Tenant security boundary and creates no implicit tenancy guarantee. The later
Principal/Authority/Policy vertical decides which immutable Tenant fact enters
execution and which SQL predicate enforces it.

All five structural clauses are explicit. `select` must contain at least one
member. `where` can be `null` only when the author writes `where: null`.
`orderBy` has no default. `page` has no default. A list query without the v1
forward page contract is invalid; an unpaginated singleton lookup belongs to a
later direct-Collection operation contract.

Output keys are lower-camel member keys. They can alias a selected Field or
Relation, but two outputs cannot share a key. One Field can be selected more
than once under distinct keys. V1 selection expressions are only a Field or a
one-hop `toOne.select`. Computed values and `toMany` selection are deferred.

The parameter object is a closed literal map. Parameters are non-null scalar
codecs, bounded non-null scalar-list codecs, or the one nullable cursor codec.
They are always supplied at binding time; the cursor accepts `null` for the
first page but is never optional. Parameters cannot carry a Field reference,
operator, selection, order term, Relation, nested object, or arbitrary JSON.
List parameters are valid only as the complete operand of `in` or `notIn`.

The outer `dataQuery<Collection>()` call binds the generated descriptor; the
inner call still infers literal parameter, selection, filter, and order shapes.
This two-stage form avoids TypeScript's partial generic-inference trap, where
explicitly supplying the Collection type would otherwise prevent later
definition generics from being inferred. The type-only `AppData` edge uses the
current virtual App Contract accepted by ADR-0007 and is erased before
structural evaluation. The descriptor contains its exact `name`, concrete
scalar Fields, and one-hop Relation endpoints; it does not expose a recursive
application registry. `from` is that exact name literal, not broad `string`.

The normalized template is application output because its bytes bind both
application projection digests. It can be embedded unchanged in the later
Compiled Query Resource, but it cannot enter that Resource's Definition
Contract or a Package Inventory digest. A Package-facing structural contract
must instead contain the application-independent authored shape and typed
references; application compilation resolves those references and injects the
projection digests. An unrelated application schema change may invalidate a
compiled cursor, but it cannot change an accepted Package Inventory digest or
raise `QP-COMPOSE-008 packageInventoryChanged`.

## 8. Query result and binding types

The example infers this exact public shape:

```ts
interface AppointmentPageParameters {
	tenantId: string;
	statuses: string[];
	first: number;
	after: string | null;
}

interface AppointmentPageResult {
	nodes: Array<{
		id: string;
		customerName: string;
		startsAt: string;
		status: string;
		tenant: { slug: string; name: string } | null;
	}>;
	pageInfo: {
		endCursor: string | null;
		hasNextPage: boolean;
	};
}
```

`first` is checked against both its parameter bounds and the Runtime's later
execution limit. `after` is opaque to application code and clients even though
its canonical protocol is specified below. A page with no nodes has
`endCursor: null`. `hasNextPage` is computed by reading at most `first + 1`
matching base rows; the sentinel row is not returned.

The generated App Contract exposes the concrete parameter and result shapes
where a later Query Resource accepts this structural template. This grill does
not choose the Query Resource factory, handler signature, network encoding, or
client method name.

## 9. Filter grammar and null semantics

Every comparison has one Field operand and one compatible literal or parameter
operand. V1 does not compare two Fields, coerce between Field kinds, or invoke a
database function. A literal is normalized by the Field codec while the
template is built. A parameter is normalized when the template is bound.

| Field kind                               | `equal`, `notEqual` | `in`, `notIn` | `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual` | `isNull`, `isNotNull` |
| ---------------------------------------- | ------------------- | ------------- | ------------------------------------------------------------------ | --------------------- |
| UUID                                     | yes                 | yes           | no                                                                 | nullable only         |
| text                                     | yes                 | yes           | yes, under `questpie.binary`                                       | nullable only         |
| boolean                                  | yes                 | yes           | no                                                                 | nullable only         |
| integer                                  | yes                 | yes           | yes                                                                | nullable only         |
| bigint                                   | yes                 | yes           | yes                                                                | nullable only         |
| numeric                                  | yes                 | yes           | yes                                                                | nullable only         |
| timestamp                                | yes                 | yes           | yes                                                                | nullable only         |
| date                                     | yes                 | yes           | yes                                                                | nullable only         |
| JSONB object/array/open JSON whole Field | no                  | no            | no                                                                 | nullable Field only   |

`like`, case-insensitive matching, regex, full-text, whole-JSON equality, JSON
path operators, and user-defined operators are deferred. Whole-JSON equality
needs an explicit closed operand codec before it can enter the Query protocol.
An inline path resolves to its ordinary leaf Field and uses that scalar Field's
operator row. Typed JSONB object/array interiors remain inaccessible to Query v1.

Foundational text comparison and ordering use exactly one semantic collation,
`questpie.binary`. It lowers every text equality, range predicate, ORDER BY,
unique/index comparison used as a cursor witness, and cursor seek comparison to
PostgreSQL collation `C`, explicitly rather than through the database default.
Because accepted text is NFC UTF-8, byte ordering is deterministic for the same
canonical strings. Schema Projection and the text codec in Data Contract
Projection record `{ collation: "questpie.binary" }`; the Query Template embeds
that codec transitively and a cursor's template digest therefore binds it.

Before migration, drift comparison, or Query execution, the provider gate must
resolve `C` in `pg_collation`, verify `collprovider = 'c'` and
`collisdeterministic = true`, and prove the database encoding is UTF-8. Failure
is closed; QUESTPIE never substitutes `C.UTF-8`, ICU, libc locale, or the
database default. Locale-sensitive order later requires a named collation
capability carrying provider, locale, deterministic flag, actual-version
fingerprint, upgrade behavior, indexes, and cursor invalidation rules.

`in` and `notIn` accept either a literal scalar tuple or one compatible runtime
scalar-list parameter. A list parameter declares one non-null scalar item codec
and `maximumItems` from 1 through 1,000. Its public value is an array and the
parameter itself is required and non-null. Null items, holes, `undefined`, a
wrong scalar codec, or a bound length over its declared maximum are bind errors.
A deployment may impose a lower maximum and reports the ordinary execution
limit diagnostic before a database read.

Membership operands are semantic sets. Literal tuples are validated at compile
time; bound arrays are validated at bind time. Both are deduplicated by exact
canonical scalar bytes and sorted by those bytes before entering canonical
template or binding/scope bytes. Therefore authored/bound order and duplicates
do not change the Query or Scope Digest. The empty set is valid:
`field.in([])` is always false and `field.notIn([])` is always true, including
for a null Field. This result is fixed before SQL lowering and avoids PostgreSQL
`NULL`/`ANY` surprises. No list member may be null. Private SQL may use typed
`= ANY($n)`/`<> ALL($n)` only after preserving these closed empty and null rules.

`query.and`, `query.or`, and `query.not` are the only boolean combinators.
`and` and `or` require at least two children. Their child order is preserved in
normal form because it is authored structure, not a semantic set. The compiler
does not distribute, deduplicate, reorder, or otherwise optimize boolean
expressions before hashing. A private SQL lowerer can optimize only if result
and dependency semantics remain identical.

Filters follow PostgreSQL three-valued logic. Only `true` retains a row;
`false` and `unknown` reject it. Comparing a nullable Field with a non-null
value yields `unknown` for a null row. `equal(null)`, `notEqual(null)`, and a
null member of `in`/`notIn` are compile or binding errors. Empty membership
sets use the closed constants above. Authors must use `isNull` or `isNotNull`.
These rules avoid JavaScript truthiness and the surprising SQL
`NOT IN (..., NULL)` case.

Relation predicates are explicit:

```ts
where: ({ relations, parameters }) =>
	relations.tenant.exists(({ fields }) =>
		fields.slug.equal(parameters.tenantSlug),
	),
```

`exists(predicate)` is true when at least one related row satisfies the nested
filter. `notExists(predicate)` is its SQL `NOT EXISTS` complement, including
when local `toOne` keys are null. The nested filter can use target scalar
Fields and boolean combinators but cannot traverse another Relation. A
predicate with no target condition uses `exists(query.always)` or
`notExists(query.always)`; `always` is valid only as the direct Relation
predicate and normalizes to `{ "kind": "true" }`.

## 10. Ordering and forward cursor pagination

V1 ordering names only base-Collection Fields. Every authoring term explicitly
calls `ascending` or `descending` with `nulls: "first" | "last"`; normalized
direction bytes are `"asc"` or `"desc"`. A Field cannot appear twice.

Cursor ordering accepts UUID, text under `questpie.binary`, boolean, integer,
bigint, numeric, timestamp, and date Fields, including an inline leaf whose
ordinary Field has one of those codecs. It does not accept a whole object,
array, open JSON Field, or any embedded-interior path.
UUID seek order is PostgreSQL's native UUID order. Text seek order always emits
explicit `COLLATE "C"`; both equality branches and successor branches use that
same expression. Numeric and temporal seek values use their canonical codecs.
These private seek comparisons are lowering mechanics, not public filter
operators; the fact that UUID has no public `lessThan` method does not prevent a
cursor lowerer from applying its declared UUID order.

A paginated order is valid only when it ends with every Field of one primary or
unique Constraint, in that Constraint's declared order, and those key Fields
are non-nullable. An earlier occurrence of the key or an extra trailing term is
rejected even if the mathematical order would be total; v1 deliberately uses
one smaller suffix validator. The compiler never appends a primary key
silently. `QP-DATA-007` reports that the order does not end with a qualifying
non-null key and lists the available suffixes.

When the same ending suffix satisfies more than one primary or unique Constraint, the
normalizer selects the Constraint with the lowest semantic identity by ASCII
byte order and writes that identity to `page.uniqueConstraint`. Discovery order
cannot choose it.

Every order Field or scalar path must also be selected directly under at least
one output key.
V1 has no hidden cursor value: the plaintext cursor cannot reveal a Field that
the result omits. The later Policy grill must apply field-output filtering to
both the selected value and its cursor eligibility. If Policy removes an order
Field, the paginated Query is unavailable to that Principal with one closed
Policy diagnostic. Runtime cannot hide the output, leak it only through the
cursor, or silently change the order.

For example, `(startsAt ASC NULLS LAST, id ASC NULLS LAST)` is total because
`id` is the non-null primary key. `(startsAt ASC NULLS LAST)` is rejected even
when the current data happens to contain unique values.

Forward page semantics are:

1. Bind and validate all scalar parameters.
2. Decode `after` when non-null and validate its template digest, scope digest,
   order identities, value codecs, and arity.
3. Apply the filter.
4. Apply the complete lexicographic order, including explicit null placement.
5. If `after` is non-null, retain only rows strictly after its complete order
   tuple under that order. The boundary row itself is excluded.
6. Read at most `first + 1` base rows. Return the first `first` and use the
   sentinel only for `hasNextPage`.
7. Encode `endCursor` from the last returned row's complete order tuple.

All comparisons in the cursor seek predicate use the same Field codecs,
direction, collation, and null placement as the order. A private lowerer cannot
replace this with tuple comparison when PostgreSQL tuple null behavior would
change the result.

The successor relation is closed over each order term. Comparing row value `r`
with boundary value `b` produces:

1. `equal` when both are null;
2. `before` for null `r` and non-null `b` under `NULLS FIRST`, otherwise
   `after`;
3. `after` for non-null `r` and null `b` under `NULLS FIRST`, otherwise
   `before`;
4. for two non-null values, the Field's PostgreSQL order, reversed only for
   `DESC`.

The complete tuple is `after` when its first non-equal term is `after`; it is
not after when every term is equal. SQL lowering expands that lexicographic
rule with explicit `IS NULL`, `IS NOT NULL`, and `IS NOT DISTINCT FROM`
branches. For `ASC NULLS LAST`, a non-null boundary term contributes
`f > b OR f IS NULL`; a null boundary contributes `f IS NULL` before recursion
to the remaining terms. `NULLS FIRST` mirrors the null branch; `DESC` reverses
only the non-null comparison. A row-value tuple comparison is permitted only
when every term is non-null and its semantics are identical. Revision 3
goldens cover null boundaries under both null placements.

Each page observes the database state of its own read. V1 does not promise a
snapshot spanning multiple client requests. Concurrent inserts, deletes, or
order-field updates can therefore move rows between pages. A watched Query
recomputes one complete current page; it does not patch a historical page in
place. Cross-request snapshots and stable backward navigation are deferred.

V1 fixes only the snapshot of one structural SQL statement. Whether one Query
Resource Execution wraps multiple structural reads in one PostgreSQL
transaction, and at which isolation level, belongs to the Operation grill.
Until then, no surface can claim that two structural Queries in one Execution
observe one consistent state, and a Live Query recomputation spanning more than
one structural Query has no defined common snapshot.

One structural Query lowers to one PostgreSQL statement. Base rows, one-hop
`toOne` projections, the `first + 1` sentinel, and all dependency facts observe
that statement snapshot. A later Query Resource can use this paginated form
only when every applicable Policy row filter lowers into the same SQL
predicate. A non-representable post-query Policy filter cannot shorten the page
or compute `hasNextPage`; the Policy grill must reject that combination rather
than reinterpret these bytes.

The sentinel is inside that same Policy predicate. `hasNextPage` can disclose
only the existence of one additional Policy-visible row, never a row excluded
by Policy; otherwise the bit is an unregistered inference channel and the Query
must fail closed.

## 11. Closed canonical query protocol

### Query Template

The factory normalizes to this engine-independent tree:

```ts
// Exactly the scalar subset of FieldTypeV1 from schema-lifecycle.md.
type ScalarCodecV1 =
	| { kind: "uuid" }
	| {
			kind: "text";
			minLength: number | null;
			maxLength: number | null;
			collation: "questpie.binary";
	  }
	| { kind: "boolean" }
	| { kind: "integer"; minimum: number | null; maximum: number | null }
	| { kind: "bigint"; minimum: string | null; maximum: string | null }
	| { kind: "numeric"; precision: number; scale: number }
	| { kind: "timestamp"; withTimezone: boolean }
	| { kind: "date" };

type QueryOperandV1 =
	| {
			kind: "literal";
			codec: ScalarCodecV1;
			value: boolean | number | string;
	  }
	| {
			kind: "parameter";
			parameter: string;
	  };

type ScalarQueryFilterV1 =
	| {
			kind:
				| "equal"
				| "notEqual"
				| "lessThan"
				| "lessThanOrEqual"
				| "greaterThan"
				| "greaterThanOrEqual";
			field: `collection:${string}/field:${string}`;
			operand: QueryOperandV1;
	  }
	| {
			kind: "in" | "notIn";
			field: `collection:${string}/field:${string}`;
			set:
				| {
						kind: "literal";
						codec: ScalarCodecV1;
						values: Array<boolean | number | string>;
				  }
				| { kind: "parameter"; parameter: string };
	  }
	| {
			kind: "isNull" | "isNotNull";
			field: `collection:${string}/field:${string}`;
	  };

type RelatedQueryFilterV1 =
	| ScalarQueryFilterV1
	| { kind: "and" | "or"; expressions: RelatedQueryFilterV1[] }
	| { kind: "not"; expression: RelatedQueryFilterV1 };

type RootQueryFilterV1 =
	| ScalarQueryFilterV1
	| { kind: "and" | "or"; expressions: RootQueryFilterV1[] }
	| { kind: "not"; expression: RootQueryFilterV1 }
	| {
			kind: "relationExists" | "relationNotExists";
			relation: `collection:${string}/relation:${string}`;
			filter: RelatedQueryFilterV1 | { kind: "true" };
	  };

interface FieldQuerySelectionV1 {
	kind: "field";
	key: string;
	field: `collection:${string}/field:${string}`;
}

type RootQuerySelectionV1 =
	| FieldQuerySelectionV1
	| {
			kind: "toOne";
			key: string;
			relation: `collection:${string}/relation:${string}`;
			select: FieldQuerySelectionV1[];
	  };

interface DataQueryTemplateV1 {
	format: "questpie.data-query-template";
	version: 1;
	from: `collection:${string}`;
	schemaProjectionDigest: string;
	dataContractProjectionDigest: string;
	parameters: Array<
		| {
				name: string;
				kind: "scalar";
				codec: ScalarCodecV1;
				nullable: false;
		  }
		| {
				name: string;
				kind: "list";
				codec: ScalarCodecV1;
				maximumItems: number;
				nullable: false;
				semantics: "set";
		  }
		| { name: string; kind: "cursor"; nullable: true }
	>;
	select: RootQuerySelectionV1[];
	filter: RootQueryFilterV1 | null;
	order: Array<{
		field: `collection:${string}/field:${string}`;
		direction: "asc" | "desc";
		nulls: "first" | "last";
	}>;
	page: {
		kind: "forwardCursor";
		first: { kind: "parameter"; parameter: string };
		after: { kind: "parameter"; parameter: string };
		uniqueConstraint: `collection:${string}/constraint:${string}`;
	};
}
```

`ScalarCodecV1` is the scalar subset of `FieldTypeV1`; JSON-backed Field kinds
cannot become Query parameters. The declaration is reproduced here only for
readability. A scalar codec change requires coordinated versions for Schema
Projection, Data Contract Projection, and every protocol that embeds it.

The recursive filter declarations above document artifact JSON. Selection is
depth-one by construction: a root `toOne` contains only Field selections, and
a Relation predicate contains `RelatedQueryFilterV1`, which cannot contain
another Relation predicate. They are not emitted as the public application
inference mechanism. Public builders use bounded node brands and generated
concrete overloads; the TypeScript fixture must prove that no whole-application
recursive generic enters declarations.

Every root Field identity must belong to `from`. Every nested selection and
`RelatedQueryFilterV1` Field must belong to that Relation's target Collection.
An inverse `toMany` can appear in a Relation predicate but not selection. The
normalizer rejects a cross-scope Field even when its raw identity exists in the
application.

Parameter entries sort by name. Selection entries at every object level sort
by output key. Literal membership values are canonical semantic sets: codec
validation runs first, then duplicate canonical values are removed and the
remaining values sort by canonical scalar bytes. Empty sets remain encoded and
have the constant semantics from section 9. Order terms and boolean children
preserve authored order. All semantic references use complete member identities.

Parameter names and output keys use one 1-to-63-character lower-camel ASCII
segment from the Qualified Resource Name grammar, with no dots. Every
name/key/identity sort in this protocol compares raw ASCII bytes ascending; it
never calls `localeCompare`. The normalizer inserts the current Schema
Projection and Data Contract Projection Digests. Authors cannot provide or
override either value. This binds Constraint and Index structure as well as
runtime codecs and Relations without copying their definitions into the Query.

Artifact JSON uses RFC 8785 JSON Canonicalization Scheme bytes plus one final
LF and the scalar validation rules from schema artifact v1. The Query Template
Digest is lowercase SHA-256 over those bytes prefixed by
`questpie-data-query-template-v1\0`.

### Binding and cursor

```ts
interface DataQueryBindingV1 {
	templateDigest: string;
	values: Array<{
		parameter: string;
		value: null | boolean | number | string | Array<boolean | number | string>;
	}>;
}

interface DataQueryScopeV1 {
	format: "questpie.data-query-scope";
	version: 1;
	templateDigest: string;
	values: Array<{
		parameter: string;
		value: null | boolean | number | string | Array<boolean | number | string>;
	}>;
}

interface DataCursorV1 {
	format: "questpie.data-cursor";
	version: 1;
	templateDigest: string;
	scopeDigest: string;
	order: Array<{
		field: `collection:${string}/field:${string}`;
		value: null | boolean | number | string;
	}>;
}

interface DataCursorV2 {
	format: "questpie.data-cursor";
	version: 2;
	templateDigest: string;
	scopeDigest: string;
	policyScopeDigest: string;
	order: Array<{
		field: `collection:${string}/field:${string}`;
		value: null | boolean | number | string;
	}>;
}
```

`DataQueryBindingV1` is a normalized in-memory execution value, not a
standalone canonical artifact. It has no format tag, version, digest domain, or
persisted identity. Its `values` still use the canonical scalar representations
and deterministic parameter order for logging and execution.

Binding values sort by parameter name and contain every declared parameter.
List values are validated against their scalar codec and authored
`maximumItems`, then deduplicated and sorted by canonical scalar bytes before
entering Binding or Scope bytes. Empty arrays remain valid. The bound array
length is checked before deduplication so duplicates cannot bypass the bound.
`DataQueryScopeV1` contains only parameters used by filter operands or Relation
predicates. Pagination parameters are excluded; a cursor remains valid when a
caller changes `first`, but never when it changes a filter value. A parameter
used in both pagination and a filter is invalid.

That v1 statement covers template parameters only. A cursor is valid only
inside one Policy-equivalent execution scope. The Principal/Authority/Policy
vertical must either version `questpie.data-query-scope` to include every
Policy-injected input, including immutable Tenant facts, or add a sibling
policy-scope digest to a versioned Cursor. It cannot reinterpret v1 scope bytes
or allow one Principal's cursor to validate for a non-equivalent Policy scope.

The Policy vertical chooses the sibling form. A Policy-protected Query emits
`DataCursorV2`; `policyScopeDigest` is the digest of
`PolicyCursorScopeV1` from the Context and Policy contract. `DataCursorV1`
remains frozen as foundational protocol and proof authority; this revision
creates no Policy-free execution surface. The Runtime never upgrades a v1
token for a Policy-protected Query.

Exactly one parameter has `kind: "cursor"`; it is nullable and must be the
parameter referenced by `page.after`. `page.first` references one non-nullable
integer parameter used nowhere else. That integer codec must declare
`minimum >= 1` and `maximum <= 100`. The later Runtime can configure a lower
per-execution maximum; exceeding that lower bound is `QP-DATA-012` at binding,
not a template rewrite.

`100` is the closed v1 protocol ceiling for one structural page. It caps row
decoding, nested projection, and dependency observation before any lower
deployment limit. Raising it changes template validation and requires a
protocol decision, not a configuration edit.

The Scope Digest uses canonical scope bytes with prefix
`questpie-data-query-scope-v1\0`. A cursor is unpadded base64url of its exact
canonical bytes. The accepted `DataCursorV1` encoding remains unchanged;
`DataCursorV2` uses RFC 8785 canonical JSON bytes plus one LF. A cursor is
opaque, deterministic, and not a bearer credential.
The Runtime validates it completely and treats a mismatch as an invalid cursor,
never as authority. The template digest transitively covers
both projection digests, so a schema Constraint/Index change or a Field codec,
nullability, Relation, or other Data Contract change invalidates outstanding
cursors before comparison. This conservative invalidation is intentional,
including for an inert change outside the Query's dependency set.

Changing authored boolean order, an output alias, explicit null placement, or
another byte in the template also invalidates outstanding cursors. Clients
observe the closed cursor-mismatch error and restart from `after: null`;
QUESTPIE never guesses compatibility across templates. Cursor order values are
all also selected output Fields. `scopeDigest` is a one-way digest over bound
non-pagination parameters; the requesting cursor holder supplied those values,
but forwarding the token can permit offline confirmation of guessed
low-entropy values. A transport that shares cursors across Principals must
authenticate or encrypt the token. It cannot change the decoded comparison
tuple or use the token as Authority.

The encoded cursor is at most 2,048 ASCII bytes in v1 and v2. The compiler
rejects a template whose maximum identity/codec envelope cannot fit, including
the v2 `policyScopeDigest`, and the Runtime rejects a larger token as
`QP-DATA-010` before decoding. A later compact or encrypted representation
requires a versioned cursor protocol.

## 12. Data Contract Projection and Definition Contract bytes

The accepted `CompiledManifestV1` gains one required `data` member beside
`composition` and `schema`. Its `format: "questpie.manifest"` and `version: 1`
remain unchanged because the accepted architecture defines no Compiled Manifest
Digest and already anticipates later semantic members. Existing v1 readers must
be updated to require `data`; this is the explicit supersession recorded in the
naming audit. `.questpie/generated/manifest.json` gains the member while the
generated file list stays unchanged. It describes runtime data semantics
without changing schema history:

```ts
interface DataContractProjectionV1 {
	format: "questpie.data-contract-projection";
	version: 1;
	applicationIdentity: `application:${string}`;
	collections: Array<{
		identity: `collection:${string}`;
		primaryKey: {
			identity: `collection:${string}/constraint:${string}`;
			fields: FieldIdentityV1[];
		};
		fields: Array<{
			identity: FieldIdentityV1;
			path: FieldPathV1;
			codec: FieldCodecV1;
			nullable: boolean;
			hasDefault: boolean;
		}>;
		relations: Array<
			| {
					kind: "toOne";
					identity: `collection:${string}/relation:${string}`;
					target: `collection:${string}`;
					fields: Array<`collection:${string}/field:${string}`>;
					references: Array<`collection:${string}/field:${string}`>;
			  }
			| {
					kind: "toMany";
					identity: `collection:${string}/relation:${string}`;
					inverseOf: `collection:${string}/relation:${string}`;
					target: `collection:${string}`;
			  }
		>;
	}>;
}

type FieldCodecV1 =
	| ScalarCodecV1
	| { kind: "object"; properties: EmbeddedPropertyV1[] }
	| {
			kind: "array";
			maximumItems: number;
			items: EmbeddedValueCodecV1;
	  }
	| { kind: "json" };
```

Collections, Fields, and Relations sort by semantic identity. `toOne` data
facts must match the corresponding `RelationManifestV1`; the compiler emits no
duplicate actions or physical names here. A `toMany` appears only here.
The mandatory `primaryKey` repeats only the one resolved regular-Collection key
needed by Data consumers. Other Constraint and Index structure remains
authoritative in Schema Projection; query total-order validation references
those identities rather than copying their definitions.

Data Contract Projection JSON uses RFC 8785 plus LF. Its digest is lowercase
SHA-256 over those exact bytes prefixed by
`questpie-data-contract-projection-v1\0`. The Compiled Manifest stores the
projection; no separate Compiled Manifest Digest is claimed. The generated
App Contract and every normalized Query Template come from the same
projection.

One owner or Augmentation structural contract is normalized before the generic
`questpie-structural-contract-v1\0` digest defined by
`definition-composition.md`. Collection contracts use these exact local
member payloads:

```ts
type LocalCheckExpressionV1 =
	| { kind: "field"; field: FieldPathV1 }
	| { kind: "literal"; value: null | boolean | number | string }
	| { kind: "textLength"; expression: LocalCheckExpressionV1 }
	| {
			kind: "compare";
			operator:
				| "equal"
				| "notEqual"
				| "lessThan"
				| "lessThanOrEqual"
				| "greaterThan"
				| "greaterThanOrEqual";
			left: LocalCheckExpressionV1;
			right: LocalCheckExpressionV1;
	  }
	| { kind: "and" | "or"; expressions: LocalCheckExpressionV1[] }
	| { kind: "not"; expression: LocalCheckExpressionV1 }
	| { kind: "isNull" | "isNotNull"; expression: LocalCheckExpressionV1 };

interface FieldMemberContractV1 {
	path: FieldPathV1;
	type: FieldTypeV1;
	nullable: boolean;
	default:
		| null
		| { kind: "literal"; value: null | boolean | number | string }
		| { kind: "randomUuid" | "now" };
	postgresName: string | null;
}

type ConstraintMemberContractV1 =
	| {
			kind: "primaryKey" | "unique";
			fields: FieldPathV1[];
			postgresName: string | null;
	  }
	| {
			kind: "check";
			expression: LocalCheckExpressionV1;
			postgresName: string | null;
	  };

interface IndexMemberContractV1 {
	kind: "btree";
	fields: Array<{
		field: FieldPathV1;
		order: "asc" | "desc";
		nulls: "first" | "last";
	}>;
	postgresName: string | null;
}

type RelationMemberContractV1 =
	| {
			kind: "toOne";
			target: `collection:${string}`;
			fields: FieldPathV1[];
			references: FieldPathV1[];
			onDelete: "restrict" | "cascade" | "setNull" | "noAction";
			onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
			postgresName: string | null;
	  }
	| {
			kind: "toMany";
			inverseOf: `collection:${string}/relation:${string}`;
	  };

interface CollectionDefinitionContractV1 {
	format: "questpie.collection-definition-contract";
	version: 1;
	name: string;
	postgresName: string | null;
	fields: FieldMemberContractV1[];
	constraints: Array<{
		key: string;
		contract: ConstraintMemberContractV1;
	}>;
	indexes: Array<{ key: string; contract: IndexMemberContractV1 }>;
	relations: Array<{ key: string; contract: RelationMemberContractV1 }>;
	augmentations: ContributionIdentityV1[];
}

interface CollectionAugmentationContractV1 {
	format: "questpie.collection-augmentation-contract";
	version: 1;
	name: string;
	fields: FieldMemberContractV1[];
	constraints: Array<{
		key: string;
		contract: ConstraintMemberContractV1;
	}>;
	indexes: Array<{ key: string; contract: IndexMemberContractV1 }>;
}
```

`LocalCheckExpressionV1` is the accepted `CheckExpressionV1` grammar before
semantic identity resolution. Its only permitted difference is that a Field
node stores one local canonical path instead of a fully qualified Field identity.
Operators, literal values, boolean sequence semantics, and closed variants are
the same source of truth; changing the accepted check union versions both
representations together.

Field contracts sort by canonical path bytes; other member arrays sort by key.
At authoring time a one-segment Field reference is the ergonomic string
`"id"`; nested references use segment tuples such as `["address", "city"]`.
Both normalize to `FieldPathV1`, so no canonical contract stores or parses a
dotted string. `augmentations` stores complete accepted Contribution
Identity strings and sorts by those exact bytes. Each member contract is one
closed tagged union containing the exact
authoring options already normalized into Schema Projection plus the inverse
Relation identity. Local member keys are validated lower-camel ASCII strings;
direct Definition values and `relationRef` values normalize to semantic identity
before encoding. A contract contains no Origin, export name, physical target
object, function, ORM value, or generated App type.

An inline `postgres: { name }` becomes `postgresName`. An application-level
`questpie.json` physical-name override does not change Package source or its
Package Inventory digest; it enters application configuration and the resolved
Schema Projection through the accepted override path. Collection Augmentation
has no Relation member in v1.

Package Inventory uses the digest of these exact bytes. The compiler compares
the declaration-level invariant contract with the evaluated value, resolves
accepted Augmentations, and emits the Data Contract Projection and unchanged
Schema Projection into the Compiled Manifest. This gives Package acceptance,
semantic Manifest bytes, schema bytes, and generated types one traceable input
without making contribution identity part of migration history.

The compiler also requires exactly one `primaryKey` entry after Owner and
accepted Augmentations resolve. Its authored map key supplies the stable named
Constraint identity. `id` remains an ordinary Field and neither `field.id()`
nor `primaryKey: true` exists in this contract.

## 13. Golden bytes

The semantic proof owns executable golden fixtures. The abbreviated
presentation below shows the smallest readable shape and therefore hashes to
different bytes than the expanded witness; it is not a digest test vector. The
exact expanded Barbershop vectors, expected digests, canonical compact JSON plus LF, and
assertions live in `query-grammar-goldens.mjs` on the proof branch.

Minimal normalized Query Template:

```json
{
	"dataContractProjectionDigest": "<current-data-contract-projection-digest>",
	"filter": {
		"field": "collection:appointments/field:tenantId",
		"kind": "equal",
		"operand": { "kind": "parameter", "parameter": "tenantId" }
	},
	"format": "questpie.data-query-template",
	"from": "collection:appointments",
	"order": [
		{
			"direction": "asc",
			"field": "collection:appointments/field:startsAt",
			"nulls": "last"
		},
		{
			"direction": "asc",
			"field": "collection:appointments/field:id",
			"nulls": "last"
		}
	],
	"page": {
		"after": { "kind": "parameter", "parameter": "after" },
		"first": { "kind": "parameter", "parameter": "first" },
		"kind": "forwardCursor",
		"uniqueConstraint": "collection:appointments/constraint:primary"
	},
	"parameters": [
		{
			"kind": "cursor",
			"name": "after",
			"nullable": true
		},
		{
			"codec": { "kind": "integer", "maximum": 100, "minimum": 1 },
			"kind": "scalar",
			"name": "first",
			"nullable": false
		},
		{
			"codec": { "kind": "uuid" },
			"kind": "scalar",
			"name": "tenantId",
			"nullable": false
		}
	],
	"schemaProjectionDigest": "<current-schema-projection-digest>",
	"select": [
		{
			"field": "collection:appointments/field:id",
			"key": "id",
			"kind": "field"
		},
		{
			"field": "collection:appointments/field:startsAt",
			"key": "startsAt",
			"kind": "field"
		}
	],
	"version": 1
}
```

The expanded executable vector also includes a target-scoped Relation
predicate plus a bounded `statuses` list parameter and therefore puts
`statuses`, `tenantId`, and `tenantSlug`, but not `first` or `after`, in its
first-page scope. Its cursor order contains `startsAt` and `id`.
The fixed witness values are:

| Value                                    | Exact revision 6 golden                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Nested Schema Projection Digest          | `8b5d0008a746caa3ae3f3a21a2b7452af9374b2d1cb86b72841aef7062f38182` |
| Schema Projection Digest                 | `9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033` |
| Data Contract Projection Digest          | `0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f` |
| Data Contract Projection without inverse | `61b4c2cd703ae57dc86fd785e6060dedfaec84d7d2cb466f8267edb883ec3a55` |
| Query Template Digest                    | `a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1` |
| Text-order Query Template Digest         | `26760166c633b97035223b7c2128e143ee5c4e28eb56fb5c06fb55290210bffb` |
| Scope Digest                             | `89eddbbbe23f6791c5b43acb25aed79c46dbbdc9f8307bf3bf79da8628762215` |
| Dependency Template Digest               | `210dbd260d5e9597b93e3c5d3168e685267574e3bf4aae37758ea41ba73aeb89` |
| Inverse dependency shape witness         | `36b3d95acafe74a371cd19d781b9b39ff67c8fa15c2d239740ff9dcfb48d1ac4` |
| Tenant contract without inverse          | `a1058368accd86e26bd49d8cef3352a1b1684d9f79276cfaf9567374aa59bbc3` |
| Tenant contract with inverse             | `9edfb1e99500008fb321c238f2d993eecf567d737dc4fb28213d7195b2fded25` |

The cursor golden is the unpadded base64url encoding of the exact cursor bytes;
the executable fixture pins the complete value rather than duplicating its
long transport string here. Reordering authored parameter or select object
members does not change Query bytes. Reordering `order` or boolean children,
changing null placement, renaming an output key, changing a parameter bound,
or changing a Relation identity does.

The nested golden includes an inline leaf, typed JSONB object and bounded array,
open JSON, canonical path arrays, exactly one primary key, and a distinct tagged
top-level JSON-null value. It contains one Collection and therefore proves that
none of those forms synthesizes a hidden mini-Collection. The Barbershop Schema
Projection witness cannot represent an inverse `toMany`, so
its invariance is guaranteed by the closed projection type rather than a
tautological clone assertion. The fixture separately removes the inverse from
the Data Contract Projection and proves that digest changes. The inverse
dependency value is deliberately a shape witness: its
`queryTemplateDigest` is a labelled placeholder, not the digest of a second
normalized Query Template. Its read set is nevertheless complete for the
witness shape, including the inverse join, cursor/order roles, and page read.
The fixture also supplies two qualifying Constraints in reverse identity order
and proves that the normalizer selects the lowest ASCII semantic identity.

## 14. Declared and observed dependency semantics

The structural lowerer derives a dependency template from the normalized Query.
Authors cannot edit or widen it through a generic flag.

```ts
interface DataQueryDependencyTemplateV1 {
	format: "questpie.data-query-dependency-template";
	version: 1;
	queryTemplateDigest: string;
	reads: Array<
		| {
				kind: "collection";
				collection: `collection:${string}`;
				fields: Array<{
					field: `collection:${string}/field:${string}`;
					roles: Array<
						| "cursor"
						| "filter"
						| "joinLocal"
						| "joinReferenced"
						| "order"
						| "output"
					>;
				}>;
		  }
		| {
				kind: "relation";
				relation: `collection:${string}/relation:${string}`;
				source: `collection:${string}`;
				target: `collection:${string}`;
				fields: Array<`collection:${string}/field:${string}`>;
				references: Array<`collection:${string}/field:${string}`>;
		  }
		| {
				kind: "page";
				collection: `collection:${string}`;
				orderFields: Array<`collection:${string}/field:${string}`>;
				uniqueConstraint: `collection:${string}/constraint:${string}`;
				direction: "forward";
		  }
	>;
}
```

Collection reads include selected, filtered, ordered, cursor-key, and Relation
join Fields without erasing why each Field was read. A Field entry occurs once
and its semantic-set `roles` sort by the literal role bytes above. Every
Relation selection or predicate emits separate source and target Collection
reads plus one Relation read, even when no related row matches. Relation reads
include both endpoint Collections and every local and referenced key. Page
reads include the complete order and qualifying unique Constraint.

Role names are relative to the emitted read, not to physical foreign-key
ownership. `output` produces a selected value; `filter` evaluates a predicate;
`order` determines row order; and `cursor` is encoded into or compared with a
page boundary. `joinLocal` marks a Field listed in that emitted Relation read's
`fields`; `joinReferenced` marks a Field listed in its `references`. Therefore
an inverse traversal can assign `joinLocal` to the owning `toOne`'s referenced
key and `joinReferenced` to its physical foreign-key Field. This apparent swap
is intentional: the Relation read is oriented from its declared `source` to
its `target`.

For an owning `toOne`, the Relation read uses that member identity, its
declaring Collection as `source`, its target Collection as `target`, local
Fields as `fields`, and referenced Fields as `references`. For an inverse
`toMany` predicate, `relation` is the inverse member identity, `source` is the
inverse's declaring Collection, and `target` is the related Collection. Its
`fields` are the underlying owning `toOne`'s referenced Fields and its
`references` are that `toOne`'s local Fields, each preserving the owning
Constraint's declared order. This expresses traversal orientation without
pretending that the inverse owns another foreign key.

Reads sort by `kind` bytes, then collection identity for `collection` and
`page`, or Relation identity for `relation`; a remaining tie uses the canonical
entry bytes. Collection Field entries sort by Field identity. `orderFields`
preserves semantic sequence.

Dependency Template JSON uses RFC 8785 plus LF. Its optional diagnostic digest
uses lowercase SHA-256 over those bytes prefixed by
`questpie-data-query-dependency-template-v1\0`; the Runtime keys the declared
template by its mandatory `queryTemplateDigest`, not by mutable observation.

At execution, the Runtime must enrich this declared template with the bound
scope, returned primary keys, first and last order tuples, sentinel presence,
and actual traversed endpoint keys. Those observed facts must be replaced after
each recomputation. The later Live Query grill decides the exact persisted
dependency record and invalidation matching algorithm, but it cannot omit a
declared collection, Relation endpoint, join key, order Field, cursor boundary,
or sentinel read from this template.

A Policy compiler can add reads to the execution dependency set later; it
cannot remove structural reads. Tenant is a later immutable Execution fact and
must enter dependencies when a Policy or query parameter actually reads it.
This document introduces no implicit tenant filter.

## 15. PostgreSQL escape hatch boundary

The product needs a named native PostgreSQL escape hatch, but accepting its
call signature before Policy and Operation authority would create a bypass.
V1 therefore reserves this bounded contract without exposing it yet:

- it is a separate query kind and cannot appear inside `DataQueryTemplateV1`;
- it accepts PostgreSQL SQL, closed scalar parameter codecs, an explicit runtime
  row codec, and an explicit dependency declaration;
- it exposes no Drizzle, Kysely, driver, pool, or transaction type;
- it loses automatic Relation lowering, generated selection inference, and
  portability;
- it is not Policy-safe or Live-Query-safe merely because it declares rows;
- it cannot be watched without the future observer accepting its complete
  dependency declaration;
- its future authority gate must be explicit and capability scoped; a generic
  `unsafe`, `skipPolicy`, `raw`, or `force` boolean is rejected.

`DataQueryDependencyTemplateV1` always keys structural reads by its mandatory
`queryTemplateDigest`; a native statement has no such digest. The escape hatch
therefore requires its own versioned native-statement dependency artifact keyed
by a statement digest. It cannot masquerade as a structural Query or force a
second source variant into the already closed data-query dependency format.

The Policy/Operation grill must either provide the exact authority and Policy
contract or keep native PostgreSQL unavailable to ordinary application Queries.
This unresolved API cannot change structural Query bytes or generated row types.

This reservation also covers extension-backed needs such as pgvector, PostGIS,
TimescaleDB, and custom PostgreSQL indexes. The application can already declare
an extension dependency, but schema artifact v1 cannot model those Fields,
operators, indexes, or table transformations. A later focused capability must
choose one of two honest paths: managed versioned artifacts with complete
lowering/introspection/drift proof, or explicitly external PostgreSQL objects
with named lost schema guarantees. It cannot route DDL around Committed
Migration history or expose the private query engine as the public contract.

The private lowerer can be Kysely, Drizzle, or a focused PostgreSQL compiler
only after the engine bake-off. That choice cannot remove these escape-hatch
requirements or enter ordinary Definition and generated App Contract types.

### Closed data diagnostics

Compile-time data diagnostics use exit code `2`. Bind and execute failures are
stable Runtime errors where CLI exit codes do not apply. They reuse the
accepted diagnostic envelope:

In that shared envelope, `blocking` describes build/deploy progression rather
than whether the current request succeeds. A bind or execute error terminates
the current Query request and still uses `blocking: "none"` because it neither
invalidates compiled artifacts nor blocks a later deployment. The shared
composition contract uses the same meaning.

```ts
type DataDiagnosticCodeV1 =
	| "QP-DATA-001"
	| "QP-DATA-002"
	| "QP-DATA-003"
	| "QP-DATA-004"
	| "QP-DATA-005"
	| "QP-DATA-006"
	| "QP-DATA-007"
	| "QP-DATA-008"
	| "QP-DATA-009"
	| "QP-DATA-010"
	| "QP-DATA-011"
	| "QP-DATA-012"
	| "QP-DATA-013"
	| "QP-DATA-014";

type DataDiagnosticClassV1 =
	| "invalidScalarValue"
	| "invalidQueryShape"
	| "invalidRelationReference"
	| "invalidFieldScope"
	| "invalidOperator"
	| "invalidSetOperand"
	| "nonTotalOrder"
	| "orderFieldNotSelected"
	| "invalidPageParameter"
	| "invalidCursor"
	| "cursorTemplateMismatch"
	| "executionLimitExceeded"
	| "cursorScopeMismatch"
	| "invalidParameterReference";

interface DataDiagnosticV1 extends QuestpieDiagnosticBaseV1 {
	code: DataDiagnosticCodeV1;
	class: DataDiagnosticClassV1;
	severity: "error";
	blocking: "none" | "fatal";
	phase: "compile" | "bind" | "execute";
}
```

| Code          | Class                       | Phase                  | Blocking      | Trigger                                                                                                                                     |
| ------------- | --------------------------- | ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `QP-DATA-001` | `invalidScalarValue`        | compile, bind, execute | fatal or none | A literal, binding, returned row, or cursor value fails its exact scalar codec.                                                             |
| `QP-DATA-002` | `invalidQueryShape`         | compile                | fatal         | A required clause is absent; a select is empty; outputs duplicate a key; or a node is invalid.                                              |
| `QP-DATA-003` | `invalidRelationReference`  | compile                | fatal         | A resolved Relation has the wrong cardinality, Owner, or declaring target.                                                                  |
| `QP-DATA-004` | `invalidFieldScope`         | compile                | fatal         | A root or nested expression uses a Field from another Collection scope.                                                                     |
| `QP-DATA-005` | `invalidOperator`           | compile                | fatal         | A Field kind does not support the requested public operator.                                                                                |
| `QP-DATA-006` | `invalidSetOperand`         | compile or bind        | fatal or none | `in`/`notIn` contains null, has an incompatible codec, uses a non-list parameter, or exceeds its declared bound.                            |
| `QP-DATA-007` | `nonTotalOrder`             | compile                | fatal         | Order is empty, duplicates a Field, or does not end in a qualifying non-null primary/unique key.                                            |
| `QP-DATA-008` | `orderFieldNotSelected`     | compile                | fatal         | An order Field has no direct selected output.                                                                                               |
| `QP-DATA-009` | `invalidPageParameter`      | compile                | fatal         | Cursor/first parameter count, role, codec, or declared bounds are invalid.                                                                  |
| `QP-DATA-010` | `invalidCursor`             | bind                   | none          | Cursor base64url, JSON, version, arity, identity, or scalar shape is invalid.                                                               |
| `QP-DATA-011` | `cursorTemplateMismatch`    | bind                   | none          | Cursor and current Query Template Digest differ, including a Data Contract change.                                                          |
| `QP-DATA-012` | `executionLimitExceeded`    | bind                   | none          | A valid binding exceeds the Runtime's configured row/page limit before a database read.                                                     |
| `QP-DATA-013` | `cursorScopeMismatch`       | bind                   | none          | For v1, Cursor and current template-parameter scope differ. For v2, the Query-parameter scope or Policy-equivalent execution scope differs. |
| `QP-DATA-014` | `invalidParameterReference` | compile or bind        | fatal or none | A parameter name violates the 1-to-63 lower-camel grammar, or a parameter is missing, duplicated, unused, incompatible, or supplied twice.  |

An unresolved typed Relation reference is `QP-COMPOSE-004`. A resolved
reference with wrong cardinality, Owner, or declaring target is `QP-DATA-003`.
Invalid Field lists or reference targets inside schema-owning `relation.toOne`
remain `QP-SCHEMA-003`. Runtime diagnostics set `blocking: "none"`; compile
diagnostics set `blocking: "fatal"`, matching shared-envelope exit code `2`.

The registry is closed for this v1 protocol. A later Policy rejection for
non-pushdown pagination belongs to the Policy diagnostic registry, not a new
unregistered `QP-DATA-*` code.

The code/class envelope remains v1 when validating `DataCursorV2`; only the
versioned trigger for `QP-DATA-013` is extended. A v1 cursor supplied to a
Policy-protected Query has the wrong version and shape and is
`QP-DATA-010 invalidCursor`. V2 validation checks exact bytes and shape first,
then the Template Digest, then both scope digests, all before SQL. The two scope
mismatches intentionally share one external result.

## 16. Hostile-case matrix and proofs

| Case                                                     | Required behavior                                                                 | Evidence today                                                         | Required before implementation   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| Reorder parameter or selection object keys               | Same canonical Query bytes                                                        | executable golden                                                      | normalizer integration fixture   |
| Reorder boolean children or order terms                  | Different canonical Query bytes                                                   | executable golden                                                      | normalizer integration fixture   |
| Omit order or pagination                                 | Template rejected                                                                 | none                                                                   | normalizer fixture               |
| Order lacks non-null unique suffix                       | Template rejected with available keys                                             | guided proof                                                           | diagnostic fixture               |
| Nullable unique suffix                                   | Template rejected                                                                 | generic descriptor type proof                                          | Runtime/schema validator fixture |
| Duplicate order Field                                    | Template rejected                                                                 | none                                                                   | normalizer fixture               |
| Cursor belongs to another template                       | Bind rejected before database read                                                | guided proof                                                           | cursor fixture                   |
| Cursor uses another template-parameter scope             | Bind rejected before database read                                                | guided proof                                                           | cursor fixture                   |
| Cursor has wrong scalar codec or order arity             | Bind rejected                                                                     | partial interactive validator                                          | full codec fixture               |
| Boundary row ties on non-key order Field                 | Unique suffix selects exact exclusive successor                                   | free-play proof                                                        | PostgreSQL lowering fixture      |
| Boundary value is null under both null placements        | Closed term comparator returns exact successor set                                | executable golden                                                      | PostgreSQL SQL golden            |
| Insert before, inside, or after current page             | Recompute replaces visible boundary state                                         | guided proof                                                           | Live Query fixture               |
| `toOne` local key is null                                | Nested result is null; `exists` false; `notExists` true                           | type only                                                              | Relation Runtime fixture         |
| Inverse points to a missing or wrong target Relation     | Compile fails; no Data Contract Projection                                        | none                                                                   | compiler fixture                 |
| Package Owner adds a `toMany` inverse only               | Package contract/Data Contract change; real Schema Projection cannot represent it | executable Data/contract deltas plus schema invariance by construction | compiler integration fixture     |
| Inverse `toMany` predicate                               | Declaring/related endpoints and owning keys orient exactly                        | complete dependency shape witness with placeholder Query digest        | observed no-match fixture        |
| Polymorphic target request                               | Unsupported, never serialized as schema v1                                        | none                                                                   | contract fixture                 |
| `equal(null)`, null list member, or wrong parameter kind | Compile/bind fails; empty membership remains the documented constant              | executable set normalization plus type proof                           | Runtime operator fixture         |
| Regular Collection has zero or two primary keys          | Compile fails before projection                                                   | executable golden                                                      | compiler diagnostic fixture      |
| SQL `NULL` versus top-level JSON `null`                  | Tagged JSON value remains distinct at every boundary                              | semantic and TypeScript proofs                                         | runtime codec fixture            |
| Nested path uses `"address.city"`                        | Never split; differs from `["address", "city"]`                                   | executable golden                                                      | compiler diagnostic fixture      |
| Bigint/numeric round-trip                                | Exact canonical strings preserved in filter, cursor, and row                      | none                                                                   | codec fixture                    |
| Relation filter reads no matching row                    | Target Collection and Relation remain declared                                    | derived compound-filter empty-result proof                             | observed dependency fixture      |
| `first` exceeds declared or Runtime bound                | Explicit limit diagnostic                                                         | guided proof                                                           | binding fixture                  |
| Raw SQL has no dependency declaration                    | Cannot become watchable                                                           | contract reservation                                                   | future Policy/Live Query gate    |

### Semantic proof

The one proof question is:

> Can this one closed Query model express exact selection, filtering, stable
> ordering, forward pagination, and one-hop Relation traversal while producing
> deterministic Query bytes and a complete declared dependency template?

The self-contained prototype lives only on throwaway branch
`feat/v4-query-grammar-proof` at
`docs/v4/prototypes/query-grammar-proof.html`. It provides free-play data and
binding controls, guided hostile cases, and visible normalized Query, scope,
cursor, result, and dependency state. It is evidence, not public API.

Revision 1 proof commit: `5240041f` on
`feat/v4-query-grammar-proof`.

Verdict: survived. The prototype demonstrated one normalized Query and one
derived dependency template across six guided cases: semantic-set key
permutation, a tie resolved by the explicit primary-key suffix, missing unique
suffix rejection, cursor scope rejection, an empty result that retained all
declared reads, and a page-window shift after an insert. During the proof, a
target Field was initially assigned to the source Collection dependency; the
visible state exposed the error and the corrected model now emits separate
source and target Collection reads plus the Relation read.

Revision 2 proof commits: `0317812a` and `9258e9be` on
`feat/v4-query-grammar-proof`. The second Opus review returned `REVISE`, not
`FALSIFIED`, with 15 blockers. It confirmed the scope digest and decoded cursor
exactly, while exposing null-boundary, Policy scope, inverse dependency,
diagnostic, compiler reachability, naming, and proof-coverage gaps.

Revision 3 proof commits: `33c1286f` and diagnostic follow-up `024d3b95` on the
same branch. The executable witness
now pins a real accepted `SchemaProjectionV1`, Data Contract, Query, scope,
cursor, owning and inverse dependency, and Collection Definition Contract
bytes. It covers authored-set versus sequence behavior and the closed nullable
term comparator under `NULLS FIRST` and `NULLS LAST`. These are exact byte and
pure-rule witnesses, not a claim that a production normalizer exists. The
interactive proof derives compound scalar/Relation-filter dependencies,
sorts reads by the documented rule, accepts UUIDv7-shaped values, and keeps ten
guided cases. A local uncommitted Node plus jsdom smoke exercised every step
without script errors; it is reported only as local structural evidence, not a
reproducible committed harness or real-browser QA.

Revision 4 proof commits: `f92ec315` and `f5816097`. The latter is the exact
provenance for every digest in section 13 and for the final semantic witness.
It adds the real accepted schema checks and physical names, a differential Data
Contract projection, a complete inverse dependency shape, and the synthetic
two-candidate Constraint witness for the lowest-identity tie rule. That
synthetic alternate Constraint tests the pure rule; it is not claimed to exist
in the Barbershop Schema Projection.

Revision 6 proof commits: `b77a2524`, empty-literal alignment `ad046596`,
primary-key projection `26cd3380`, and canonical Field-contract paths
`d03358b7`. They replace the interrupted environment
order context with fixed `questpie.binary`, adds path arrays to schema and data
goldens, pins a nested Schema Projection for inline/object/array/open-JSON
models, distinguishes SQL `NULL` from tagged top-level JSON `null`, and rejects
regular Collections with zero or multiple primary keys. Query and scope bytes
cover bounded canonical-set list parameters, including empty bindings.

### TypeScript proof

If the semantic proof survives, a separate fixture must prove:

- exact nullable/non-null read rows;
- insert optionality from nullability and defaults;
- update patch value shapes;
- scalar selection aliases;
- nullable one-hop `toOne` selection;
- `exists`/`notExists` typing over owning `toOne` and inverse `toMany`;
- `in`/`notIn` literal tuple typing plus bounded runtime list parameters;
- composite and nullable-key total-order diagnostics;
- distinct timestamp-without-zone and timestamptz codecs;
- bounded literal Collection Augmentation tuple folding;
- exact Query parameters and connection result;
- rejection of a wrong Field operator and wrong parameter kind;
- a self-contained fixture with no ORM symbol, ambient registry, `any`, or
  application-wide recursive generic;
- at most 25,000 TypeScript instantiations for the isolated fixture under the
  repository's pinned TypeScript 5.9.2.

The 25,000 limit is a proof-fixture budget, not the still-open complete tracer
budget in `SPEC.md`.

Revision 1 fixture commit: `95a98d44` on
`feat/v4-query-grammar-proof`.

Command:

```bash
bun node_modules/typescript/bin/tsc \
	-p docs/v4/prototypes/query-grammar-types/tsconfig.json \
	--extendedDiagnostics
```

TypeScript 5.9.2 reported 730 Types, 1,498 Instantiations, 25,139K memory, and
0.18 seconds total time. All exact positive assertions and expected negative
operator/binding assertions passed. Verdict: survived with 23,502
instantiations of headroom.

Revision 2 fixture commit: `0317812a` used a monomorphized builder and branded
timestamp values, so its 2,134-instantiation result does not license the public
API shown here.

Revision 3 fixture commit: `33c1286f` established the two-stage direction but
predates the descriptor repairs below.

Revision 4 fixture commits: `f92ec315` and `f5816097`; all final measurements
refer to `f5816097`. The fixture uses the documented two-stage
`dataQuery<Collection>()({...})` shape, exact generated `from`, plain `string`
timestamp values with distinct codec tags, derived selected-order Fields,
Relation predicates, and the literal Augmentation tuple. TypeScript 5.9.2
now reports 2,319 Types, 5,136 Instantiations, 25,420K memory, and 0.28 seconds.
The generic builder derives Field operators, Relation target scope, selected
output, and qualifying unique suffixes from the supplied generated descriptor;
only the fixture's concrete descriptor names the Barbershop Fields. It uses the
documented fluent `orderBy`, `query.forwardCursor`, `where: null`, descending
order, output aliases, duplicate selection of one Field, and arbitrary page
parameter names. It rejects an extra nullable scalar parameter, text/UUID range
operators, each independently missing structural clause, and a nullable unique
suffix through the same generic validator. The synthetic composite witness
proves suffix and nullability only; it does not claim text cursor eligibility.
All positive and
expected-negative assertions passed, leaving 19,864
instantiations of headroom. Complete application integration remains an
implementation fixture rather than a claim of this isolated budget proof.

At proof head `d03358b7` (TypeScript content at `ad046596`), the expanded fixture also separates logical inline
columns from embedded `value.*` codecs, types closed object/array values, tags
open JSON, admits text ordering only through `questpie.binary`, and accepts
bounded list bindings including an empty array. TypeScript 5.9.2 reports 2,666
Types, 5,770 Instantiations, 25,385K memory, and 0.32 seconds, leaving 19,230
instantiations of headroom.

## 17. Layer map

| Layer               | Contract from this vertical                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring API       | Closed Collection members, explicit inverse Relation, scalar codecs, and pure `dataQuery` template builder.                                                         |
| Discovery/compiler  | Resolve Relation endpoints, validate operators and total order, normalize Definition/member contracts, and derive query/dependency bytes.                           |
| Canonical artifacts | Reopened unreleased Schema Projection v1 plus Data Contract Projection v1, Query Template, scope, cursor, and dependency-template formats; binding is runtime-only. |
| PostgreSQL/Runtime  | Private lowering preserves codecs, three-valued filters, Relation joins, total order, exclusive cursor boundary, and `first + 1` sentinel.                          |
| Protocol/CLI        | Later Query operation protocol transports already-fixed parameter/result/cursor values; CLI can print normalized query and dependency facts.                        |
| Generated client    | Concrete parameter, selected node, nullable `toOne`, and page-info types; no ORM identity.                                                                          |
| Studio/operations   | Later surfaces may inspect the same normalized bytes and dependency facts; they cannot invent an implicit order or Relation.                                        |

## 18. Implementation gates and stop conditions

Implementation remains blocked until all tracer-critical concept gates close.
When this vertical becomes eligible, its smallest queue is:

1. scalar codec and Collection Definition Contract fixtures;
2. Schema and Data Contract Projection dual-artifact goldens;
3. closed expression builders and normalizer;
4. private PostgreSQL lowerer for the accepted operator matrix;
5. Relation resolution and one-hop selection/existence lowering;
6. total-order validator, cursor codec, and forward page lowering;
7. dependency-template derivation;
8. generated concrete row and selection types;
9. Barbershop behavior and budget tests.

Stop and revise this contract if:

- query-only structure changes Schema Projection v1 bytes;
- an authored query type recursively imports the complete application graph;
- a lowerer needs an ORM type in a public declaration;
- a query can execute without explicit order and page structure;
- cursor comparison differs from declared ordering or accepts another scope;
- a Relation traversal lacks one resolved semantic Relation identity;
- a selected, filtered, joined, ordered, boundary, or sentinel read disappears
  from the dependency template;
- Policy or native SQL needs an unscoped bypass flag;
- exact row or selection types require `any`, broad `string`, or ambient
  augmentation;
- the semantic or type proof exceeds its agreed boundary or budget.

## 19. Deferred seams

These choices remain deliberately outside this vertical and cannot alter the
accepted bytes or generated types above:

- Policy injection, field-output filtering, Relation authorization, Principal,
  Tenant, Authority, PostgreSQL grants, and RLS;
- versioned Policy-equivalent cursor scope, including every Policy/Tenant input;
- Query Resource identity, handler and execution context, declared errors,
  transport exposure, and generated client method naming;
- generated Collection CRUD authority, including which capabilities exist in
  server App Context, which are exposed through a transport, and which are
  available to Studio. The Query/Mutation/Route grill must prove one shared
  predicate, selection, ordering, Policy, PostgreSQL-lowering, cursor, and
  dependency grammar across build-time `dataQuery`, runtime Collection CRUD,
  and Studio. These surfaces may differ in binding time and exposure, but they
  cannot become separate execution engines. A runtime CRUD request must
  normalize to the same closed internal Query model and receive an exact
  subscription identity before Live Query can observe it;
- transaction and isolation semantics when one Execution or Live Query
  recomputation performs more than one structural Query;
- Mutation insert/update authorization, immutable keys, transaction behavior,
  retry, and dispatch;
- exact observed Live Query record, Change Ledger matching, checkpoint,
  reconciliation, and subscription limits;
- raw PostgreSQL authority, executable call syntax, and its separate versioned
  statement-dependency artifact;
- Package extensibility and cross-owner Relation contributions; the later
  composition/extensibility grill must decide whether any accepted mechanism
  can add Relation members without reintroducing target-side mutation;
- projected `toMany`, aggregates, computed output, offset/backward/snapshot
  pagination, search, locking, and arbitrary joins;
- every schema Field or Constraint kind beyond the closed v1 set;
- Studio editing or visualization syntax.

None of these seams can reinterpret `DataQueryTemplateV1`, cursor ordering,
scope binding, Data Contract Projection member identity, schema artifact v1, or
the concrete scalar/row/selection types accepted here. A later vertical that
needs such a change must version the affected artifact explicitly.
