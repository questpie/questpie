---
title: Model data and structural Queries
description: Define explicit PostgreSQL Collections and compile one exact, typed read shape.
status: design-fiction
implementation-status: unimplemented
contract-status: foundational-data-contract-accepted
---

# Model data and structural Queries

In this chapter you expand the collaboration application into Companies,
Spaces, Channels, two explicit Membership join models, and Messages. You then
compile one closed structural Query for a Channel feed.

The page is design fiction because the v4 implementation does not exist yet.
The Field, Collection, Constraint, Relation, nested-data, and structural Query
contract shown here is accepted. The later Policy and Operation contracts do
not change its schema, selection, ordering, cursor, or generated row types.

## Define the complete collaboration model

Keep this example in one file while learning the model. These exports can move
to ordinary TypeScript modules later; file paths and export names record Origin
but do not create Resource identity.

```ts title="src/model/collaboration.ts"
import {
	constraint,
	defineCollection,
	field,
	index,
	relation,
	relationRef,
	shape,
	value,
} from "questpie";

export const companies = defineCollection({
	name: "companies",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		slug: field.text({ nullable: false, maxLength: 80 }),
		name: field.text({ nullable: false, maxLength: 160 }),
		address: shape.inline({
			fields: {
				city: field.text({ nullable: false, maxLength: 160 }),
				postalCode: field.text({ nullable: true, maxLength: 24 }),
			},
		}),
		preferences: field.object({
			nullable: false,
			properties: {
				locale: value.text({ nullable: false, maxLength: 16 }),
				digestEmail: value.boolean({ nullable: false }),
			},
		}),
		tags: field.array({
			nullable: false,
			maximumItems: 50,
			items: value.text({ nullable: false, maxLength: 40 }),
		}),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		slugUnique: constraint.unique({ fields: ["slug"] }),
	},
	indexes: {
		byAddressCity: index({
			fields: [{ field: ["address", "city"], order: "asc" }],
		}),
	},
	relations: {
		spaces: relation.toMany({
			inverseOf: relationRef("spaces", "company"),
		}),
		memberships: relation.toMany({
			inverseOf: relationRef("companyMemberships", "company"),
		}),
		messages: relation.toMany({
			inverseOf: relationRef("messages", "company"),
		}),
	},
});

export const spaces = defineCollection({
	name: "spaces",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		slug: field.text({ nullable: false, maxLength: 80 }),
		name: field.text({ nullable: false, maxLength: 160 }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		companySlugUnique: constraint.unique({
			fields: ["companyId", "slug"],
		}),
	},
	indexes: {
		byCompanyAndName: index({
			fields: ["companyId", { field: "name", order: "asc" }],
		}),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
		channels: relation.toMany({
			inverseOf: relationRef("channels", "space"),
		}),
	},
});

export const channels = defineCollection({
	name: "channels",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		spaceId: field.uuid({ nullable: false }),
		slug: field.text({ nullable: false, maxLength: 80 }),
		name: field.text({ nullable: false, maxLength: 160 }),
		visibility: field.text({
			nullable: false,
			maxLength: 24,
			default: "company",
		}),
		archived: field.boolean({ nullable: false, default: false }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		spaceSlugUnique: constraint.unique({ fields: ["spaceId", "slug"] }),
	},
	indexes: {
		bySpaceAndName: index({
			fields: ["spaceId", { field: "name", order: "asc" }],
		}),
	},
	relations: {
		space: relation.toOne({
			target: spaces,
			fields: ["spaceId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
		memberships: relation.toMany({
			inverseOf: relationRef("channelMemberships", "channel"),
		}),
		messages: relation.toMany({
			inverseOf: relationRef("messages", "channel"),
		}),
	},
});

export const companyMemberships = defineCollection({
	name: "companyMemberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		role: field.text({ nullable: false, maxLength: 24, default: "member" }),
		status: field.text({ nullable: false, maxLength: 24, default: "active" }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		principalInCompanyUnique: constraint.unique({
			fields: ["companyId", "principalId"],
		}),
	},
	indexes: {
		byPrincipalAndStatus: index({
			fields: ["principalId", { field: "status", order: "asc" }],
		}),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
	},
});

export const channelMemberships = defineCollection({
	name: "channelMemberships",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		channelId: field.uuid({ nullable: false }),
		principalId: field.uuid({ nullable: false }),
		status: field.text({ nullable: false, maxLength: 24, default: "active" }),
		canPost: field.boolean({ nullable: false, default: true }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		principalInChannelUnique: constraint.unique({
			fields: ["channelId", "principalId"],
		}),
	},
	indexes: {
		byPrincipalAndStatus: index({
			fields: ["principalId", { field: "status", order: "asc" }],
		}),
	},
	relations: {
		channel: relation.toOne({
			target: channels,
			fields: ["channelId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
	},
});

export const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		channelId: field.uuid({ nullable: false }),
		authorId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, maxLength: 20_000 }),
		state: field.text({ nullable: false, maxLength: 24, default: "published" }),
		metadata: field.json({ nullable: true }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	indexes: {
		byChannelAndCreatedAt: index({
			fields: ["channelId", { field: "createdAt", order: "asc" }],
		}),
		byCompanyAndState: index({
			fields: ["companyId", { field: "state", order: "asc" }],
		}),
	},
	relations: {
		company: relation.toOne({
			target: companies,
			fields: ["companyId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
		channel: relation.toOne({
			target: channels,
			fields: ["channelId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
	},
});
```

