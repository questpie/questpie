# QUESTPIE v4 schema lifecycle

- Status: Accepted for the foundational v1 data model
- Date: 2026-08-10
- Projection: verified against public documentation
- Authority: exact contract for schema, migrations, drift, and Seeds

This document defines the foundational v1 schema lifecycle. The Barbershop
application is an end-to-end acceptance example, not the capability boundary
of the framework. This revision reopens the unreleased schema artifact v1 to
include inline column groups, typed JSONB values, and open JSON before its
public contract is frozen. Later slices may add operations, online migration
phases, or existing-database adoption.
They cannot change the identity, checksum, or receipt rules below without a
new accepted decision and an explicit artifact-version migration.

## 1. Decisions

1. One explicit application schema contains every application-owned PostgreSQL
   object. `questpie_internal` is reserved for Runtime state.
2. Collection, Field, Index, Constraint, Relation, Migration, and Seed
   identities are semantic names. File paths and PostgreSQL names are not
   identities.
3. The compiler emits canonical JSON. Arrays with semantic set behavior are
   sorted by identity. There are no timestamps, absolute paths, secrets, or
   compiler build hashes in the Schema Projection.
4. Physical PostgreSQL names are deterministic functions of semantic identity.
   An author can set an explicit physical name, but cannot change identity by
   changing that name.
5. A rename is never guessed. The developer supplies an old-to-new identity
   mapping to the planner. The mapping is preserved in the Committed Migration.
6. Migration planning is database-read-only and writes one explicit generated
   Migration Plan file. Migration creation writes a Committed Migration but
   does not connect to or mutate PostgreSQL. Migration apply executes Committed
   Migrations only.
7. Every v1 migration runs in one PostgreSQL transaction. A statement that
   cannot run in that transaction is unsupported in v1 and blocks the plan.
8. A destructive plan must be accepted by its complete plan digest when the
   Committed Migration is created. Apply never accepts an ad hoc destructive
   flag.
9. A migration checksum covers the exact reviewed metadata, plan, and SQL
   bytes. An already-applied identity with the same checksum is a no-op. The
   same identity with another checksum is fatal history drift.
10. A Seed is an immutable declarative initialization artifact. Its typed data
    steps and Seed Receipt commit in one transaction. A repeated run with the
    same identity and checksum is a no-op.
11. Schema Fingerprint comparison covers the complete application schema. An
    unexpected object in that schema is drift. Objects outside it are ignored
    unless a managed object depends on them.
12. V1 does not provide down migrations, concurrent index creation, arbitrary
    handwritten migration SQL, repeatable mutable Seeds, or automatic adoption
    of an existing schema.
13. Nested authoring has three explicit meanings. `shape.inline` groups ordinary
    columns, `field.object` and `field.array` store closed embedded values in one
    JSONB column, and independent entities use an explicit Collection and
    Relation. Compilation never invents a hidden Collection.
14. Canonical Field paths are non-empty arrays of key segments. Dotted strings
    are never parsed as paths.
15. Every regular Collection has exactly one named primary-key Constraint.
    `id` is an ordinary Field; key semantics come only from
    `constraint.primaryKey`.
16. Every text Field uses semantic collation `questpie.binary`, lowered to
    explicit PostgreSQL collation `C`. Database-default collation never defines
    Data equality, uniqueness, ordering, indexes, or cursors.

## 2. Exact authoring API

The public import is `questpie`. QUESTPIE discovers exported branded Definitions
under the source root accepted by the composition contract. Discovery cannot
change Resource Identity or stored PostgreSQL names.

`questpie.json` contains the non-executable application and PostgreSQL
configuration. `application.name` uses the Qualified Resource Name grammar. It is the
Application Identity used by advisory locks and receipts. `postgres.schema`
uses the physical-name grammar below. After the database contains any Migration
or Seed Receipt, changing either value is blocked in v1. A different value is a
different application and cannot adopt the old receipts or schema implicitly.
`postgres` also requires `minimumMajor: 16`, `databaseCollation`,
`databaseCType`, and an identity-sorted extension-name list. Provider
validation compares those exact locale values and extension presence before
planning or applying.

Independently of the database defaults above, foundational Data text semantics
require `pg_catalog.C`. Before planning, applying, drift comparison, or Query
execution, QUESTPIE resolves that collation, requires `collprovider = 'c'` and
`collisdeterministic = true`, and requires UTF-8 database encoding. It fails
closed rather than substituting `C.UTF-8`, ICU, libc locale, or the database
default.

```ts
// src/data/tenants.ts
import { constraint, defineCollection, field } from "questpie";

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
});
```

```ts
// src/data/appointments.ts
import { constraint, defineCollection, field, index, relation } from "questpie";

import { tenants } from "./tenants";

const appointmentFields = {
	id: field.uuid({ nullable: false, default: "randomUuid" }),
	tenantId: field.uuid({ nullable: false }),
	customerName: field.text({ nullable: false, maxLength: 160 }),
	startsAt: field.timestamp({ nullable: false, withTimezone: true }),
	endsAt: field.timestamp({ nullable: false, withTimezone: true }),
	status: field.text({
		nullable: false,
		maxLength: 24,
		default: "scheduled",
	}),
};

export const appointments = defineCollection({
	name: "appointments",
	fields: appointmentFields,
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		validWindow: constraint.check<typeof appointmentFields>(({ fields }) =>
			fields.endsAt.greaterThan(fields.startsAt),
		),
	},
	indexes: {
		byTenantAndStart: index({
			fields: ["tenantId", { field: "startsAt", order: "asc" }],
		}),
	},
	relations: {
		tenant: relation.toOne({
			target: tenants,
			fields: ["tenantId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
	},
});
```

Nested authoring distinguishes a logical column group from an embedded value:

```ts
// src/data/customers.ts
import { constraint, defineCollection, field, shape, value } from "questpie";

export const customers = defineCollection({
	name: "customers",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),

		// A logical group. Each leaf is an ordinary independently managed column.
		address: shape.inline({
			fields: {
				city: field.text({ nullable: false, maxLength: 160 }),
				postalCode: field.text({ nullable: true, maxLength: 24 }),
			},
		}),

		// One JSONB column whose complete runtime value follows a closed codec.
		preferences: field.object({
			nullable: false,
			properties: {
				locale: value.text({ nullable: false, maxLength: 16 }),
				marketingEmail: value.boolean({ nullable: false }),
				tags: value.array({
					nullable: false,
					items: value.text({ nullable: false, maxLength: 40 }),
					maximumItems: 100,
				}),
			},
		}),

		// One JSONB column with only the recursive JsonValue boundary.
		metadata: field.json({ nullable: true }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
```

`shape.inline` is not a Field and creates no PostgreSQL object. Its leaves use
the complete registered column Field grammar. A future extension-backed Field,
including a spatial or vector Field, can appear inside an inline shape only
after that Field capability defines its authoring codec, projection variant,
SQL lowering, dependencies, migration matrix, and catalog fingerprint. The
inline shape does not itself make PostGIS, pgvector, or another extension
supported.

`field.object` and `field.array` are Fields backed by one `jsonb` column. Their
nested members use the separate `value.*` codec grammar, not `field.*`.
Relations, defaults, indexes, PostgreSQL names, extension-backed column types,
and other schema-owning Field capabilities therefore cannot be placed inside an
embedded value. Autocomplete and generated types must expose that boundary.

An embedded value has no Resource Identity, independent Policy, Relation,
migration lifecycle, or pagination. When a value needs any of those, has
unbounded cardinality, or is updated as an entity in its own right, the author
defines a Collection and Relation explicitly. QUESTPIE never extracts a nested
definition into a hidden mini-Collection.

```json
{
	"$schema": "https://questpie.dev/schema/application-v1.json",
	"version": 1,
	"application": {
		"name": "barbershop"
	},
	"postgres": {
		"schema": "barbershop",
		"minimumMajor": 16,
		"databaseCollation": "C.UTF-8",
		"databaseCType": "C.UTF-8",
		"extensions": [],
		"physicalNames": {}
	},
	"source": {
		"root": "src",
		"exclude": []
	},
	"packages": {}
}
```

The v1 column Field constructors are:

| Constructor       | PostgreSQL storage            | Required options                                         |
| ----------------- | ----------------------------- | -------------------------------------------------------- |
| `field.uuid`      | `uuid`                        | `nullable`; optional `default: "randomUuid"`             |
| `field.text`      | `text` plus optional check    | `nullable`; optional `minLength`, `maxLength`, `default` |
| `field.boolean`   | `boolean`                     | `nullable`; optional literal `default`                   |
| `field.integer`   | `integer`                     | `nullable`; optional bounds and default                  |
| `field.bigint`    | `bigint` serialized as string | `nullable`; optional bounds                              |
| `field.numeric`   | `numeric(precision, scale)`   | `nullable`, `precision`, `scale`                         |
| `field.timestamp` | `timestamp` or `timestamptz`  | `nullable`, `withTimezone`; optional `default: "now"`    |
| `field.date`      | `date`                        | `nullable`                                               |
| `field.object`    | `jsonb`                       | `nullable`, closed `properties` of `value.*` codecs      |
| `field.array`     | `jsonb`                       | `nullable`, `maximumItems`, one closed `items: value.*`  |
| `field.json`      | `jsonb`                       | `nullable`                                               |

