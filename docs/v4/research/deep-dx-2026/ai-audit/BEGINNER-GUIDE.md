# QUESTPIE guide

- Status: draft documentation for the proposed authoring surface

QUESTPIE compiles your application's declarations into a PostgreSQL-native
runtime: schema and migrations, authorized reads and writes, live queries,
durable background work, and one generated, exactly-typed client. You write
ordinary TypeScript; the compiler proves the shape of everything before the
process starts, and Policy runs inside the same database snapshot or
transaction as the data it protects.

## The seven concepts

```text
Collection  stored domain data: fields, relations, constraints, provenance,
            Policy, and a fixed write lifecycle
Query       a named application read; can be watched live when the compiler
            proves it watchable
Mutation    a named application write in exactly one PostgreSQL transaction
Action      one external effect with an honest ambiguous-outcome story
Route       raw HTTP for webhooks, auth handlers, files, and streams
Job         durable background work accepted directly or inside a Mutation
Service     a constructed runtime dependency with an explicit lifetime
```

You learn them in this order: declare Collections; publish named Queries and
Mutations (only these enter the generated client); write Policy once per
Collection; accept Jobs when work must survive the response; mount Routes
and Services when a real protocol or provider is involved.

Imports come from three places:

```ts
// stable structural surface
import {
	defineCollection,
	defineSearch,
	definePolicy,
	defineService,
	codec,
	field,
	constraint,
	relation,
	relationRef,
	index,
	config,
	policy,
	expr,
	durable,
} from "questpie";
import type { PolicyScope, RowOperand } from "questpie";

// application-specialized executable factories (generated for your app)
import {
	defineQuery,
	defineMutation,
	defineAction,
	defineRoute,
	defineJob,
} from "#questpie/app";

// generated browser-safe client and named types
import { createClient } from "#questpie/client";
import { useQuery, useLiveQuery, useMutation } from "questpie/react";

// capability Packages keep their own namespaces
import * as geo from "@questpie/postgis";
import * as search from "@questpie/pg-search";
```

The exact capability npm names remain provisional. The namespace boundary is
not: core uses `field.*`, `codec.*`, `index.btree`, `constraint.*`, and
`relation.*`; PostGIS uses `geo.field.*`, `geo.codec.*`, `geo.index.*`; and
the Search Package uses `search.index.*`. Packages never mutate core
namespaces through ambient module augmentation.

## 1. Declare a Collection

```ts
// src/tickets.ts
import {
	constraint,
	defineCollection,
	field,
	index,
	relation,
	relationRef,
} from "questpie";

import { memberships } from "./memberships";
import { teams } from "./teams";

export const tickets = defineCollection({
	name: "tickets",
	fields: {
		id: field.uuid({ default: "randomUuid", server: true, immutable: true }),
		organizationId: field.uuid({ server: true, immutable: true }),
		teamId: field.uuid(),
		requesterMembershipId: field.uuid({ server: true, immutable: true }),
		assigneeMembershipId: field.uuid({ nullable: true }),
		reference: field.text({ minLength: 1, maxLength: 32, immutable: true }),
		priority: field.text({ maxLength: 16, default: "normal" }),
		status: field.text({ maxLength: 16, default: "open", server: true }),
		summary: field.text({ minLength: 1, maxLength: 240 }),
		description: field.text({ minLength: 1, maxLength: 16_384 }),
		createdAt: field.timestamp({
			default: "now",
			withTimezone: true,
			server: true,
			immutable: true,
		}),
		updatedAt: field.timestamp({
			default: "now",
			withTimezone: true,
			onUpdate: "now",
		}),
		closedAt: field.timestamp({
			nullable: true,
			withTimezone: true,
			server: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: { id: true } }),
		tenantReference: constraint.unique({
			fields: { organizationId: true, reference: true },
		}),
	},
	relations: {
		team: relation.toOne({
			target: teams,
			on: { teamId: "id" },
		}),
		requester: relation.toOne({
			target: memberships,
			on: { requesterMembershipId: "id" },
		}),
		assignee: relation.toOne({
			target: memberships,
			on: { assigneeMembershipId: "id" },
			onDelete: "setNull",
		}),
		// The child Collection declares `ticket: relation.toOne(...)` toward
		// this Collection; the inverse side references it by name, so no
		// circular import exists.
		comments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }),
	},
	lifecycle: {
		normalize: ({ input }) => ({
			...input,
			summary: input.summary?.trim(),
			reference: input.reference?.trim().toUpperCase(),
		}),
		validate: ({ candidate, errors }) => {
			if (candidate.status === "closed" && candidate.closedAt === null)
				throw errors.invalidCandidate("closed ticket requires closedAt");
		},
	},
	indexes: {
		tenantUpdated: index.btree({
			fields: {
				organizationId: true,
				updatedAt: { order: "desc", nulls: "last" },
				id: { order: "desc", nulls: "last" },
			},
		}),
	},
});
```

