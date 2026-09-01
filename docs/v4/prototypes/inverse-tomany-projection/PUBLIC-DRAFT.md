# Bounded inverse child arrays

Status: post-acceptance public-documentation draft; not current product
authority

Use an inverse child list when a parent view needs a small, complete child
slice—for example, the newest comments on a ticket. The parent owns the name of
the inverse Relation; the child Collection owns the child filter, order,
selection, and exact result type.

## Declare the owning and inverse Relations once

The foreign key remains an ordinary owning `toOne` on `comments`:

```ts
// comments.ts
import { constraint, defineCollection, field, relation } from "questpie";
import { memberships } from "./memberships";
import { tickets } from "./tickets";

export const comments = defineCollection({
	name: "comments",
	fields: {
		id: field.uuid({ nullable: false }),
		ticketId: field.uuid({ nullable: false }),
		authorMembershipId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, minLength: 1, maxLength: 8_192 }),
		createdAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		ticket: relation.toOne({
			target: tickets,
			fields: ["ticketId"],
			references: ["id"],
		}),
		author: relation.toOne({
			target: memberships,
			fields: ["authorMembershipId"],
			references: ["id"],
		}),
	},
});
```

The inverse is an explicit non-owning member on `tickets`. It uses a literal
reference, so `tickets.ts` does not import `comments.ts` and the Collection
modules do not form a cycle:

```ts
// tickets.ts
import { defineCollection, relation, relationRef } from "questpie";

export const tickets = defineCollection({
	name: "tickets",
	// fields, constraints, Policy, and other Relations
	relations: {
		comments: relation.toMany({
			inverseOf: relationRef("comments", "ticket"),
		}),
	},
});
```

The inverse creates no column, foreign key, table, migration, endpoint, or
public CRUD surface. It names a traversal through the `comments.ticket`
Relation that already owns referential integrity.

## Select a bounded child list

Import the child Collection into the Query module and author the list there:

```ts
// ticket-queries.ts
import { codec } from "questpie";
import { defineQuery } from "#questpie/app";
import { comments } from "./comments";
import { tickets } from "./tickets";

export const ticketDetailPage = defineQuery({
	name: "tickets.detailPage",
	network: true,
	query: tickets.list({
		parameters: {
			ids: codec.list(codec.uuid(), { maximum: 1 }),
			first: codec.integer({ minimum: 1, maximum: 1 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row, parameters }) => row.id.in(parameters.ids),
		orderBy: { id: "asc" },
		select: {
			id: true,
			summary: true,
			comments: comments.list({
				first: 50,
				orderBy: { createdAt: "desc", id: "desc" },
				select: {
					id: true,
					body: true,
					createdAt: true,
					author: { select: { id: true, principalId: true } },
				},
			}),
		},
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
```

This named Query returns the normal structural page:

```ts
const page = await client.queries["tickets.detailPage"]({
	ids: [ticketId],
	first: 1,
	after: null,
});
const ticket = page.nodes[0] ?? null;
```

`ticket.comments` has the exact type
`readonly { id; body; createdAt; author: { id; principalId } | null }[]` when
all selected Fields are unconditionally disclosed. If Comment Policy makes
`body` conditional, the generated type is `body?: string` and a denied value is
omitted rather than replaced with `null`. The array is `[]`, not `null`, when
the parent has no authorized child. The outer result still has `nodes` and
`pageInfo`; nested `comments.list` is a structural selection, not a second
Query and not a network call.

The two `list` forms are deliberately easy for TypeScript and humans to tell
apart. A root list has `parameters` and `page`. A nested list has the literal
`first` bound and has neither. Mixing root pagination members into the nested
form is a compiler error.

If an application's existing public Operation returns `Ticket | null`, keep
that contract and run this structural page inside its handler. The child list
does not force a public page-shaped Operation or a compatibility endpoint.

Why the child owns the nested `list`: the inverse declaration intentionally
stores only the owning Relation identity. The `comments` Definition is the ordinary
TypeScript value that knows Comment Fields exactly. This keeps inference exact
without a global type registry or a generated authoring round trip.

## Filtering does not filter parents

An optional child filter changes only the array payload:

```ts
comments: comments.list({
	first: 20,
	where: ({ row }) => row.body.equal("public reply"),
	orderBy: { createdAt: "desc", id: "desc" },
	select: { id: true, body: true, createdAt: true },
});
```