`shape.inline({ fields })` is a structural authoring constructor rather than a
Field constructor. It accepts Fields and nested inline shapes. It rejects an
empty shape and duplicate paths. Every leaf receives a canonical non-empty
segment-array path such as `["address", "city"]`, its own semantic Field
identity, and its own PostgreSQL column. The default physical name joins the
path segments before applying the ordinary Field naming algorithm, producing
`address_city` in this example. Authors refer to nested Fields with segment
arrays; strings such as `"address.city"` are ordinary keys and are never split.

The closed embedded `value.*` constructors mirror the scalar runtime codecs
for UUID, text, boolean, integer, bigint, numeric, timestamp, and date, and add
`value.object` and `value.array`. Every embedded property is present; its
`nullable` option controls whether its value may be JSON `null`. Object codecs
reject undeclared properties. Array codecs validate every item and preserve
item order and duplicates. Every `value.array` and top-level `field.array`
declares `maximumItems` from 1 through 1,000. Shape and embedded container depth
is at most eight, and every JSONB-backed Field has at most 1,048,576 canonical
UTF-8 JSON bytes; deployments may lower but not raise these limits. Embedded
codecs have no defaults or PostgreSQL options. Recursion is finite in the
authored Definition; a cycle or depth over the compiler limit is an invalid
Definition.

`field.json` accepts the tagged public value `{ kind: "json", value:
JsonValue }`, where `JsonValue` is JSON null, boolean, finite JSON-safe number,
string, array of `JsonValue`, or object with string keys and `JsonValue` values.
It promises no property schema, typed path, or internal validation beyond that
boundary. SQL `NULL` and top-level JSON `null` are distinct protocol values:
outer `null` uses the ordinary nullable Field marker; `{ kind: "json", value:
null }` is top-level JSON null. A transport or Seed cannot collapse the two
into an untagged `null`.

`id`, `createdAt`, and `updatedAt` are ordinary authored Fields. A timestamp
`default: "now"` initializes a value on insert only. Automatically advancing
`updatedAt` belongs to the later transaction-owned Mutation design and is not
a schema callback, implicit Field, or generated-column behavior.

V1 literal defaults exist only for text, boolean, and integer Fields.
`"randomUuid"` is the only UUID default and lowers to PostgreSQL
`gen_random_uuid()`. `"now"` is the only timestamp default. Bigint, numeric,
and date literal defaults are deferred so schema artifact v1 never serializes an
ambiguous precision or time-zone value. V1 does not accept an arbitrary SQL
default. JSON-backed Fields have no schema default in v1.

Canonical scalar codecs are closed. UUID text is lowercase 8-4-4-4-12
hexadecimal form with unrestricted version and variant nibbles:
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Integer values are JSON safe integers.
Bigint text matches `0|-?[1-9][0-9]*` and must be within PostgreSQL `int8`.
Numeric text has no sign `+` or exponent and uses exactly the declared scale:
scale zero uses `0|-?[1-9][0-9]*`; positive scale uses
`(?:0|-?[1-9][0-9]*)\.[0-9]{scale}`. Its total digits cannot exceed precision.
Date text is `YYYY-MM-DD`. Timestamp without time zone is
`YYYY-MM-DDTHH:mm:ss.SSS`; timestamp with time zone is UTC
`YYYY-MM-DDTHH:mm:ss.SSSZ`. Text is NFC. The compiler rejects rather than
rounds, changes case, accepts an offset, or removes leading zeroes. Catalog and
Seed codecs produce exactly these forms.

Text length and integer bound options lower to generated check Constraints.
Their identities are
`<field-identity>/invariant:<minLength|maxLength|minimum|maximum>`.
Their physical names use `qp_ck_<table>_<field>_<invariant>`, with the same
length algorithm as authored Constraints. They appear in the Schema Projection,
Migration Plan, SQL, and Schema Fingerprint. They are not anonymous checks.

`constraint.primaryKey`, `constraint.unique`, and `constraint.check` are the
only v1 Constraint constructors. A Relation owns its foreign-key Constraint;
authors do not declare a duplicate foreign key. Schema-owning v1 Relations are
`toOne` and
require equal-length local and referenced Field lists. The referenced list must
be a primary or unique key. Referential actions are `restrict`, `cascade`,
`setNull`, or `noAction`; `setNull` requires nullable local Fields.

After Owner and accepted Augmentations resolve, a regular Collection must have
exactly one `constraint.primaryKey`. Zero or multiple primary-key Constraints
report `QP-SCHEMA-001 invalidDefinition` and emit no Schema Projection. The
Constraint's authored map key creates its stable identity and can contain one
or more Fields in declared order. There is no `field.id()` constructor or
`primaryKey: true` Field modifier. A future keyless or externally managed read
model needs a separate explicit contract.

The check callback receives only typed Field-expression objects and the
compiler accepts only the returned closed expression tree. The authoring module
and callback run inside the Controlled Structural Evaluator defined by the
composition contract. Environment, I/O, clock, random, process, and other
forbidden build-time effects report `QP-COMPOSE-010`; the evaluator is a
determinism boundary, not a security sandbox for hostile Package code. No
callback or executable code enters the Schema Projection, Committed Migration,
or deploy runner.

### Authored-check signature supersession audit

The earlier one-phase signature
`constraint.check(({ fields }) => fields.endsAt.greaterThan(fields.startsAt))`
is superseded by
`constraint.check<typeof appointmentFields>(({ fields }) =>
fields.endsAt.greaterThan(fields.startsAt))` with the same extracted object
passed as `fields: appointmentFields`.

TypeScript cannot infer the callback's Field generic from the sibling `fields`
property of the surrounding `defineCollection` input. Defaulting the callback
to a broad Field record would make every property possibly absent and would
erase exact missing-Field and incompatible-scalar diagnostics. The explicit
`typeof appointmentFields` binding preserves literal Field keys and scalar
kinds without `any`, widening, a universal builder, or another authoring phase.

This is a deliberate source incompatibility for the unreleased one-phase
signature. It changes only authored TypeScript. The callback still evaluates
once to the same closed expression tree, and no callback enters an artifact.
For an equivalent expression, Schema Projection, Migration Plan, generated SQL,
Committed Migration, checksum, and Schema Fingerprint bytes remain unchanged;
the signature repair therefore creates no migration.

An Index has one or more scalar column Field entries. It cannot name an inline
shape, a JSON-backed Field, an embedded member, or an open-JSON path. Each entry has
`order: "asc" | "desc"`
and `nulls: "first" | "last"`; omitted values normalize to `asc` and PostgreSQL's
corresponding default null order. V1 supports B-tree indexes only. Unique
semantics use `constraint.unique`, not `index({ unique: true })`.

Useful JSON indexes normally require GIN or expression indexes. Neither is
silently approximated by the v1 B-tree grammar. A later managed artifact can
add their complete identity, dependency, migration, and drift contracts; a
named native PostgreSQL escape hatch can instead declare externally managed
DDL and the guarantees it forfeits. Until one of those contracts is accepted,
an extra JSON index in the application schema is unexpected drift.

Every Collection, Field, Constraint, Index, and Relation can set
`postgres: { name: "lower_snake_case" }`. The application schema and all
physical names, whether explicit or derived, must be unquoted lower-snake ASCII identifiers, must
not start with `pg_` or `questpie_`, and must fit in 63 UTF-8 bytes. This avoids
case folding, truncation, and quoted-identifier ambiguity. Application schema
names also cannot be `public`, `information_schema`, `pg_catalog`, or
`questpie_internal`.

## 3. Identity and physical names

The semantic identities are:

```text
collection:appointments
collection:appointments/field:startsAt
collection:customers/field:address/field:city
collection:appointments/constraint:validWindow
collection:appointments/index:byTenantAndStart
collection:appointments/relation:tenant
seed:barbershop.demo.v1
```

Collection and Seed names use the Qualified Resource Name grammar in
`CONTEXT.md`. Member keys are lower-camel identifiers. A top-level Field
identity appends `/field:<segment>` to its Collection identity. Each additional
inline path segment appends another `/field:<segment>`; the identity never
joins or parses segments with a dot. Inline shapes themselves have no semantic
identity because they own no schema object. Identity is case sensitive in
source and canonical JSON. PostgreSQL names are lower case.

Default physical names use this algorithm:

1. Split a Qualified Resource Name at `.`.
2. Scan each ASCII segment from left to right. Before an uppercase letter,
   insert `_` when the previous character is lowercase or a digit, or when the
   previous character is uppercase and the next character is lowercase. Then
   convert every letter to lowercase. Digits remain unchanged. For example,
   `oauth2Clients` becomes `oauth2_clients`, `apiURL` becomes `api_url`, and
   `urlValue` becomes `url_value`.
3. Join Collection segments with `__` and Field keys with `_`.
4. Prefix generated Constraint and Index names with `qp_pk_`, `qp_uq_`,
   `qp_ck_`, `qp_fk_`, or `qp_ix_`.
5. If a generated name exceeds 63 bytes, keep the longest prefix that leaves
   room for `_` plus the first 12 lowercase hexadecimal characters of
   SHA-256 over `questpie-postgres-name-v1\0<semantic-identity>`.
6. Fail compilation if two physical names still collide. Never select a name
   by discovery order.

An author can set `postgres: { name }` inline on a target they own. For a target
that application source cannot annotate inline, `questpie.json` can set
`postgres.physicalNames[semanticIdentity]`. Both forms use the same physical-name
validation and canonical Schema Projection field. Supplying both forms for one
identity is an error. Changing an override produces an ordinary reviewed rename
Migration; it does not change Resource Identity.