Every physical index is an explicit entry in the owning Resource's own
`indexes` map, named like this one (`tenantUpdated`); no Field ever creates
one implicitly, no matter its type. `index.btree(...)` is the one core index
constructor — core `index` stays B-tree-only (ADR-0019) — and it owns the
same identity/migration/readiness/drift/collision machinery as every other
named Index. Constraints, Relations, and Index all take the same
object-mapping/picker shape `select` uses instead of positional arrays:
`fields: { id: true }` picks a column set (authored key order is the column
order; `true` is documented shorthand, the expandable canonical form is
always an object); a Relation's `on: { localField: targetField }` maps join
columns directly instead of two parallel `fields`/`references` arrays that
must stay the same length and order. Both `index.btree` (replacing bare
`index(...)`) and the map spelling replacing the array spelling are real,
ledgered future supersessions of today's authoring API in
`docs/v4/schema-lifecycle.md` — not a formatting choice — recorded in the
packet's ledger (S15, S16).

Focused non-B-tree constructors under capability namespaces are a third real
supersession (S17), not an expansion of core `index`.

### Field provenance

Provenance says who may write a Field. It is the write surface; Policy then
decides per-request authority over that surface.

- default (no modifier): caller-writable on create and update;
- `immutable: true`: caller-writable on create, frozen afterwards;
- `server: true`: only the trusted `values` lane of a Mutation may supply
  it; it never appears in caller input;
- `server: true, immutable: true`: `values` on create only;
- `default: "..."`: the database default when no lane supplies a value; a
  nullable Field with no default and no assignment stores SQL `NULL`;
- `onUpdate: "now"`: database-owned; nobody may supply it; the database
  advances it on every write and the returned row carries the final value.

`nullable` defaults to `false`.

### Lifecycle

Collections own four fixed phases; there are no other hooks.

- `normalize({ input })`: pure and deterministic. Trim, case-fold, and
  canonicalize supplied values with ordinary TypeScript. No clock, random,
  network, or module state.
- `validate({ candidate, current?, errors, now })`: pure checks over the
  complete candidate row; `now` is the transaction-stable time.
- `check({ candidate, current?, ctx })`: bounded Policy-aware reads inside
  the owning transaction, for invariants that need current database facts.
- `afterWrite({ row, previous?, ctx })`: joins the same transaction. Its
  `ctx` carries the read/write kernel (`ctx.data`), Job acceptance
  (`ctx.jobs`), `ctx.now`, and `ctx.callId`, but no Services and no
  Actions; external effects never run inside a transaction. Every list
  read here takes an explicit bounded `first`, and all work counts into
  the owning Mutation's budgets, so a fan-out over a small bounded set
  (accepting one Job per row) is fine while an unbounded fan-out is not;
  keep large fan-outs out of the transaction.

There is no `afterRead`; shape reads with selections and Queries.

## 2. Read data with Queries