Every regular Collection has exactly one named `primary` Constraint. The name
is local to its Collection. `id` remains an ordinary UUID Field; QUESTPIE has
no `field.id()` or `primaryKey: true` shortcut.

`createdAt` and `updatedAt` are also ordinary Fields. `default: "now"`
initializes them on insert. It does not advance `updatedAt` on later writes;
the transaction-owned Mutation contract must request that behavior.

An owning `relation.toOne` stores the foreign key and defines its PostgreSQL
Constraint. An explicit `relation.toMany` is the non-owning inverse used for
traversal. `relationRef("channels", "space")` resolves to one semantic Relation
identity at compile time; it is not a broad runtime string lookup. The inverse
does not add a PostgreSQL object or mutate the target Collection.

The two Membership Collections are ordinary normalized join entities. They
have IDs, keys, Relations, Indexes, and independent lifecycle. QUESTPIE does
not replace either of them with an embedded array or a synthetic many-to-many
Relation.

## Choose where nested data lives

The `companies` Definition demonstrates all three nested-value models. They
have intentionally different capabilities.

| Authoring form                 | PostgreSQL storage                                | Use it for                                                                                                                    | It cannot do                                                                                   |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `shape.inline`                 | one ordinary column per leaf Field                | a visual group whose leaves need Field identity, independent nullability, Constraints, Indexes, Relations, or Query operators | own a value, nullability, default, codec, or column                                            |
| `field.object` / `field.array` | one JSONB column with a closed `value.*` codec    | a bounded typed value with no identity or independent lifecycle                                                               | give embedded properties Field identity, Relations, Indexes, Policy, or structural Query paths |
| `field.json`                   | one JSONB column with a tagged open JSON boundary | arbitrary JSON whose interior is deliberately outside the typed data model                                                    | expose typed properties, whole-value equality, or interior Query paths in v1                   |
| explicit Collection + Relation | normalized rows                                   | an entity with identity, Relations, independent Policy, unbounded growth, querying, pagination, or lifecycle                  | be created implicitly from nested syntax                                                       |

QUESTPIE never synthesizes hidden mini-Collections from any nested form.

`address` is not a stored container. `city` is an ordinary column Field with
identity `collection:companies/field:address/field:city` and canonical path
`["address", "city"]`. The Index uses that segment tuple. QUESTPIE never parses
`"address.city"` as a path; that text would be one unrelated member key.

`preferences` and `tags` each occupy one JSONB column. Their interiors use
`value.*`, not `field.*`. Arrays preserve order and duplicates. Every embedded
array declares `maximumItems` from 1 through 1,000, embedded nesting stops at
eight containers, and each JSONB-backed Field has at most 1,048,576 canonical
UTF-8 JSON bytes. A deployment can lower these limits but cannot raise them.

`metadata` accepts a tagged open JSON value. These two values are different:

```ts
const sqlNull = null;
const jsonNull = { kind: "json", value: null };
```

The outer `null` is SQL `NULL`. The tagged value is JSON `null` stored inside
JSONB. Open JSON rejects `undefined`, sparse arrays, non-finite numbers,
non-plain objects, and values beyond the byte limit.

## Compile the generated Data Contract

Run `sync` after the Collection Definitions exist:

```bash
bunx questpie sync
```

The compiler resolves every Field path, key, Relation endpoint, and accepted
Collection contribution. It emits one concrete Data Contract under the
generated application import. Its shape is equivalent to this shortened
excerpt:

```ts title=".questpie/generated/app.ts (excerpt)"
export interface AppContract {
	data: {
		collections: {
			messages: {
				name: "messages";
				identity: "collection:messages";
				fields: {
					id: DataFieldDescriptor<
						"collection:messages/field:id",
						{ kind: "uuid" },
						string,
						false,
						true
					>;
					channelId: DataFieldDescriptor<
						"collection:messages/field:channelId",
						{ kind: "uuid" },
						string,
						false,
						false
					>;
					createdAt: DataFieldDescriptor<
						"collection:messages/field:createdAt",
						{ kind: "timestamp"; withTimezone: true },
						string,
						false,
						true
					>;
					// Every other Message Field is concrete here too.
				};
				uniqueConstraints: {
					primary: {
						kind: "primaryKey";
						identity: "collection:messages/constraint:primary";
						fields: readonly ["id"];
					};
				};
				row: {
					id: string;
					companyId: string;
					channelId: string;
					authorId: string;
					body: string;
					state: string;
					metadata: { kind: "json"; value: JsonValue } | null;
					createdAt: string;
					updatedAt: string;
				};
				insert: {
					id?: string;
					companyId: string;
					channelId: string;
					authorId: string;
					body: string;
					state?: string;
					metadata?: { kind: "json"; value: JsonValue } | null;
					createdAt?: string;
					updatedAt?: string;
				};
				update: {
					id?: string;
					companyId?: string;
					channelId?: string;
					authorId?: string;
					body?: string;
					state?: string;
					metadata?: { kind: "json"; value: JsonValue } | null;
					createdAt?: string;
					updatedAt?: string;
				};
				relations: {
					channel: {
						kind: "toOne";
						identity: "collection:messages/relation:channel";
						target: ChannelDescriptor;
					};
				};
			};
			// companies, spaces, channels, companyMemberships,
			// and channelMemberships are exact members too.
		};
	};
}

export type AppData = AppContract["data"];
```

The actual generated declaration contains every Field and Relation. A Relation
target repeats only its target name, identity, and shallow Field descriptors;
it does not create a recursive application type. Public declarations contain
no ORM type, `any`, broad Collection name, or ambient registry.

Read, insert, and update shapes come from the same Field contract. A default or
nullable Field is optional on insert. Every Field is optional in the structural
update shape, but Runtime validation rejects an empty patch. That shape does
not grant write authority; the later Mutation and Policy contract does.

## Define one closed Channel feed

The generated `AppData` type supplies the Collection descriptor to the outer
factory call. The inner call then infers this Query's exact parameters,
selection, filter, Relations, order, and result.

```ts title="src/queries/channel-feed.ts"
import type { AppData } from "#questpie/app";
import { dataQuery, query } from "questpie";

export const channelFeedData = dataQuery<AppData["collections"]["messages"]>()({
	from: "messages",
	parameters: {
		channelId: query.parameter.uuid({ nullable: false }),
		states: query.parameter.list(query.parameter.text(), {
			maximumItems: 4,
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
		channelId: fields.channelId,
		authorId: fields.authorId,
		body: fields.body,
		state: fields.state,
		metadata: fields.metadata,
		createdAt: fields.createdAt,
		channel: relations.channel.select(({ fields: channel }) => ({
			name: channel.name,
			visibility: channel.visibility,
		})),
	}),
	where: ({ fields, relations, parameters }) =>
		query.and(
			fields.channelId.equal(parameters.channelId),
			fields.state.in(parameters.states),
			relations.channel.exists(({ fields: channel }) =>
				channel.archived.equal(false),
			),
		),
	orderBy: ({ fields }) => [
		fields.createdAt.descending({ nulls: "last" }),
		fields.id.descending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
```

This is a structural Data Query, not a network Operation and not an executable
handler. Another staged chapter binds it to an Operation. Its callbacks only
build a closed serializable expression tree; callback code does not enter the
canonical artifact.

The two factory stages solve a TypeScript constraint. Binding
`AppData["collections"]["messages"]` first gives `fields` and `relations` their
exact generated members without preventing the inner object from inferring its
own literal parameter names, output aliases, and order tuple. As a result:

- `fields.channelId` and `fields.state` expose only operators allowed by their
  codecs;
- `relations.channel` exposes the exact Channel Fields for one nested hop;
- `parameters.states` is a bounded `string[]`, not an expression or `unknown`;
- `from` is the literal `"messages"`, not a broad string;
- an unknown Field, Relation, parameter, or operator fails in the editor and
  compiler.

## Understand the inferred result

The Query returns this exact page shape when a later Operation runs it:

```ts
interface ChannelFeedResult {
	nodes: Array<{
		id: string;
		channelId: string;
		authorId: string;
		body: string;
		state: string;
		metadata: { kind: "json"; value: JsonValue } | null;
		createdAt: string;
		channel: { name: string; visibility: string } | null;
	}>;
	pageInfo: {
		endCursor: string | null;
		hasNextPage: boolean;
	};
}
```