Examples:

| Semantic identity                                | PostgreSQL name                          |
| ------------------------------------------------ | ---------------------------------------- |
| `collection:appointments`                        | `appointments`                           |
| `collection:booking.availability`                | `booking__availability`                  |
| `collection:appointments/field:startsAt`         | `starts_at`                              |
| `collection:customers/field:address/field:city`  | `address_city`                           |
| `collection:appointments/constraint:validWindow` | `qp_ck_appointments_valid_window`        |
| `collection:appointments/index:byTenantAndStart` | `qp_ix_appointments_by_tenant_and_start` |

Changing an explicit physical name is a schema rename. Changing a semantic
identity without a planner rename mapping is an addition plus a removal.

## 4. Schema Projection in the Compiled Manifest

The Compiled Manifest describes the complete resolved application. Its
`composition` member records Resource and accepted Augmentation identities, and
its `schema` member is the versioned Schema Projection below. Later Operations
and Policies can add other Compiled Manifest members without changing schema history.
The migration lifecycle compares only the Schema Projection Digest;
contribution identity does not enter migration bytes.

The compiler writes `.questpie/generated/manifest.json` and
`.questpie/generated/schema-projection.json`. These files are generated and not
committed. A Committed Migration contains its base and target Schema Projection
snapshots.

```ts
interface SchemaProjectionV1 {
	format: "questpie.schema-projection";
	version: 1;
	application: {
		name: string;
		postgresSchema: string;
	};
	requiredPostgres: {
		minimumMajor: 16;
		databaseCollation: string;
		databaseCType: string;
		extensions: Array<{ name: string }>;
	};
	collections: CollectionManifestV1[];
}

interface CollectionManifestV1 {
	identity: `collection:${string}`;
	postgresName: string;
	fields: Array<{
		identity: FieldIdentityV1;
		path: FieldPathV1;
		postgresName: string;
		type: FieldTypeV1;
		nullable: boolean;
		default:
			| null
			| { kind: "literal"; value: null | boolean | number | string }
			| { kind: "randomUuid" | "now" };
		collation: "questpie.binary" | null;
	}>;
	constraints: ConstraintManifestV1[];
	indexes: IndexManifestV1[];
	relations: RelationManifestV1[];
}

type FieldPathV1 = [string, ...string[]];
type FieldIdentityV1 = `collection:${string}/field:${string}`;

type FieldTypeV1 =
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
	| { kind: "date" }
	| { kind: "object"; properties: EmbeddedPropertyV1[] }
	| {
			kind: "array";
			maximumItems: number;
			items: EmbeddedValueCodecV1;
	  }
	| { kind: "json" };

interface EmbeddedPropertyV1 {
	key: string;
	codec: EmbeddedValueCodecV1;
}

type EmbeddedValueCodecV1 =
	| { kind: "uuid"; nullable: boolean }
	| {
			kind: "text";
			nullable: boolean;
			minLength: number | null;
			maxLength: number | null;
			collation: "questpie.binary";
	  }
	| { kind: "boolean"; nullable: boolean }
	| {
			kind: "integer";
			nullable: boolean;
			minimum: number | null;
			maximum: number | null;
	  }
	| {
			kind: "bigint";
			nullable: boolean;
			minimum: string | null;
			maximum: string | null;
	  }
	| {
			kind: "numeric";
			nullable: boolean;
			precision: number;
			scale: number;
	  }
	| { kind: "timestamp"; nullable: boolean; withTimezone: boolean }
	| { kind: "date"; nullable: boolean }
	| {
			kind: "object";
			nullable: boolean;
			properties: EmbeddedPropertyV1[];
	  }
	| {
			kind: "array";
			nullable: boolean;
			maximumItems: number;
			items: EmbeddedValueCodecV1;
	  };

type PostgreSqlFieldTypeV1 =
	| {
			kind:
				| "uuid"
				| "text"
				| "boolean"
				| "integer"
				| "bigint"
				| "date"
				| "jsonb";
	  }
	| { kind: "numeric"; precision: number; scale: number }
	| { kind: "timestamp"; withTimezone: boolean };

type ConstraintManifestV1 =
	| {
			kind: "primaryKey" | "unique";
			identity: `collection:${string}/constraint:${string}`;
			postgresName: string;
			fields: FieldIdentityV1[];
	  }
	| {
			kind: "check";
			identity:
				| `collection:${string}/constraint:${string}`
				| `collection:${string}/field:${string}/invariant:${"minLength" | "maxLength" | "minimum" | "maximum"}`;
			postgresName: string;
			expression: CheckExpressionV1;
	  };

interface IndexManifestV1 {
	kind: "btree";
	identity: `collection:${string}/index:${string}`;
	postgresName: string;
	fields: Array<{
		field: FieldIdentityV1;
		order: "asc" | "desc";
		nulls: "first" | "last";
		operatorClass: "typeDefault";
		collation: "field" | null;
	}>;
}

interface RelationManifestV1 {
	kind: "toOne";
	identity: `collection:${string}/relation:${string}`;
	target: `collection:${string}`;
	fields: FieldIdentityV1[];
	references: FieldIdentityV1[];
	constraintPostgresName: string;
	onDelete: "restrict" | "cascade" | "setNull" | "noAction";
	onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
}

type CheckExpressionV1 =
	| { kind: "field"; field: FieldIdentityV1 }
	| { kind: "literal"; value: null | boolean | number | string }
	| { kind: "textLength"; expression: CheckExpressionV1 }
	| {
			kind: "compare";
			operator:
				| "equal"
				| "notEqual"
				| "lessThan"
				| "lessThanOrEqual"
				| "greaterThan"
				| "greaterThanOrEqual";
			left: CheckExpressionV1;
			right: CheckExpressionV1;
	  }
	| { kind: "and" | "or"; expressions: CheckExpressionV1[] }
	| { kind: "not"; expression: CheckExpressionV1 }
	| { kind: "isNull" | "isNotNull"; expression: CheckExpressionV1 };
```

These closed tagged unions contain every normalized v1 option. All references
use semantic identity. They never use array positions, object addresses, file
paths, or ORM values. An omitted Index null order normalizes to `last` for
ascending order and `first` for descending order before encoding.

`FieldPathV1` is the canonical path representation in generated declarations,
query/schema artifacts, Origin entries, and diagnostics. The corresponding
Field identity repeats `/field:<segment>` for every path segment even though
the TypeScript template literal above can express only the common prefix.
Fields sort by identity. Embedded properties sort by `key`; array item order is
data and never part of the codec definition. Neither an inline shape nor an
embedded property appears as a Collection, Field, or PostgreSQL object in the
Schema Projection.

The Schema Projection records the full embedded codec because it is part of the
application contract. The physical fingerprint records only its `jsonb`
column. Runtime writes and reads validate typed embedded values; direct SQL can
write an invalid JSONB value, which is reported as a data decode failure rather
than schema drift. V1 does not install hidden validation functions or triggers.
Adding or changing an embedded codec on an existing Field is blocked in v1
because the lifecycle cannot prove all stored rows. A developer models a new
Field and performs an explicit later data migration once that artifact exists.
This limitation does not apply to creating a new Collection or adding a new
nullable JSON-backed Field.

All artifact JSON uses RFC 8785 JSON Canonicalization Scheme bytes plus one
final LF. The compiler validates that source strings are already Unicode NFC
and rejects non-NFC input; the artifact encoder never rewrites source text. Semantic
set arrays sort by their normalized identity before encoding. The encoder
rejects `undefined`, non-finite numbers, negative zero, functions, symbols,
cycles, duplicate normalized keys, and lone Unicode surrogates. The Schema
Projection Digest is lowercase SHA-256 of those exact bytes with the prefix
`questpie-schema-projection-v1\0`.

The Origin Map is a separate generated artifact. Absolute source locations and
line numbers can change its bytes but cannot change the Schema Projection Digest
or Plan Digest.

## 5. Migration Plan

The planner compares:

1. the current Schema Projection from the Compiled Manifest;
2. the target Schema Projection of the latest local Committed Migration; and
3. the connected database Schema Fingerprint when a connection is available.

With a connection, planning first requires the live Schema Fingerprint to match
the local base. Without a connection, the planner uses the latest local
Committed Migration as the base and apply later performs that same live check.
Database observations and rendered diagnostics never enter canonical Migration
Plan bytes, so online and offline planning produce the same Migration Plan for
the same base,
target, slug, and rename mappings.