`collection.list(plan)` and `collection.get(plan)` build read plans. A Query
that is just a plan needs no handler; its input and output types and runtime
validation come from the plan.

```ts
// src/tickets/queries.ts
import { codec, expr, policy } from "questpie";

import { defineQuery } from "#questpie/app";

import { tickets } from "../tickets";
import { ticketSummary } from "./read-shapes";

export const ticketQueue = defineQuery({
	name: "tickets.queue",
	network: true, // callable from the generated client
	policy: policy.authenticated(),
	query: tickets.list({
		parameters: {
			status: codec.nullable(codec.list(codec.text(), { maximum: 8 })),
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row: ticket, parameters }) => ticket.status.in(parameters.status), // null = filter off, [] = none
		orderBy: { updatedAt: { direction: "desc", nulls: "last" }, id: "desc" },
		select: {
			...ticketSummary,
			labels: { list: { orderBy: { name: "asc" }, first: 5 } },
			commentCount: ({ row: ticket }) => ticket.comments.count(),
		},
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
```

The pieces:

- **parameters** are codecs. `codec.list(inner, { maximum })` is a bounded
  list with set semantics: `in([])` matches nothing, `notIn([])` matches
  everything. A `codec.nullable(...)` parameter used in a comparison makes
  it an _optional filter_: binding `null` turns the filter off. An optional
  filter must sit directly inside `expr.and(...)` (or stand alone as the
  whole filter) and must not appear under `expr.not` or as a bare `expr.or`
  branch; turning a filter off may only widen results.
- **where** callbacks receive `{ row, parameters }` operands. Compare with
  Field methods: `.equal`, `.in`, `.notIn`, `.isNull`, `.greaterThan`,
  `.lessThan`, `.descending` and friends. Combine with `expr.and`,
  `expr.or`, `expr.not`, `expr.always()`, `expr.never()`.
- **orderBy** is one object; its property order is the total order. Always
  end with a unique Field (usually `id`) for a stable order.
- **select** is `true` for the complete scalar row, an object of Field and
  Relation entries, or a reusable selection value spread in. A computed
  member is a callback whose body is exactly one relation aggregate call
  (today: `count()`).
- **page** wires bounded forward-cursor pagination; pages are capped at 100
  rows. `list` results are `{ nodes, pageInfo: { endCursor, hasNextPage } }`.

### Reusable selections

```ts
// src/tickets/read-shapes.ts
import { tickets } from "../tickets";

export const ticketSummary = tickets.select({
	id: true,
	reference: true,
	status: true,
	summary: true,
	updatedAt: true,
	team: { select: { id: true, name: true } },
});
```

A selection value is a plain object of its entries, so `...ticketSummary`
composes into a larger selection.

### Relations in selections

To-one relations nest `{ select }` and chain up to a bounded number of hops.
The exact ceiling is an implementation measurement, not yet ratified (see
the API reference):

```ts
team: { select: { id: true, organization: { select: { name: true } } } },
```

To-many relations load through `{ list: {...} }`:

- under a **plural** parent (a `list` Query), a nested list may only take a
  bounded top-N `first`, no cursor;
- under a **singular** parent (a `get` Query), a nested list may carry a
  real cursor page wired from the root parameters:

```ts
export const ticketDetail = defineQuery({
	name: "tickets.detail",
	network: true,
	policy: policy.authenticated(),
	query: tickets.get({
		parameters: {
			id: codec.uuid(),
			commentsFirst: codec.integer({ minimum: 1, maximum: 50 }),
			commentsAfter: codec.nullable(codec.cursor()),
		},
		where: ({ row: ticket, parameters }) => ticket.id.equal(parameters.id),
		select: {
			...tickets.select(true),
			comments: {
				list: {
					where: ({ row: comment }) => comment.kind.equal("public"),
					orderBy: { createdAt: "desc", id: "desc" },
					page: ({ parameters }) => ({
						first: parameters.commentsFirst,
						after: parameters.commentsAfter,
					}),
					select: { id: true, body: true, createdAt: true },
				},
			},
		},
	}),
});
```