A ticket still appears when this filter finds no comments. Parent-membership
quantifiers such as “tickets having a public comment” are a different Query
predicate and are not implied by a child selection.

## Bounds and ordering

- `first` is a literal from 1 through 50. A runtime number cannot change the
  compiled artifact bound.
- `orderBy` is required and must end in a declared child primary-key or unique
  Constraint. QUESTPIE never adds a hidden tie-breaker.
- Every child order Field must be selected directly and be unconditionally
  visible under selected-output Policy. Otherwise the Query is unavailable
  with `QP-DATA-008`, because relative order would disclose a protected value.
- One structural Query may contain one inverse list. Nested plural lists
  and child cursors are not supported.
- The complete traversal path may contain at most four Relation edges. The
  fifth fails at the authored source location with `QP-DATA-022`.
- A child list has no `pageInfo`. When users need continuation, expose an
  ordinary child Query whose root filter contains the parent key.

These rules keep one root page bounded to at most 5,050 flattened database rows
including its root sentinel. The decoded Operation result still has the common
1 MiB semantic result limit and a watched Query still has the common dependency
limit.

## Diagnostics and recovery

The compiler reports the authored path and Origin. It emits no partial
artifact.

| Diagnostic                           | Common cause                                                    | Recovery                                                              |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `QP-DATA-026 invalidInverseList`     | List comes from the wrong child Collection.                     | Use the Collection named by the inverse member's `inverseOf`.         |
| `QP-DATA-026 invalidInverseList`     | `first` is dynamic, zero, fractional, or greater than 50.       | Use a literal integer from 1 through 50.                              |
| `QP-DATA-026 invalidInverseList`     | `select` or `orderBy` is empty or names an unknown child Field. | Select at least one child member and use only child Fields.           |
| `QP-DATA-026 invalidInverseList`     | Order lacks a non-null primary-key or unique suffix.            | End the explicit order with the qualifying Constraint's Fields.       |
| `QP-DATA-008 orderFieldNotSelected`  | A child order Field is unselected or conditionally visible.     | Select it directly and use only unconditionally visible order Fields. |
| `QP-DATA-026 invalidInverseList`     | A second child list or child cursor appears in the Query.       | Keep one child list; use a separate child Query for continuation.     |
| `QP-DATA-022 relationDepthExceeded`  | The selected path reaches a fifth Relation edge.                | Shorten the selection or split it into another Query.                 |
| `QP-DATA-012 executionLimitExceeded` | Row, byte, duration, or dependency work exceeds a limit.        | Narrow the lists; no partial result is returned.                      |

## Policy and disclosure

The child Collection's current read admission and row Policy run inside the
same statement before child ordering and limit. A hidden child does not consume
one of the visible fifty slots. No child and all children hidden both produce
`[]`.

Selected-output Field Policy then applies to each authorized child in the same
way as a root or `toOne` selection. Direct execution, Fetch, the generated
client, and Live Query recomputation use the same linked plan and result
decoder. Failures never include SQL, table names, constraint names, Policy
evidence, protected values, or PostgreSQL messages.

## Transaction, retry, and cancellation

The root page and child list join one PostgreSQL statement and the same
read-only repeatable-read Query snapshot. QUESTPIE does not perform an N+1
query loop and does not add a JSON aggregation decoder.

QUESTPIE does not automatically retry the statement or Query handler. A new
caller attempt creates a fresh Context, Policy evaluation, and snapshot.
Cancellation or deadline expiry cancels the whole statement and returns no
partial parent or child payload.

Operational observations may identify the Query template, selected Relations,
bounded work, cancellation or limit class, and Live recomputation reason. They
do not contain child values, hidden cardinality, Policy evidence, SQL, or
PostgreSQL details.

For a watched Query, child inserts, updates, deletes, Relation moves, ordering
changes, empty-list misses, and reached child Policy facts enter the Live
Query dependency plan. A successful recomputation replaces the old dependency
plan; a cancelled or failed recomputation does not publish a partial result.

## When not to use a child list

Use a separate child Query when the child list needs independent pagination,
several filters chosen at runtime, or more than fifty items. Use a real
Collection and real Relations when values need database referential integrity.
An unchecked `{ kind, id }` pair is a discriminated value, not a polymorphic
Relation.