```ts
interface MigrationPlanV1 {
	format: "questpie.migration-plan";
	version: 1;
	application: string;
	slug: string;
	baseMigration: string | null;
	baseSchemaDigest: string;
	targetSchemaDigest: string;
	renames: Array<{ from: RenameIdentityV1; to: RenameIdentityV1 }>;
	requiredPostgres: SchemaProjectionV1["requiredPostgres"];
	classification: "safe" | "guarded" | "destructive" | "blocked";
	steps: MigrationStepV1[];
}

type RenameIdentityV1 =
	| `collection:${string}`
	| `collection:${string}/field:${string}`;

type SchemaTargetIdentityV1 =
	| `application:${string}`
	| `collection:${string}`
	| `collection:${string}/field:${string}`
	| `collection:${string}/constraint:${string}`
	| `collection:${string}/field:${string}/invariant:${string}`
	| `collection:${string}/index:${string}`
	| `collection:${string}/relation:${string}`;

interface MigrationStepV1 {
	stepId: string;
	kind:
		| "createApplicationSchema"
		| "createCollection"
		| "renameCollection"
		| "dropCollection"
		| "addField"
		| "renameField"
		| "alterField"
		| "dropField"
		| "addConstraint"
		| "renameConstraint"
		| "dropConstraint"
		| "addIndex"
		| "renameIndex"
		| "dropIndex"
		| "addRelation"
		| "renameRelationConstraint"
		| "dropRelation";
	targetIdentity: SchemaTargetIdentityV1;
	containerIdentity: `application:${string}` | `collection:${string}`;
	lock:
		| "none"
		| "share"
		| "shareRowExclusive"
		| "shareUpdateExclusive"
		| "accessExclusive";
	scansData: boolean;
	rewritesTable: boolean;
	reversibleWithoutData: boolean;
	classification: "safe" | "guarded" | "destructive" | "blocked";
}

interface DiagnosticV1 extends QuestpieDiagnosticBaseV1 {
	code: DiagnosticCodeV1;
	comparison:
		| "localToReceipts"
		| "appliedToDatabase"
		| "desiredToCommitted"
		| "provider"
		| null;
	class: DiagnosticClassV1;
	physicalName: string | null;
	containerIdentity: `application:${string}` | `collection:${string}` | null;
}

// QuestpieDiagnosticBaseV1 is the shared CLI JSON envelope defined by the
// composition contract. Schema diagnostics add only the fields above.

type DiagnosticCodeV1 =
	| "QP-SCHEMA-001"
	| "QP-SCHEMA-002"
	| "QP-SCHEMA-003"
	| "QP-SCHEMA-004"
	| "QP-SCHEMA-005"
	| "QP-SCHEMA-006"
	| "QP-SCHEMA-007"
	| "QP-SCHEMA-020"
	| "QP-SCHEMA-021"
	| "QP-SCHEMA-022"
	| "QP-SCHEMA-023"
	| "QP-SCHEMA-024"
	| "QP-SCHEMA-025"
	| "QP-SCHEMA-026"
	| "QP-SCHEMA-027"
	| "QP-SCHEMA-028"
	| "QP-SCHEMA-029"
	| "QP-SCHEMA-031"
	| "QP-SEED-001"
	| "QP-SEED-002"
	| "QP-SEED-003"
	| "QP-SEED-004"
	| "QP-SEED-009"
	| "QP-SEED-011"
	| "QP-SEED-012"
	| "QP-SEED-014";

type DiagnosticClassV1 =
	| "invalidDefinition"
	| "duplicateIdentity"
	| "invalidReference"
	| "unsupportedDefinition"
	| "invalidPhysicalName"
	| "physicalNameCollision"
	| "providerMismatch"
	| "destructiveAcknowledgementRequired"
	| "planDigestMismatch"
	| "stalePlan"
	| "checksumMismatch"
	| "missingLocalMigration"
	| "pendingMigration"
	| "unknownAppliedMigration"
	| "orderMismatch"
	| "applicationBindingMismatch"
	| "baseDrift"
	| "targetDrift"
	| "missingObject"
	| "unexpectedObject"
	| "changedObject"
	| "invalidObject"
	| "undeclaredDependency"
	| "unplannedDesiredChange"
	| "unsupportedPostgres"
	| "missingExtension"
	| "incompatibleExtension"
	| "nonTransactionalDdl"
	| "missingSeedDependency"
	| "seedDependencyCycle"
	| "seedTargetMismatch"
	| "unsupportedSeedStep"
	| "seedInsertConflict"
	| "seedCardinalityMismatch"
	| "seedSchemaDrift";

// CanonicalJsonValue is the shared closed JSON value type defined by the
// composition contract.
```

The v1 code registry is closed:

| Code range/value                   | Meaning                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `QP-SCHEMA-001`–`005`              | invalid Definition, duplicate identity, invalid reference, unsupported Definition, invalid physical name              |
| `QP-SCHEMA-006`, `007`             | physical-name collision; provider/profile/session-affinity mismatch                                                   |
| `QP-SCHEMA-020`–`024`              | destructive acknowledgement, Plan Digest mismatch, stale Migration Plan, migration checksum mismatch, unknown receipt |
| `QP-SCHEMA-025`–`028`              | history order, base drift, target drift, or catalog/object drift; `class` carries the exact subtype                   |
| `QP-SCHEMA-029`                    | configured Application Identity or PostgreSQL schema disagrees with its stored application binding                    |
| `QP-SCHEMA-031`                    | non-transactional or otherwise unsupported DDL                                                                        |
| `QP-SEED-001`–`004`                | missing dependency, dependency cycle, step/schema incompatibility, checksum mismatch                                  |
| `QP-SEED-009`, `011`, `012`, `014` | unsupported step, insert conflict, cardinality mismatch, Schema Fingerprint drift                                     |

Adding another v1 code requires an ADR-0006 revision; implementations cannot
emit an unregistered `QP-SCHEMA-*` or `QP-SEED-*` value.

The Plan Digest is lowercase SHA-256 of canonical Migration Plan bytes with the prefix
`questpie-migration-plan-v1\0`. Steps have a stable `stepId`, semantic target,
containing Resource identity, expected lock level, data scan or rewrite flags, reversibility
statement, and classification. A Migration Plan step never contains SQL or rendered
diagnostic prose. The CLI derives summaries, preconditions, and recovery
commands from the frozen step kind, classification, and diagnostic registry.
`stepId` is SHA-256 of the canonical step without `stepId`, prefixed by
`questpie-migration-step-v1\0`.

`textLength` accepts only a text Field expression and lowers to
`char_length(<field>)`. Catalog introspection recognizes only that exact
generated form for text-length invariants. Another function or expression is
unsupported drift.

Generated invariant expressions are exact. `minLength` is
`textLength(field) >= literal(number)` and `maxLength` is
`textLength(field) <= literal(number)`. Integer `minimum`/`maximum` put the
Field on the left and a JSON integer literal on the right. Bigint bounds use
the same operand order and store canonical bigint text as a string literal; the
SQL renderer emits `CAST('<value>' AS pg_catalog.int8)`, and the catalog parser
maps that cast back to the canonical string. The compiler emits no commuted or
algebraically equivalent form.

Origin is presentation metadata, not a Migration Plan or Committed Migration input. The
CLI joins diagnostics to the current Origin Map. A file or export move by
itself therefore cannot change a schema plan or migration checksum. The Origin
contract can be versioned by the next composition grill without changing
stored migration history.

`migration plan` writes the exact canonical bytes to
`.questpie/plans/$PLAN_DIGEST.json` and prints both path and digest. This is an
explicit generated handoff file, not database state. `migration create` accepts
that path, recomputes the digest, and refuses a missing or changed file.

Before it allocates a migration identity, `migration create` recompiles the
current Schema Projection. It requires the Migration Plan target to equal that projection
and the Migration Plan base migration and digest to equal the current local chain head.
It reruns `diffSchemaV1` over the Migration Plan's exact base and target snapshots and
requires byte equality for `renames`, `steps`, `classification`, and
`requiredPostgres`. Any edited semantic step, intervening Definition, or
Committed Migration produces
`QP-SCHEMA-022 stalePlan`; the developer must create another Migration Plan.

`diffSchemaV1` never consumes SQL. It suppresses contained Field drops/adds
when a Collection is dropped/created; `createCollection` emits all target
Fields but no Constraints, Relations, or Indexes. It builds dependency edges
for schema before Collection, Collection before contained additions, both
endpoint Collections and referenced keys before Relation, Relation before an
endpoint/key drop, contained drops before Collection drop, and a rename before
another change to the renamed object. Kahn's algorithm selects the next ready
step by this fixed kind rank and then normalized `targetIdentity`:

```text
createApplicationSchema, renameCollection, createCollection, renameField,
renameConstraint, renameRelationConstraint, renameIndex, addField, alterField,
addConstraint, addRelation, addIndex, dropIndex, dropRelation, dropConstraint,
dropField, dropCollection
```

A Collection or Field identity mapping also pairs every generated child
Constraint, Index, and Relation constraint by its mapped semantic identity.
When its derived physical name changes, the planner emits the corresponding
explicit rename step. It never hides a cascaded physical rename inside a parent
step. An explicit physical-name change without a semantic mapping uses the same
rename step. These steps are destructive because external SQL names change.

The renderer accepts only a verified step plus the base and target Schema
Projections. It selects a closed renderer branch by `kind`; there is no API or
artifact field for authored SQL. Golden vectors freeze every branch's SQL
bytes, quoting, statement order, and step separator.

Within `createCollection`, Fields use Schema Projection identity order.
Every text column renders `COLLATE pg_catalog."C"`; text checks, primary/unique
Constraints, and B-tree Indexes therefore inherit the same fixed
`questpie.binary` semantics. Query predicates, order terms, and cursor seeks
emit the same explicit collation rather than relying on `search_path` or the
database default.
`alterField` renders supported physical deltas in this order: drop a changed
default, change storage type with the one registered cast, set a new
literal/default expression, perform a compiler-generated literal NULL
backfill, then change nullability. Constraint, Relation, and Index changes are
separate steps ordered by the dependency graph. A step whose base-to-target
delta contains an unregistered attribute combination is blocked rather than
rendered. This order plus the v1 renderer golden vectors is the complete SQL
byte authority.