`get` returns the row or `null`; a missing row and a row Policy hides are
the same `null`. A nested `where` filters the nested payload only; it never
removes the parent.

### Parent membership: quantifiers

To filter parents by their related rows, use `some`, `none`, or `every` on
the relation:

```ts
where: ({ row: ticket }) => expr.and(
  ticket.status.equal("open"),
  ticket.comments.some(({ row: comment }) =>
    comment.kind.equal("escalation")),
),
```

`some` over no rows is false; `none` is true; `every` is vacuously true.
Quantifiers and `count()` see only rows the caller is allowed to read, so a
hidden row behaves exactly like an absent row.

### Model the read around the Collection you page

Order and page the Collection whose fields carry your sort, then express
membership with quantifiers. “Tickets I watch, newest activity first” pages
`tickets` (which owns `updatedAt`) and filters by the watchers relation; it
does not page the join rows. `orderBy` accepts fields of the paged
Collection only; ordering by a related row's field is not supported.

### Reads scoped to the caller

A structural plan may read the immutable execution facts `principal`,
`tenant`, and declared Context `values`. They are typed operands, bound by
the Runtime rather than trusted from caller input:

```ts
export const myWatchedTickets = defineQuery({
	name: "tickets.myWatched",
	network: true,
	policy: policy.authenticated(),
	query: tickets.list({
		parameters: {
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row: ticket, values }) =>
			ticket.watchers.some(({ row: watcher }) =>
				watcher.membershipId.equal(values.membershipId),
			),
		orderBy: { updatedAt: "desc", id: "desc" },
		select: {
			id: true,
			reference: true,
			status: true,
			summary: true,
			updatedAt: true,
			team: { select: { id: true, name: true } },
			comments: {
				list: {
					where: ({ row: comment }) => comment.kind.equal("public"),
					orderBy: { createdAt: "desc", id: "desc" },
					first: 3,
				},
			},
		},
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
```

The compiler records every reached fact — including the exact
`values.membershipId` dependency — in the plan and cursor scope. A cursor
created for one fact scope cannot be replayed under another. Reusable scoped
predicates remain ordinary typed TypeScript functions. Use a handler Query
only when the behavior cannot be represented as one closed plan, and use an
explicit `output` pin only when its transformation cannot be inferred from
typed kernel reads:

```ts
export const queueOverview = defineQuery({
	name: "tickets.queueOverview",
	network: true,
	policy: policy.authenticated(),
	handler: async ({ ctx }) => {
		const open = await ctx.data.tickets.list({
			/* plan */
		});
		const teams = await ctx.data.teams.list({
			/* plan */
		});
		return { open: open.nodes.length, teams: teams.nodes };
	},
	output: codec.object({
		/* pinned when inference is not supported */
	}),
});
```

### Live Queries

A Query the compiler can prove watchable gains `.watch` on the generated
client automatically. You do not declare anything.

## 3. Protect data with Policy

One Policy per Collection decides admission, row scope, Field authority,
and candidate rows. Every path obeys it: network, direct, workers, live
recomputation.