A selected `toOne` Relation is nullable at the public boundary even when its
foreign-key Fields are required. V1 does not project `toMany` arrays. Use a
separate paginated Query for a collection-valued result.

All five Query clauses are explicit. `select` cannot be empty. Write
`where: null` for no filter. `orderBy` and `page` have no defaults. Every order
Field must be selected directly, and the order must end with every Field of one
non-null primary or unique key in declared order. QUESTPIE never appends a
hidden tie-breaker. Here, `id` completes the total order.

One structural Query becomes one PostgreSQL statement. The base rows, nested
one-hop selection, Relation predicate, and `first + 1` sentinel observe that
statement's snapshot. The Runtime returns at most `first` nodes and reads the
extra row only to compute `hasNextPage`. V1 has a hard page maximum of 100; a
deployment can lower it.

## Treat list parameters as sets

`states` is required, non-null, scalar, and bounded. Binding follows one exact
order:

1. Check the authored array length against `maximumItems` before deduplication.
2. Validate every member and reject null, `undefined`, sparse slots, or the
   wrong scalar codec.
3. Deduplicate members by canonical scalar bytes.
4. Sort the canonical members by those bytes.

The resulting operand is a semantic set. Input order and duplicates cannot
change the Query scope or cursor validity. The empty set is valid:
`field.in([])` is false and `field.notIn([])` is true, including when the Field
is null. A list bound above four items in this Query fails before PostgreSQL is
read, even if duplicates would reduce it below four.

## Traverse one declared Relation hop

`relations.channel.select(...)` projects one `toOne` hop. The nested result is
nullable. `relations.channel.exists(...)` keeps a Message only when a related,
non-archived Channel exists. `notExists(...)` is the exact `NOT EXISTS`
complement, including a null local key.

An `exists` predicate can use target scalar Fields and boolean combinators but
cannot traverse another Relation. Use `exists(query.always)` when only Relation
existence matters. Both owning `toOne` and explicit inverse `toMany` Relations
can appear in `exists` or `notExists`; only `toOne` can appear in selection.

## Treat the cursor as scoped data

The opaque forward cursor binds:

- the exact Query Template digest;
- canonical values for parameters used by the filter or Relation predicate;
- every ordered Field identity and its canonical value.

Changing a selected alias, Field codec, Relation identity, filter, ordering,
direction, null placement, or key Constraint invalidates the cursor. Changing
only `first` does not. On a mismatch, the client restarts with `after: null`.
The cursor is data, not Authority. The Policy chapter adds an equivalent
authorization scope before a cursor may cross Principals.

Every text Field uses semantic collation `questpie.binary`. QUESTPIE lowers it
to explicit PostgreSQL `COLLATE "C"` for equality, ranges, uniqueness, Indexes,
ordering, and cursor seeks. It stops if deterministic libc collation `C` under
UTF-8 is unavailable; it does not substitute the database default, `C.UTF-8`,
or ICU.

Each page observes its own database state. V1 does not preserve one snapshot
across several client requests. Concurrent inserts, deletes, or order changes
can move rows between pages.

## Know the v1 boundary

The closed structural grammar keeps compilation, PostgreSQL lowering, cursor
bytes, generated types, and dependency facts aligned.

| Supported now                                                                          | Deliberately later or unavailable in v1                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| exact scalar and whole JSONB-Field selection                                           | JSONB interior paths and whole-JSON equality                                                     |
| one-hop `toOne` selection                                                              | projected `toMany` arrays and second Relation hops                                               |
| scalar filters, null tests, bounded set membership, and one-hop Relation existence     | arbitrary joins, database functions, custom operators, and conditional AST branching             |
| explicit base-Collection order and forward cursor pages                                | implicit order, offset pages, backward pages, and unbounded lists                                |
| a maximum of 100 returned rows and `first + 1` sentinel read                           | unbounded reads and cross-request snapshots                                                      |
| declared dependencies for selected, filtered, related, ordered, cursor, and page reads | Policy and observed Live Query facts, which later chapters add without removing structural reads |

Aggregates, grouping, distinct, computed selection, window functions, locking,
search, native PostgreSQL statements, more Field kinds, and extension-backed
Fields need focused contracts. There is no generic `unsafe` expression or ORM
escape hidden inside `dataQuery`.

This chapter stops at pure data structure. Continue with
[Policy](./authorize-with-policy.md) for authorization and the
[guide staging map](./README.md#reader-journey) for Query, Mutation, realtime,
and durable execution. Those layers consume this accepted Data Contract; they
cannot silently reinterpret it.