Rename mappings sort by `from` and then `to`. For every rename step,
`targetIdentity` is the identity in the target snapshot; generated child rename
steps use their mapped child identity in that target snapshot.

Classification is the maximum severity of all steps and the provider-profile
delta:

| Class         | Examples                                                                                                | Required result                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `safe`        | new table; nullable Field; index on an empty new table                                                  | review only                                       |
| `guarded`     | index on existing data; new unique/check/foreign-key validation; non-null Field with a literal backfill | plan names scan, lock, and failure precondition   |
| `destructive` | drop; narrowing conversion; nullable to required; changed referential action; rename without data loss  | migration creation requires the exact Plan Digest |
| `blocked`     | unsupported type conversion; undeclared external dependency; non-transactional DDL; manual SQL          | no migration can be created                       |

Increasing `minimumMajor` or adding a required extension is `guarded` because
apply must prove the provider. Lowering `minimumMajor` or removing an unused
extension requirement is `safe`. Changing `databaseCollation` or
`databaseCType` after Genesis is `blocked` because v1 cannot rebuild a
database. If both the step list and provider delta are empty, the planner emits
`noChanges`, exit `0`, and no Migration Plan file; it never creates a zero-change
Committed Migration.

V1 classifies every supported change by this closed matrix:

| Exact semantic delta                                                                                                         | Class                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| create application schema or Collection                                                                                      | `safe`                                                         |
| add nullable Field without a default                                                                                         | `safe`                                                         |
| add nullable `field.object`, `field.array`, or `field.json` without a default                                                | `safe`                                                         |
| relax text/integer/bigint bound; increase numeric precision without changing scale                                           | `safe`                                                         |
| add a literal default to an existing nullable Field                                                                          | `guarded`                                                      |
| add nullable Field with literal default                                                                                      | `guarded`                                                      |
| add check, unique, Relation/foreign key, or Index                                                                            | `guarded`                                                      |
| widen `integer` to `bigint`                                                                                                  | `guarded`                                                      |
| explicit Collection or Field rename                                                                                          | `destructive` because external SQL names change                |
| change an explicit physical name for Constraint, Index, or Relation                                                          | `destructive`; lower to drop plus add                          |
| drop Collection, Field, Constraint, Relation, or Index                                                                       | `destructive`                                                  |
| required to nullable                                                                                                         | `destructive` because the generated contract changes           |
| nullable to required with a literal backfill default                                                                         | `destructive`                                                  |
| add required Field with a literal default                                                                                    | `destructive`                                                  |
| drop or change a default                                                                                                     | `destructive`                                                  |
| strengthen a text/integer/bigint bound; reduce numeric precision; change numeric scale                                       | `destructive`                                                  |
| change primary/unique Field list, check expression, Index Fields/order/nulls, or Relation endpoints/actions                  | `destructive`; lower to drop plus add                          |
| nullable to required without a literal backfill; add required Field without a literal default                                | `blocked`                                                      |
| change Field kind except `integer` to `bigint`; change timestamp time-zone mode                                              | `blocked`                                                      |
| add or change an embedded value codec on an existing JSONB Field                                                             | `blocked`; stored rows require a later data-migration artifact |
| request generated/identity column, RLS, JSON-path/GIN/expression/unique Index, another collation/opclass, or unsupported DDL | `blocked`                                                      |
| request non-transactional DDL or any delta not listed above                                                                  | `blocked`                                                      |

`randomUuid` and `now` are not literal backfill defaults. Adding a required
Field to an existing Collection with either default is blocked because the
planner cannot prove the historical value choice during identical online and
offline planning. A new Collection can use them without a backfill.

The planner never infers a rename from similar names or shapes. The exact CLI
mapping is:

```bash
bunx questpie migration plan --name rename-start \
  --rename 'collection:appointments/field:startsAt=collection:appointments/field:beginsAt'
```

Both identities and the physical rename remain in the plan. A mapping must be
one-to-one, type-compatible, and based on the latest committed Schema
Projection. Without a mapping, the planner always emits an addition plus a
destructive removal. It uses no similarity heuristic and does not block an
intentional remove-and-add as an ambiguous rename.

## 6. Committed Migration and checksum

`migration create` allocates the next six-digit sequence from the local linear
chain. Branches that allocate the same sequence must resolve the file conflict
and replan. QUESTPIE does not merge migration DAGs in v1.

```text
questpie/migrations/000001_create-appointments/
  migration.json
  plan.json
  base-schema.json
  target-schema.json
  up.sql
  checksum.sha256
```

The identity is the directory prefix and slug, for example
`000001_create-appointments`. The slug grammar is lower kebab case. The
`migration.json` has this exact canonical shape:

```ts
interface CommittedMigrationMetadataV1 {
	format: "questpie.committed-migration";
	version: 1;
	identity: `${number}_${string}`;
	sequence: number;
	slug: string;
	parent: string | null;
	planDigest: string;
	baseSchemaDigest: string;
	targetSchemaDigest: string;
	requiredPostgres: SchemaProjectionV1["requiredPostgres"];
	transaction: "required";
	sqlRenderer: "questpie-postgres-ddl-v1";
}
```

It contains no checksum or timestamp. `base-schema.json` and
`target-schema.json` contain the exact Schema Projections named by the metadata.
For migration 000001, the base is the canonical Genesis Schema Projection: the
same Application Identity and physical schema name, the required PostgreSQL
profile, and an empty `collections` array. Its live Schema Fingerprint requires that
the application schema does not exist. The first step creates it.

`up.sql` uses UTF-8 and LF. For each Migration Plan step in order, the v1 renderer writes
`-- questpie-step: <stepId>`, one SQL statement terminated by `;` per line, and
one empty line. Identifiers are always double-quoted by the renderer. The file
ends with one LF. Authors cannot edit SQL independently of the Migration Plan.

The migration checksum is SHA-256 over this byte sequence:

```text
questpie-migration-v1\0
<migration.json bytes>\0
<plan.json bytes>\0
<base-schema.json bytes>\0
<target-schema.json bytes>\0
<up.sql bytes>
```

`checksum.sha256` contains the 64 lowercase hexadecimal characters and one LF.
All six files are committed. Editing any of the five covered files changes the
computed checksum. Editing `checksum.sha256` makes verification fail. An applied
migration is immutable; changing it is always an error, never a repair workflow.

V1 generates SQL only from typed Migration Plan steps. It does not accept handwritten
SQL steps. This keeps the target Schema Projection, SQL, and Schema Fingerprint
in one contract. Data transformations and online DDL require a later artifact
version.

## 7. Apply protocol and idempotency

Before it reads receipts, the runner installs or verifies bootstrap protocol
`questpie.internal.v1`. The authoritative SQL is
`docs/v4/schema-bootstrap-v1.sql`. It fixes every column, nullability rule,
constraint, generated backing index, ownership behavior, and `PUBLIC` revoke.
On first bootstrap, the executing migration role owns the schema and tables.
Later deploy roles do not have to use the same role name, but must have the
required privileges. The ownership invariant is relational: every internal
table and generated backing Index has the same owner OID as the
`questpie_internal` schema, and no `PUBLIC` privilege exists. The runner
supplies timestamps explicitly; the protocol has no hidden defaults. Execution
Envelope correlation is deferred and does not create a placeholder stored
column in protocol v1.

The Runtime distribution embeds those exact UTF-8/LF SQL bytes. The protocol
checksum is SHA-256 of `questpie-internal-bootstrap-v1\0` plus the file bytes.
The bootstrap transaction runs the SQL, verifies the resulting catalog shape,
inserts the singleton protocol row, and commits before application migration
work. The v1 SQL file is immutable after release, including comments and
whitespace. Its catalog-shape golden value is a canonical list of schema,
tables, columns, PostgreSQL types, nullability, Constraints, backing Indexes,
the ownership invariant, and grants created by that file. It never embeds a
role name or owner OID, so a later authorized deploy role verifies the same
shape.

Every apply and Seed run verifies version, checksum, catalog shape, ownership,
and privileges. A tampered, unknown, or newer protocol is fatal. A future
recognized upgrade uses a new immutable file such as
`schema-bootstrap-v2.sql`. Under the same database bootstrap lock, the runner
verifies the exact predecessor checksum and shape, executes each registered
upgrade in order in one transaction, verifies the new shape, and updates the
singleton protocol version/checksum before commit. It never edits or re-hashes
v1 and never patches tables outside a registered upgrade. This is the versioned
precondition of the same runner, not a Package or application schema path.

Bootstrap uses a database-scoped session advisory lock. Its key is the signed
64-bit two's-complement big-endian interpretation of the first eight SHA-256
bytes over the UTF-8 bytes of
`questpie-bootstrap-lock-v1\0<current_database>`. The runner acquires and
releases this lock before it acquires any application lock. Every apply and Seed
run uses this lock order, so two applications cannot race shared bootstrap.

The advisory-lock key is the signed 64-bit two's-complement big-endian
interpretation of the first eight bytes of SHA-256 over the UTF-8 bytes of
`questpie-application-lock-v1\0<current_database>\0<application-name>`. The
lock-input codec requires and validates NFC database and application names
before hashing; it does not normalize or rewrite them. The
runner uses a session advisory lock so it spans application binding and all
pending migration transactions.