```ts
// src/tickets/policy.ts
import { definePolicy, expr, policy } from "questpie";
import type { PolicyScope, RowOperand } from "questpie";

import { memberships } from "../memberships";
import { tickets } from "../tickets";

export const activeStaff = ({ principal, tenant }: PolicyScope) =>
	expr.exists(memberships, ({ row: member }) =>
		expr.and(
			member.organizationId.equal(tenant.id),
			member.principalId.equal(principal.id),
			member.status.equal("active"),
			member.role.in(["agent", "admin"]),
		),
	);

export const ticketPolicy = definePolicy(tickets, {
	name: "tickets.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row: ticket, principal, tenant }) =>
			expr.and(
				ticket.organizationId.equal(tenant.id),
				expr.or(
					activeStaff({ principal, tenant }),
					expr.exists(memberships, ({ row: member }) =>
						expr.and(
							member.id.equal(ticket.requesterMembershipId),
							member.principalId.equal(principal.id),
							member.status.equal("active"),
						),
					),
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, tenant }) =>
			expr.and(
				candidate.organizationId.equal(tenant.id),
				candidate.status.equal("open"),
				candidate.closedAt.isNull(),
			),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current, tenant }) => current.organizationId.equal(tenant.id),
		candidate: ({ current, candidate, principal, tenant }) =>
			expr.and(
				candidate.organizationId.equal(tenant.id),
				/* your state machine over current and candidate */
				expr.always(),
			),
	},
	fields: {
		update: ({ principal, tenant }) => {
			const staff = activeStaff({ principal, tenant });
			return {
				summary: expr.always(),
				description: expr.always(),
				teamId: staff,
				assigneeMembershipId: staff,
				priority: staff,
			};
		},
	},
});
```

The rules that matter:

- **`expr.exists(collection, predicate)` belongs to Policy programs.** It is
  a boolean-only evidence read: it proves a fact without disclosing the
  evidence row, and it does not apply the target Collection's read Policy.
  In Query filters it is a type error; use relation quantifiers there,
  which do respect the target's read Policy.
- The `fields` maps cover only caller-writable Fields. Server-owned Fields
  are not part of the caller surface, so you never write denial rules for
  them.
- `candidate` programs run inside the owning transaction over the complete
  final row, whatever combination of caller patch, trusted `values`, and
  defaults produced it. Keep your structural invariants here (tenant
  equality, state machines, referenced rows exist); they are the backstop
  even against your own server code.
- Missing and Policy-hidden rows are indistinguishable everywhere.
- `policy.authenticated()` admits any signed-in Principal.
  `policy.admit(({ principal, tenant, values }) => boolean)` writes custom
  synchronous admission over immutable Execution facts; it cannot read the
  database or call Services. Relational conditions go in `rows` and
  `candidate`.
- Reusable predicates are ordinary functions over `PolicyScope` (and
  `RowOperand<typeof collection>` when they take a row operand).

## 4. Write data with Mutations

Every Collection has an internal, Policy-aware CRUD kernel available inside
Mutations: `get`, `list`, `create`, `update`, `delete`. Named Mutations
compose it; nothing bypasses it.

```ts
// src/ticket-mutations.ts
import { codec, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

import { tickets } from "./tickets";

const ticketUnavailable = operation.error({
	code: "TICKET_UNAVAILABLE",
	status: 404,
});
const transitionRejected = operation.error({
	code: "TICKET_TRANSITION_REJECTED",
	status: 409,
});

export const createTicket = defineMutation({
	name: "ticket.create",
	network: true,
	input: tickets.createInput().pick({
		teamId: true,
		reference: true,
		priority: true,
		summary: true,
		description: true,
	}),
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx }) =>
		ctx.data.tickets.create({
			input,
			values: {
				organizationId: ctx.tenant.id,
				requesterMembershipId: ctx.values.membershipId,
			},
			select: true,
		}),
});

export const closeTicket = defineMutation({
	name: "ticket.close",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: { ticketUnavailable, transitionRejected },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({
			key: { id: input.ticketId },
		});
		if (current === null) throw errors.ticketUnavailable();
		if (current.status !== "open") throw errors.transitionRejected();
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			expected: { status: "open" }, // compare-and-set
			values: { status: "closed", closedAt: ctx.now },
			select: true,
		});
		if (updated === null) throw errors.ticketUnavailable();
		return updated;
	},
});
```

The pieces:

- A Mutation owns exactly one PostgreSQL transaction. Everything inside
  commits or rolls back together, including Job acceptance.