Apply and Seed commands require a direct PostgreSQL connection or a pool in
session mode. Transaction-pooling endpoints are unsupported in v1. Before it
acquires either session lock, QUESTPIE commits two probe transactions on the
pinned client and requires the same `pg_backend_pid()`; it checks that PID again
before and after every migration/Seed transaction and before unlock. A provider
profile must also declare the endpoint session-affine. Failure reports
`QP-SCHEMA-007 providerMismatch` before application work. Managed Supabase
conformance uses its direct or session-mode endpoint, never the transaction
pooler.

The first application migration inserts `application_bindings` in the same
transaction as application DDL and the first Migration Receipt. A failed first
apply therefore leaves no binding. An existing Application Identity must name
the same physical schema, and a physical schema can belong to only one
Application Identity. A mismatch fails before application SQL.

`migration apply` performs these steps:

1. Load the complete local linear chain and verify every artifact checksum.
2. Connect through a session-affine endpoint and verify the PostgreSQL major,
   database collation/ctype, and required extensions.
3. Acquire the database bootstrap lock, install or verify
   `questpie.internal.v1`, then release that lock.
4. Acquire the application session lock, subject to the configured lock
   timeout.
5. Compare the local chain with
   `questpie_internal.schema_migration_receipts` and identify the applied head.
6. Fail for an unknown receipt, missing local predecessor, sequence gap, or
   checksum mismatch. Report `QP-SCHEMA-029 applicationBindingMismatch` when the
   configured Application Identity or PostgreSQL schema disagrees with its
   stored application binding.
7. Introspect once. If an applied head exists, require only that head's
   `target-schema.json`; do not compare historical targets after later
   migrations exist. Without an applied head, require the first pending
   migration's Genesis `base-schema.json`.
8. If no migration is pending, return `alreadyApplied` after the head check.
9. Require the next pending migration's parent and `base-schema.json` to equal
   the applied head transition, then begin its transaction. For migration
   000001, insert the application binding inside this transaction before DDL.
10. Execute generated SQL with statement and lock timeouts.
11. Introspect inside the transaction and require `target-schema.json`.
12. Insert the immutable Migration Receipt in the same transaction.
13. Commit, verify the target Schema Fingerprint once more, and advance the in-memory
    applied head.
14. Repeat steps 9–13 for each remaining pending migration in chain order.
15. Release the application lock and emit the complete result.

Every migration is its own commit boundary. If migration N fails after earlier
pending migrations committed, QUESTPIE releases the session lock in `finally`
and returns the applied identities, failed identity and diagnostic, and
remaining identities with exit `4` for a protocol/drift block or `5` for SQL
failure. A retry begins from the new receipt head and never reruns the committed
prefix.

If the client loses the success response after commit, a retry observes the
same receipt and checksum, verifies its target Schema Fingerprint, and returns
`alreadyApplied`. The migration SQL does not run twice. A pre-commit failure
rolls back both DDL and the receipt. A failed post-commit verification returns
blocking drift; every retry verifies again until the drift is repaired.

V1 rejects `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, database
creation, and every other step that cannot share the owned transaction. The
diagnostic is `QP-SCHEMA-031 nonTransactionalDdl` and names the
PostgreSQL command plus the recovery choice: use the supported blocking form
for a reviewed maintenance window or defer the change until the online-phase
artifact is accepted.

QUESTPIE does not claim protection from an uncooperative external DDL session.
The post-commit Schema Fingerprint detects such a race. Application operators must
stop external DDL while applying a migration.

## 8. Schema Fingerprint and Drift

The fingerprint reader uses `pg_catalog`. It
does not hash OIDs, object owners, statistics, physical file locations,
comments, ACL order, creation time, or catalog row order.

The canonical fingerprint includes every table, column, default, generated or
identity setting, primary/unique/check/foreign-key Constraint, Index, and
required extension in the application schema. It normalizes PostgreSQL type
names, expressions, predicates, ordering, null ordering, operator classes,
collations, validation state, deferrability, and referential actions. It also
records server and extension versions outside the semantic digest for provider
diagnostics.

```ts
interface SchemaFingerprintV1 {
	format: "questpie.schema-fingerprint";
	version: 1;
	comparable: FingerprintComparableV1;
	observations: {
		serverVersion: string;
		databaseCollation: string;
		databaseCType: string;
		extensions: Array<{ name: string; installedVersion: string }>;
	};
}

interface FingerprintComparableV1 {
	application: string;
	applicationSchema: string;
	applicationSchemaExists: boolean;
	objects: FingerprintedObjectV1[];
	unsupportedObjects: Array<{
		kind:
			| "sequence"
			| "view"
			| "materializedView"
			| "foreignTable"
			| "partitionedTable"
			| "enum"
			| "domain"
			| "compositeType"
			| "function"
			| "procedure"
			| "trigger"
			| "policy"
			| "rule"
			| "other";
		qualifiedIdentity: string;
		attachedTo: string | null;
	}>;
	externalDependencies: Array<{
		kind: "type" | "collation" | "defaultFunction" | "operatorClass";
		schema: string;
		name: string;
		extension: string | null;
	}>;
	installedRequiredExtensions: string[];
}

type FingerprintedObjectV1 =
	| { kind: "schema"; name: string }
	| {
			kind: "table";
			name: string;
			persistence: "permanent";
			rowSecurityEnabled: false;
			rowSecurityForced: false;
	  }
	| {
			kind: "column";
			table: string;
			name: string;
			type: PostgreSqlFieldTypeV1;
			nullable: boolean;
			default:
				| null
				| { kind: "literal"; value: null | boolean | number | string }
				| { kind: "randomUuid" | "now" };
			identity: "none";
			generated: "none";
			collation: "pg_catalog.C" | null;
	  }
	| {
			kind: "primaryKey" | "unique";
			table: string;
			name: string;
			fields: string[];
			validated: boolean;
			deferrable: boolean;
			initiallyDeferred: boolean;
	  }
	| {
			kind: "check";
			table: string;
			name: string;
			expression: FingerprintCheckExpressionV1;
			validated: boolean;
	  }
	| {
			kind: "foreignKey";
			table: string;
			name: string;
			fields: string[];
			referencedTable: string;
			referencedFields: string[];
			onDelete: "restrict" | "cascade" | "setNull" | "noAction";
			onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
			validated: boolean;
			deferrable: boolean;
			initiallyDeferred: boolean;
	  }
	| {
			kind: "index";
			table: string;
			name: string;
			method: "btree";
			unique: false;
			fields: Array<{
				field: string;
				order: "asc" | "desc";
				nulls: "first" | "last";
				operatorClass: "typeDefault";
				collation: "field" | null;
			}>;
			predicate: null;
			valid: boolean;
			ready: boolean;
	  };

type FingerprintCheckExpressionV1 =
	| { kind: "field"; field: string }
	| { kind: "literal"; value: null | boolean | number | string }
	| { kind: "textLength"; expression: FingerprintCheckExpressionV1 }
	| {
			kind: "compare";
			operator:
				| "equal"
				| "notEqual"
				| "lessThan"
				| "lessThanOrEqual"
				| "greaterThan"
				| "greaterThanOrEqual";
			left: FingerprintCheckExpressionV1;
			right: FingerprintCheckExpressionV1;
	  }
	| { kind: "and" | "or"; expressions: FingerprintCheckExpressionV1[] }
	| { kind: "not"; expression: FingerprintCheckExpressionV1 }
	| {
			kind: "isNull" | "isNotNull";
			expression: FingerprintCheckExpressionV1;
	  };