- **`patch`** carries caller-derived changes and may contain only
  caller-writable Fields. **`values`** is the trusted server lane: it may
  set server-owned Fields, derived from caller input, the current row,
  transaction reads, `ctx.now`, `ctx.callId`, and ordinary deterministic
  TypeScript. Both lanes flow through normalization, validation, candidate
  Policy, and constraints; `values` skips only caller Field authority.
- `update` takes `{ key, expected?, patch?, values?, select? }`; `expected`
  is a compare-and-set against the current row; the kernel locks the row
  and re-runs Policy on current and candidate inside the transaction. An
  omitted `select` returns the complete scalar row.
- `key` accepts the primary key or the complete column set of any declared
  unique constraint, so a row with a natural identity (for example a join
  row with `constraint.unique({ fields: { ticketId: true, membershipId:
true } })`) is fetched or deleted by that identity directly; no
  surrogate-id pre-lookup is needed.
- A `create` or `update` that loses a race to a declared unique constraint
  throws a typed `ConstraintViolation` carrying the declared constraint
  name and no raw database detail. Catch it and rethrow your declared
  error; the example follows this list.
- To require that the caller can read a row in another Collection, read it
  through the kernel: `ctx.data.tickets.get({ key })` applies the ticket's
  read Policy, so a `null` means missing or not readable and your Mutation
  simply refuses. Do not restate another Collection's read Policy inside
  your own Policy program; `expr.exists` is deliberately nondisclosing
  evidence, not a readability check.
- `ctx.now` is the transaction-stable time; `ctx.callId` the stable call
  identity; `ctx.tenant` and `ctx.values` come from your application
  Context.
- `collection.createInput()` / `collection.updateInput()` derive caller
  input codecs from provenance; `.pick({...})` / `.omit({...})` select
  subsets. Compose extra members with
  `codec.object({ ticketId: codec.uuid(), ...tickets.updateInput().pick({...}) })`.
- Declared errors are `operation.error({ code, status })` values thrown via
  the typed `errors` bag.
- Output is inferred from typed kernel writes; pin `output` only for a
  stable public shape, recursion, or unsupported inference.
- Exact duplicate delivery of the same call (same `callId`, same input)
  returns the stored committed result instead of applying the change twice;
  the same call with changed input is rejected.

Constraint-race example:

```ts
try {
	return await ctx.data.watchers.create({ values, select: true });
} catch (error) {
	if (operation.isConstraintViolation(error, "oneWatchPerMember"))
		throw errors.alreadyWatching();
	throw error;
}
```

## 5. Durable work with Jobs

```ts
// src/ticket-sla-follow-up-job.ts
import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";

export const slaFollowUp = defineJob({
	name: "ticket.slaFollowUp",
	input: codec.object({
		ticketId: codec.uuid(),
	}),
	output: codec.object({
		ticketId: codec.uuid(),
		followedUpAt: codec.timestamp(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "10s",
		jitter: "full",
		horizon: "1h",
	}),
	handler: async ({ input, ctx }) => {
		// The delay already happened before this attempt ever started (see
		// `notBefore` below) — the handler just does the work.
		return { ticketId: input.ticketId, followedUpAt: ctx.attempt.now() };
	},
});
```

Accept it inside a Mutation transaction, delayed to the deadline:

```ts
const dueAt = new Date(ctx.now.getTime() + 1_500);
const job = await ctx.jobs.ticket.slaFollowUp.accept({
	input: { ticketId: ticket.id },
	notBefore: dueAt,
});
```

The rules:

- The acceptance envelope is one object:
  `{ input, idempotencyKey?, notBefore? }`. `notBefore` delays the run
  until an absolute time: the Runtime dispatches no attempt, starts no
  worker, and holds no lease before then. When a delay is the entire reason
  a Job exists — as here — `notBefore` is the whole mechanism; do not accept
  the Job immediately and `sleepUntil` the due time inside the handler,
  which would hold a live attempt for the whole wait for no reason.