```

`objects` and `unsupportedObjects` sort by `kind` and then their complete
physical identity fields. `externalDependencies` sort by `kind`, `schema`,
`name`, and `extension`, with null before text. `installedRequiredExtensions`
sorts by extension name. No catalog row order enters canonical bytes. Routine
`qualifiedIdentity` includes schema, name, input argument types, and procedure
kind so overloaded routines remain distinct. `observations`, including exact
server, database collation, character classification, and extension versions,
does not enter the Schema Fingerprint Digest.

The compiler-lowered dependency set is exact and deduplicated. Every Field adds
one `type` dependency in `pg_catalog`: `uuid`, `text`, `bool`, `int4`, `int8`,
`numeric`, `timestamp`, `timestamptz`, `date`, or `jsonb`. Every text Field adds
`collation:pg_catalog.C`. Every B-tree Index, including a primary/unique
backing Index, adds its Field's `operatorClass` dependency: `uuid_ops`,
`text_ops`, `bool_ops`, `int4_ops`, `int8_ops`, `numeric_ops`,
`timestamp_ops`, `timestamptz_ops`, or `date_ops`. JSON-backed Fields cannot
enter a v1 B-tree Index and therefore add no Index operator-class dependency.
A `randomUuid` or `now`
default adds `defaultFunction:pg_catalog.gen_random_uuid` or
`defaultFunction:pg_catalog.now`. Built-ins use `extension: null`; a dependency
owned by a configured extension records that extension name. For Genesis,
`externalDependencies` is empty. In every projection, expected
`installedRequiredExtensions` is exactly the identity-sorted configured
extension-name list; the live list contains exactly those names that are
installed, so equality detects a missing requirement.

The v1 PostgreSQL introspector maps catalog fields back into the same closed
types used by the Schema Projection. A fingerprint column uses
`PostgreSqlFieldTypeV1`, which contains only physical type attributes. Bounds
exist only as separately named check objects and are never duplicated in a
column type. All three JSON-backed Field variants lower to the physical
`{ kind: "jsonb" }` fingerprint type. Their embedded codec is intentionally not
recoverable from `pg_catalog`; local desired-versus-committed comparison guards
that semantic contract, while fingerprint comparison guards the column.
The compiler maps semantic Field references in expected checks to
physical Field names before comparison. The catalog parser maps supported
physical check expressions into `FingerprintCheckExpressionV1`; it never needs
the Schema Projection to invent semantic identities. It maps supported defaults
to their tagged forms and reads
foreign-key actions from catalogs, and reads Index Field order and null order
as separate values. It maps the default operator class for the Field type to
`typeDefault` and the Field's explicit `pg_catalog.C` collation to `field`.
A database-default or another collation enters `unsupportedObjects`. It does
not hash PostgreSQL deparser
text. With `search_path = pg_catalog`, it may parse `pg_get_expr` output as an
input, removes redundant parentheses and type-compatible implicit casts, maps
operators and `char_length` to the closed AST, and then hashes only that AST.
Golden fixtures run on every supported PostgreSQL major. An expression outside
the v1 grammar enters
`unsupportedObjects`. An Index referenced by `pg_constraint.conindid` is
represented by its primary or unique Constraint and is excluded from Index
objects; only separately authored Indexes enter the Index array.

Physical column ordinal does not enter the comparable value. QUESTPIE addresses
Fields by name and emits explicit selections; PostgreSQL appends later Fields,
so ordinal is history-dependent and cannot be derived from desired state.

The fingerprint enumerator also inspects namespaces, `pg_class` relation kinds,
types, routines, triggers attached to application tables, policies, and rules.
Anything in the application schema that cannot appear in
`FingerprintedObjectV1` enters `unsupportedObjects` and therefore drift. An
identity or generated column, a unique authored Index, or enabled/forced table
RLS is unsupported in schema artifact v1 and therefore drift. An
external dependency is allowed only when PostgreSQL identifies it as a
`pg_catalog` built-in or as owned by an extension in `requiredPostgres`.
Schema artifact v1 exposes no author syntax for another external dependency.

The compiler lowers any Schema Projection into `FingerprintComparableV1` using
the exact same PostgreSQL names, physical Field types, defaults, Constraints,
Relations, and Index values. Inline shape nodes disappear while their leaf
columns remain; `object`, `array`, and `json` all lower to `jsonb`. The Genesis projection lowers to
`applicationSchemaExists: false` with empty object arrays. A non-Genesis
projection lowers to `applicationSchemaExists: true`. Comparison is exact
canonical JSON equality between this expected comparable value and the live
fingerprint's `comparable` value. Provider compatibility compares
`observations` separately against `requiredPostgres`, including exact database
collation and character classification. V1 extension requirements assert
presence only; extension version ordering is not portable and is not part of
artifact v1.

The Schema Fingerprint Digest is SHA-256 of canonical `comparable` bytes prefixed by
`questpie-schema-fingerprint-v1\0`. Local and managed PostgreSQL with the same
semantic catalog state therefore have the same digest even when server or
extension versions differ within the required profile.

Drift is reported in two comparisons:

| Comparison                                 | Drift class                                                                                                                               | Severity                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| local chain vs receipts                    | `pendingMigration`, `missingLocalMigration`, `unknownAppliedMigration`, `orderMismatch`, `checksumMismatch`, `applicationBindingMismatch` | informational for pending; otherwise fatal   |
| applied-head Schema Projection vs database | `missingObject`, `unexpectedObject`, `changedObject`, `invalidObject`, `undeclaredDependency`                                             | blocking                                     |
| current vs committed Schema Projection     | `unplannedDesiredChange`                                                                                                                  | blocking for deploy, expected while planning |
| required provider profile vs database      | `unsupportedPostgres`, `missingExtension`, `incompatibleExtension`                                                                        | blocking                                     |

Each stored diagnostic includes comparison, class, semantic identity when
known, physical name, expected canonical fragment, actual canonical fragment,
containing Resource identity, current Origin locations, and exact next commands.
Summary and recovery strings use the frozen v1 renderer and golden vectors.
Origin never enters Migration Plan bytes. QUESTPIE never prints a database URL,
environment value, registry credential, or source text.

An external table, index, trigger, or function inside the application schema is
`unexpectedObject`. An object outside the application schema is ignored unless
a managed object depends on it. A declared extension dependency is allowed.

## 9. Seeds

```ts
// src/data/demo-seed.ts
import { defineSeed, seed } from "questpie";

import { appointments } from "./appointments";
import { tenants } from "./tenants";

export const demoBarbershop = defineSeed({
	name: "barbershop.demo.v1",
	dependsOn: [],
	steps: [
		seed.insert(tenants, {
			id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			slug: "downtown",
			name: "Downtown Barbers",
		}),

		seed.insert(appointments, {
			id: "018f5f70-0a0c-7f11-89f9-2aa4f8df3945",
			tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			customerName: "Nina Horvath",
			startsAt: "2026-08-11T09:00:00.000Z",
			endsAt: "2026-08-11T09:30:00.000Z",
			status: "scheduled",
		}),
	],
});
```

A Seed identity is `seed:<qualified-name>`. V1 Seeds are immutable and `once`;
the mode is therefore not an author option. The compiler writes and version
control commits this artifact:

```text
questpie/seeds/barbershop.demo.v1/
  seed.json
  steps.json
  checksum.sha256
```

```ts
interface SeedMetadataV1 {
	format: "questpie.seed";
	version: 1;
	identity: `seed:${string}`;
	dependencies: Array<`seed:${string}`>;
	stepsDigest: string;
}

type SeedStepV1 =
	| { stepId: string; kind: "insert"; collection: string; values: SeedRecordV1 }
	| {
			stepId: string;
			kind: "update";
			collection: string;
			key: SeedPrimaryKeyV1;
			values: SeedRecordV1;
	  }
	| {
			stepId: string;
			kind: "upsert";
			collection: string;
			key: SeedPrimaryKeyV1;
			create: SeedRecordV1;
			update: SeedRecordV1;
	  }
	| {
			stepId: string;
			kind: "delete";
			collection: string;
			key: SeedPrimaryKeyV1;
	  };

type SeedRecordV1 = Array<{
	field: FieldIdentityV1;
	value: SeedValueV1;
}>;

type SeedPrimaryKeyV1 = Array<{
	field: FieldIdentityV1;
	value: Exclude<SeedValueV1, null>;
}>;

type SeedValueV1 =
	| null
	| boolean
	| number
	| string
	| {
			kind: "uuid" | "bigint" | "numeric" | "date" | "timestamp";
			value: string;
	  }
	| { kind: "json"; value: CanonicalJsonValue };
```

Dependencies sort by identity. `seed.insert`, `seed.update`, `seed.upsert`, and
`seed.delete` construct data-only steps; they do not receive a callback. The
compiler resolves Collection and Field identities, applies the closed scalar
or JSON-backed Field codec, and writes the authored step order to `steps.json`.
An inline leaf is addressed by its complete Field identity. A typed object or
array is one tagged `json` value for its owning Field, never a set of synthetic
embedded Field entries. The tag preserves the distinction between SQL `NULL`
and JSON `null`; typed embedded values are also validated against their closed
codec before artifact emission. A key contains
every Field of the Collection's primary key exactly once, contains no other
Field, and contains no null. Unique Constraints are not Seed keys in v1.
Within each step, `values`, `key`, `create`, and `update` entries sort by Field
identity. Only the outer `steps` array preserves authored order.
`stepId` is SHA-256 of the
canonical step without `stepId`, prefixed by `questpie-seed-step-v1\0`.

An insert issues one `INSERT` and any conflict fails the Seed transaction. An
update or delete uses equality over the complete primary key and must affect
exactly one row; zero or multiple rows reports `QP-SEED-012
cardinalityMismatch` and rolls back. For an upsert, `create` and `update` may
not repeat a key Field, and `create` plus the key must form a valid insert.
QUESTPIE emits `INSERT ... ON CONFLICT (<primary-key>) DO UPDATE`; the statement
must return exactly one row. Seed steps execute in stored array order. These
rules prevent a no-op from receiving a once-only Seed Receipt.

V1 has no Seed callback, arbitrary SQL, module bundle, Service, environment,
filesystem, network, subprocess, or runtime import seam in the deploy runner.
The runner interprets only `SeedStepV1` inside its PostgreSQL transaction. The
authoring module executes inside the same Controlled Structural Evaluator as
other Definitions. A forbidden top-level effect reports `QP-COMPOSE-010`; the
evaluator provides deterministic compilation but is not a security sandbox for
hostile code.

As with migration apply, operators must stop uncooperative external DDL while
a Seed runs. The preflight Schema Fingerprint blocks an already-present trigger
or unsupported routine before data writes; v1 does not claim to serialize a
concurrent external DDL session that ignores the QUESTPIE lock.

The Seed checksum is SHA-256 over:

```text
questpie-seed-v1\0
<seed.json bytes>\0
<steps.json bytes>
```

`stepsDigest` is SHA-256 of canonical `steps.json` bytes prefixed by
`questpie-seed-steps-v1\0`. `checksum.sha256` contains the complete Seed
checksum as 64 lowercase hexadecimal characters and one LF.

The runner topologically sorts requested Seeds by dependency identity. A
missing dependency, cycle, failed dependency, step incompatibility with the
current Schema Projection, or checksum mismatch blocks execution. A Seed
artifact does not contain a target Schema Projection Digest: an unrelated later
migration therefore cannot change an applied Seed checksum. Before a pending
Seed runs, QUESTPIE validates every referenced Collection, Field, primary key,
and canonical value against the current applied Schema Projection.

Seed run acquires the same application session lock as migration apply. It
cannot race a schema migration. A run request always gets an attempt ID. If an
equal receipt already exists, the runner appends `alreadyApplied` at sequence 0
and returns without executing data steps. For a pending Seed, the runner uses
only the current Migration Receipt head; a historical receipt cannot authorize
execution. Inside the Seed transaction, QUESTPIE introspects before the
first write and requires the live Schema Fingerprint to equal that head. A
mismatch appends `blocked` with `QP-SEED-014 seedSchemaDrift` after rollback. Seed
run requires the existing application binding and cannot create the first
binding.

For each attempt, the runner appends `started` with sequence 0 before the Seed
transaction. Seed writes, the immutable Seed Receipt, and `succeeded` with
sequence 1 commit in one transaction. On rollback, the runner appends `failed`
with sequence 1. A crash before commit leaves `started` and no receipt; the next
runner appends `interrupted` before it creates another attempt. A crash after
commit leaves both the receipt and `succeeded`, so a response-lost retry returns
`alreadyApplied` without recording an interruption or executing Seed code.

Changing Seed code under an applied identity causes
`QP-SEED-004 checksumMismatch`. The recovery is to restore the committed Seed
or create a new identity such as `barbershop.demo.v2` that depends on v1. V1
has no `--force` and no mutable repeatable Seed.

## 10. CLI and local UX

```bash
# Compile desired state. No database write.
bunx questpie schema compile