- You may omit `idempotencyKey` only when the compiler can prove the
  callsite runs at most once per Mutation call. **Inside a loop, a batch,
  a shared helper, or any server-direct acceptance
  (`app.execution(...).jobs.<name>.accept(...)`), an explicit
  `idempotencyKey` is required** and its absence is a compile diagnostic.
  Replaying the same identity returns the same receipt; changing the input
  or `notBefore` under the same identity conflicts.
- Acceptance commits and rolls back with the Mutation. A worker later runs
  the handler with fresh Context and Policy under the stored `runAs`.
- `durable.caller({ whenDenied: "fail" })` is the only run-as recipe today:
  every attempt executes as the Principal whose call accepted the Job, and
  is refused if that Principal's authority lapses. A Job that concerns a
  different person (a notification recipient, another member) carries that
  person's id as ordinary input data and stays within what the accepting
  caller may do; there is no way to run as somebody else or as the system
  yet.
- You do not manage leases or heartbeats. The runtime heartbeats
  automatically until the attempt deadline; cancellation and lease loss
  reject the framework-owned waits. For long CPU-bound loops that starve
  the event loop, call `ctx.attempt.heartbeat()` periodically or check
  `ctx.signal`.
- `ctx.attempt.now()` is the runtime-owned clock (ambient `Date.now()` is
  rejected in structural code). `ctx.attempt.sleepUntil(date)` is an
  **advanced** control for a short pause inside an attempt that is already
  running for some other reason; it is not durable scheduling — it holds a
  live worker and lease for the wait, a target beyond the attempt budget is
  rejected with a pointer to `notBefore`, and after a crash the fresh
  attempt re-sleeps toward the same absolute instant rather than resuming
  a saved wait. If the delay is the reason the Job exists, accept it with
  `notBefore` instead (as above); reach for `sleepUntil` only for a bounded
  pause a handler needs mid-attempt.
- Retry follows the declared bounded program; cancellation is cooperative
  and durable. Browser code has no Job surface; expose user-visible status
  or cancellation as ordinary Policy-protected Queries and Mutations.

## 6. The browser: generated client and React

```ts
// browser/questpie.ts
import { createClient } from "#questpie/client";
export const desk = createClient({ baseUrl: location.origin }).withContext({
	organizationId,
	membershipId,
});
```

Calls take one object envelope; every Operation also carries named types:

```ts
import type { TicketsQueueInput, TicketsQueueResult } from "#questpie/client";

const page = await desk.queries.tickets.queue({
	input: { status: ["open"], first: 25, after: null },
});
await desk.mutations.ticket.close({ input: { ticketId } });
```

Each callable Operation is also the descriptor: `.key(input)` is its stable
cache identity, `.observe({ input })` returns a framework-neutral store
(`subscribe`/`get`/`refresh`/`dispose`), and `.watch({ input })` exists on
watchable Queries.

React hooks adapt that store:

```tsx
import { useLiveQuery, useMutation } from "questpie/react";

function TicketRow({ ticket, queueInput }) {
	const close = useMutation(desk.mutations.ticket.close);
	return (
		<li>
			{ticket.summary}
			<button
				disabled={close.status === "pending"}
				onClick={() =>
					close.call({
						input: { ticketId: ticket.id },
						optimistic: [
							{
								query: desk.queries.tickets.queue,
								input: queueInput,
								apply: (page) => ({
									...page,
									nodes: page.nodes.map((n) =>
										n.id === ticket.id ? { ...n, status: "closed" } : n,
									),
								}),
							},
						],
					})
				}
			>
				Close
			</button>
			{close.status === "uncertain" && (
				<button onClick={close.recover}>Check result</button>
			)}
		</li>
	);
}

function Queue() {
	const input = { status: ["open"], first: 25, after: null };
	const queue = useLiveQuery(desk.queries.tickets.queue, { input });
	if (queue.status === "loading") return <Spinner />;
	if (queue.status === "declined") return <Denied error={queue.error} />;
	if (queue.status === "failed") return <Retry onRetry={queue.retry} />;
	return (
		<ul>
			{queue.data.nodes.map((t) => (
				<TicketRow key={t.id} ticket={t} queueInput={input} />
			))}
		</ul>
	);
}
```