# Compare desired state, committed history, and the configured database.
bunx questpie migration plan --name create-appointments

# Use the path and digest printed by the plan command.
export PLAN_DIGEST=6b17c2d908d4d6e70f0d22a2f96bf9d38d0c6d2406c5974138270ebd46f4f70a
export PLAN_FILE=".questpie/plans/$PLAN_DIGEST.json"

# Preserve a reviewed safe or guarded plan as migration 000001.
bunx questpie migration create --plan "$PLAN_FILE"

# Preserve a reviewed destructive plan. The digest is the acknowledgement.
bunx questpie migration create \
  --plan "$PLAN_FILE" \
  --accept-destructive "$PLAN_DIGEST"

# Verify checksums, apply pending committed migrations, and verify drift.
bunx questpie migration apply
bunx questpie schema drift

# Show and run immutable Seeds.
bunx questpie seed status
bunx questpie seed run barbershop.demo.v1
```

`questpie migration dev --name NAME` is the only combined local command. It
compiles, plans, prints the complete classification and SQL, and asks for the
Plan Digest. After confirmation it creates the same Committed Migration, applies
it through the same runner, and verifies drift. In a non-interactive terminal,
the command requires `--accept-plan "$PLAN_DIGEST"` for safe or guarded work,
or `--accept-destructive "$PLAN_DIGEST"` for a destructive Migration Plan. A generic
accept flag cannot acknowledge destruction. It never applies an ephemeral Migration Plan
and never treats the generated Migration Plan file as committed or applied history.

The CLI uses exit `0` for success, already-applied, and no-drift results; `2`
for command, configuration, or Definition errors; `3` when guarded or
destructive confirmation is required; `4` for artifact, history, provider, or
drift blocks; and `5` for a failed database statement or unavailable database.
Diagnostics are JSON serializable. `--format json` emits the same diagnostic
codes and recovery commands shown in human output.

## 11. Transaction and idempotency boundaries

| Operation        | Database boundary                                    | Idempotency authority                                  |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| compile          | no database                                          | canonical Schema Projection bytes and digest           |
| plan             | read-only snapshot                                   | canonical Migration Plan bytes and digest              |
| create migration | filesystem only                                      | existing identity plus exact Committed Migration bytes |
| apply migration  | one transaction per migration under one session lock | Migration Receipt identity plus checksum               |
| verify drift     | read-only snapshot                                   | Schema Fingerprint Digest                              |
| run Seed         | one transaction per Seed                             | Seed Receipt identity plus checksum                    |

There is no transaction that spans filesystem commit and PostgreSQL commit.
Version control reviews the files; the database receipt proves application.
Deploy tooling must ship an immutable artifact before it calls apply.

## 12. Hostile-case matrix

| Case                                              | Required behavior                                    | Diagnostic or proof                                |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| File or export rename only                        | Schema Projection Digest unchanged                   | byte-stability fixture                             |
| Regular Collection has zero or two primary keys   | compile fails; no Schema Projection                  | `QP-SCHEMA-001 invalidDefinition`                  |
| Dotted nested path is supplied                    | treated as one key, never split                      | segment-array identity fixture                     |
| SQL `NULL` and top-level JSON `null`              | distinct outer-null and tagged-JSON values           | codec/Seed golden                                  |
| Definition order changes                          | Schema Projection and Migration Plan bytes unchanged | permutation test                                   |
| Two semantic members map to one physical name     | compile fails                                        | `QP-SCHEMA-006 physicalNameCollision`              |
| Name exceeds PostgreSQL limit                     | deterministic hash suffix                            | 63-byte fixture                                    |
| Rename without mapping                            | add plus destructive removal                         | exact destructive Migration Plan fixture           |
| Destructive plan without digest acknowledgement   | no artifact created                                  | `QP-SCHEMA-020 destructiveAcknowledgementRequired` |
| Acknowledgement names an older plan               | no artifact created                                  | `QP-SCHEMA-021 planDigestMismatch`                 |
| Edited committed SQL                              | apply stops before SQL                               | `QP-SCHEMA-023 checksumMismatch`                   |
| Applied migration absent locally                  | apply and deploy stop                                | `QP-SCHEMA-024 unknownAppliedMigration`            |
| Two runners apply together                        | one waits or times out                               | advisory-lock integration test                     |
| Response lost after migration commit              | retry returns `alreadyApplied`                       | receipt integration test                           |
| SQL fails halfway                                 | all DDL and receipt roll back                        | transaction test                                   |
| Concurrent index requested                        | plan blocked                                         | `QP-SCHEMA-031 nonTransactionalDdl`                |
| External DDL changes a Field                      | drift blocks apply                                   | `changedObject` fingerprint test                   |
| External object added in app schema               | drift blocks deploy                                  | `unexpectedObject` test                            |
| External table outside app schema                 | ignored unless referenced                            | scope fixture                                      |
| Required extension absent                         | apply stops before SQL                               | `missingExtension`                                 |
| Seed dependency cycle                             | no Seed runs                                         | `QP-SEED-002 seedDependencyCycle`                  |
| Seed checksum changes after success               | no Seed runs                                         | `QP-SEED-004 checksumMismatch`                     |
| Seed fails after writes                           | writes and receipt roll back                         | transaction test                                   |
| Response lost after Seed commit                   | retry returns `alreadyApplied`                       | receipt integration test                           |
| Process dies during Seed                          | next run records interruption and retries            | crash test                                         |
| Seed contains a callback, SQL, or external effect | compile fails                                        | `QP-SEED-009 unsupportedSeedStep`                  |

## 13. Overengineering audit

### Kept because the tracer needs the guarantee

- semantic member identities, because rename and collision behavior otherwise
  depends on source layout;
- canonical Schema Projection, Migration Plan, Schema Fingerprint, and checksums, because agents and CI
  need reviewable facts;
- one advisory lock and immutable receipts, because duplicate apply and lost
  responses are required hostile cases;
- a separate application schema, because complete drift has no honest boundary
  in a shared unowned namespace;
- exact destructive acknowledgement, because a generic `--force` can approve a
  different plan after source changes;
- immutable once Seeds, because this is the smallest provable idempotency
  contract.

### Deleted or deferred

- no migration DAG, branch auto-merge, down migration, or rollback generator;
- no online multi-phase runner or non-transactional DDL;
- no schema adoption, pull, push, or database-first generation;
- no generic migration plugin or public SQL-AST SPI;
- no handwritten migration SQL in the v1 artifact;
- no enum Field, expression Index, partial Index, exclusion Constraint,
  partitioning, views, functions, triggers, or RLS syntax in this slice;
- no repeatable, environment-specific, or external-effect Seed;
- no second migration table per Package and no Package-owned migrator;
- no database-neutral naming or type layer.

### Accepted risks

1. Regular index creation can block writes. The tracer uses a small database;
   production online DDL remains a required later grill.
2. A linear sequence creates merge conflicts across branches. An explicit
   replan is safer than an unproven migration DAG.
3. Complete drift treats manual DDL in the application schema as an error. Raw
   data writes remain supported; schema changes must use the lifecycle.
4. The check-expression DSL and v1 Field set are deliberately narrow. A later
   grammar can add tagged variants without changing existing artifact meaning.

## 14. Implementation queue

Published implementation map: [GitHub issue #261](https://github.com/questpie/questpie/issues/261).
Its native sub-issues and dependency links are the future execution queue.
None is ready for implementation until the remaining tracer-critical concept
gates in `SPEC.md` are accepted.

## 15. Implementation stop conditions

Stop and return to design if implementation requires any of these changes:

- a second source of desired schema state;
- an ORM value in a public Definition or emitted declaration;
- discovery order in an identity, name, step, or checksum;
- a database write during planning or migration creation;
- migration SQL whose expected fingerprint is not in the artifact;
- a non-transactional v1 step;
- a mutable applied migration or Seed;
- a Seed callback, SQL step, runtime import, or external effect seam;
- an exception to drift that cannot be expressed as a declared dependency.