- Query state: `loading | ready(data, stale, refreshing) | declined(error)
| failed(failure, retry)`.
- Mutation state: `idle | pending | success(data) | declined(error) |
failed(failure) | uncertain(callId, recover)`. `uncertain` means the
  server may have committed but the response was lost; `recover()` replays
  the same call identity to fetch the committed result. Nothing ever
  pretends a possibly committed write rolled back.
- Optimistic updates are opt-in per call: target a generated Query plus its
  exact input with a plain updater. The overlay is removed on pre-commit or
  declared failure, reconciled on success, and kept-but-flagged on
  `uncertain`. A component acting per row creates its `useMutation` per
  row.
- Invalidation is automatic from committed changes; you never write cache
  keys.

## 7. Real HTTP and MCP

The generated client speaks the framework RPC endpoint. When an Operation
must also be a real HTTP endpoint or an MCP tool, opt in on the Operation:

```ts
export const ticketDetail = defineQuery({
  name: "tickets.detail",
  network: true,
  http: {
    method: "GET",
    path: "/api/tickets/:ticketId",
    request: { path: { ticketId: "id" },
      query: { commentsFirst: "commentsFirst",
        commentsAfter: "commentsAfter" } },
    responses: { ok: 200, missing: 404 },
  },
  mcp: {
    tool: "support_ticket_detail",
    description: "Read one support ticket with its recent public comments.",
    readOnly: true,
  },
  policy: policy.authenticated(),
  query: /* ... */,
});
```

- The `request` pickers map input members to path, query, header, or body
  locations. GET is allowed only when the whole input encodes into
  path/query within the bound; otherwise use POST.
- Every Mutation's HTTP projection automatically reads the
  `Idempotency-Key` request header as the Mutation's call identity; you do
  not declare it. HTTP retries carrying the same key recover the committed
  result instead of double-writing.
- If a Mutation commits but the response is lost, HTTP reports it as
  `500` with the accepted ADR-0023 body (`code`, `retryable: true`,
  `transactionId`, plus `callId`) — never a generic sanitized `500` and never
  a different status. Replay the same request with the same
  `Idempotency-Key` to recover the receipt.
- MCP tools run through the same Policy and limits as every other call;
  `readOnly` is a hint for clients, never authorization.
- OpenAPI is generated from HTTP-projected Operations and from Routes that
  declare enough schema. Webhooks, auth handlers, streaming, and files stay
  raw Routes.

## 8. Services and configuration

```ts
import { codec, config, defineService } from "questpie";

export const mailer = defineService({
	name: "support.mailer",
	lifetime: "application", // or "execution"
	effect: "external", // external-effect Services never enter
	// Query/Mutation transactions
	config: {
		apiUrl: codec.text(),
		apiKey: config.secret(codec.text()),
	},
	create: async ({ config, signal }) => makeMailer(config),
	dispose: (mailer) => mailer.close(),
});
```

- Declare configuration once on the Service with ordinary codecs;
  `config.secret(...)` marks values that must never appear in logs,
  artifacts, or diagnostics. Values are supplied at the runtime edge:
  `createApp({ config })`, the generated environment mapping of
  `questpie start`, or the generated `loadAppConfig()` for CLI scripts.
  Missing or invalid values fail startup with exact paths.
- `eager: true` creates a Service during startup and fails readiness on
  error; Services your credential resolver depends on must be eager.
- Actions receive external-effect Services and own one external call with
  an explicit ambiguous-outcome contract; Routes handle raw HTTP and enter
  application behavior through an explicit execution transition.
