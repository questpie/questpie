# QUESTPIE v4 Deep-DX approval packet #1, version 2

- Status: research proposal awaiting human approval; not product authority
- Date: 2026-08-27
- Supersedes: the packet #1 scope in
  [FABLE-SYNTHESIS.md](./FABLE-SYNTHESIS.md) and the stale field-evolution
  statement in [DECISION-MAP.md](./DECISION-MAP.md) ticket #3
- Evidence: the three benchmark reports beside this packet,
  [Team Support Desk DX evidence](../../implementation/team-support-desk/DX-EVIDENCE.md),
  the framework-api-atlas redesign candidates, the Accepted ADRs cited in
  section 20, and the four adversarial review lanes recorded in section 23
- Rule: Accepted ADRs and public documentation stay in force until each ledger
  entry in section 20 is individually approved and carried through a focused
  superseding decision. Nothing in this packet is implementable on its own.

## 1. Executive recommendation

Adopt one deep-kernel-with-projections design across the whole authoring
surface, and pay for every new public spelling with deleted application
ceremony:

1. **Collections become the read root.** `tickets.list(...)` and
   `tickets.get(...)` construct structural read plans directly from the
   Collection value. Selection, filters, ordering, pagination, Relations,
   quantifiers, and parameters are one local object language with full
   TypeScript inference. `dataQuery<AppData[...]>()({...})` ceremony,
   duplicate Operation codecs, and output repair functions disappear.
2. **One expression vocabulary, capability-scoped.** Query filters and Policy
   programs share the `expr` combinators (`and`, `or`, `not`, `always`,
   `never`) and Field operand methods. `expr.exists(collection, predicate)`
   is the Policy-program evidence primitive and is a type error in Query
   filter position; Query parent membership uses relation quantifiers
   (`some`/`none`/`every`) over the disclosure-authorized universe. This
   keeps ADR-0010's evidence/disclosure asymmetry visible in the type system
   instead of hiding it behind one overloaded call. The words `policy.rows`,
   `policy.exists`, `policy.evidence`, and the `query.*` grab bag leave the
   authoring surface.
3. **Collections own the write kernel.** Every Collection always has a
   Policy-aware internal CRUD kernel (`get`, `list`, `create`, `update`,
   `delete`). Field provenance defines the possible caller surface; a trusted
   `values` lane carries server-derived assignments through the same
   candidate Policy; a fixed `normalize` / `validate` / `check` /
   `afterWrite` lifecycle replaces both the v3 hook catalogue and today's
   awkward `query.never()` Field fences. Candidate Policy keeps every
   invariant the current fixture enforces: provenance narrows who may submit
   a Field, and candidate Policy still verifies what any lane submitted.
   `updatedAt` becomes a database-owned `onUpdate: "now"` invariant.
   `ctx.operationTime` is renamed `ctx.now`.
4. **Job stays the one durable primitive, without lease ceremony.** Acceptance
   takes one object envelope with the full name `idempotencyKey`; the Runtime
   heartbeats automatically up to the attempt deadline; statically provable
   Mutation-owned callsites get a compiler-derived default identity;
   `ctx.attempt.now()` exposes the Runtime-owned attempt clock. Reaction
   removal remains a later compatibility slice.
5. **One generated client with a framework-neutral observer core.** Nested
   kind/domain maps (`client.queries.tickets.queue({ input })`), one object
   envelope per call, generated named types, compiler-derived cache identity,
   invalidation facts, and a thin `questpie/react` adapter with explicit
   `useQuery`/`useLiveQuery`, honest post-commit ambiguity, and opt-in
   per-mutation optimistic overlays.
6. **Typed Service config and lifecycle.** Services declare their config
   schema once; the compiler composes one generated App Config; values and
   secrets enter only at the runtime edge, reach CLI entrypoints through one
   generated loader, and never enter manifests or digests. Services a
   credential resolver depends on are compiler-required eager; a lazy
   creation failure is retried, never a permanently poisoned Promise. Better
   Auth stays application composition with its own bounded pool and an
   explicit external-schema declaration until a deeper shared capability and
   Package-level migration projection are proved.
7. **Honest transport story.** `POST /_questpie/operation` remains the
   first-party RPC transport. Real HTTP is an explicit per-Operation
   projection with object pickers, a mandatory `Idempotency-Key` mapping for
   Mutations, and reserved surfacing of the accepted post-commit outcome;
   OpenAPI covers only what is explicitly projected or sufficiently
   declared; MCP is a separate explicit projection through the same executor
   and Policy. Three compiler-owned collision domains reject every collision
   with both Origins.
8. **Capability Packages, not plugins.** The first extension proofs are one
   staged pg_search-backed Search vertical and one PostGIS vertical, both
   parameterizing fixed core-implemented expression and index node kinds.
   Only after both may a narrow shared extension seam be considered. There is
   no compiler plugin API, `customType` registry, or install-time activation.
9. **Route wildcard subtrees use exclusive per-pattern ownership** (Q63
   recommendation, isolated for human approval in section 14).

Everything above preserves the Accepted invariants: PostgreSQL durable truth,
Policy as the only authorization model, nondisclosure, one Mutation
transaction, Mutation Call Identity, Change Ledger, the durable kernel, Effect
Identity and ambiguity, deterministic compilation, and the B-tree-only public
Index contract.

## 2. Beginner mental model

Seven concepts explain a QUESTPIE application. Everything else is compiler and
Runtime machinery a beginner does not have to name.

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

The mental model a beginner learns in order:

1. Declare Collections. You immediately get typed, Policy-aware reads and
   writes inside Queries and Mutations; nothing is public yet.
2. Publish named Queries and Mutations. Only these enter the generated
   client. Along the way you may extract reusable selections and predicates
   as ordinary TypeScript values; that is a convenience, never a
   prerequisite.
3. Write Policy once per Collection. Every path, including workers, live
   recomputation, direct calls, and Studio, obeys it.
4. Accept Jobs from Mutations when work must survive the response.
5. Mount Routes and Services when a real protocol or provider is involved.

Two sentences carry the safety story: _the compiler proves the shape of
everything before the process starts_, and _Policy runs inside the same
database snapshot or transaction as the data it protects_.

## 3. Canonical imports and ownership map

```ts
// stable structural surface: schema, codecs, expressions, policy helpers
import {
	defineCollection,
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

// application-specialized executable factories (generated contract)
import {
	defineQuery,
	defineMutation,
	defineAction,
	defineRoute,
	defineJob,
	defineReaction /* retained until the deletion slice */,
} from "#questpie/app";

// generated browser-safe client and named types
import { createClient } from "#questpie/client";
import type { TicketsQueueInput, TicketsQueueResult } from "#questpie/client";

// thin React adapter over the vanilla client observer core
import { useQuery, useLiveQuery, useMutation } from "questpie/react";

// capability Packages: explicitly activated structural Definitions
import { searchIndex } from "@questpie/pg-search";
```

The lists above are the load-bearing names, not an exhaustive export
inventory; `shape`, `value`, `seed`, `context`, `principal`, `operation`, and
the other retained ADR-0019 names stay available unchanged.

Ownership rules this map freezes (exact npm names stay open):

- `questpie` owns structural grammar only; it can never execute application
  behavior.
- `#questpie/app` owns executable factories and the generated server surface;
  it never appears in browser bundles.
- `#questpie/client` owns the exact browser-safe contract; it exposes no
  server factory, no Route, and no generic Job control.
- `questpie/react` owns zero identity, zero cache truth, and zero transport;
  it adapts the neutral observer core to React's external-store hooks.
- A Package exports structural Definitions and Augmentations under explicit
  activation in `questpie.json`; installation alone activates nothing.

Capability-negative imports are part of the contract: importing `#questpie/app`
from browser code, or `#questpie/client` from structural code, is a compile
diagnostic, not a convention.

## 4. Complete Support Desk vertical

This section is the packet's specimen and was adversarially reviewed by four
independent lanes (section 23). It reuses the existing
`fixtures/team-support-desk` domain: Organization, Membership, Team, Ticket,
Comment, Label. Where a semantic claim still requires its slice proof, the
text says so.

### 4.1 Collection with provenance

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
import { organizations } from "./organizations";
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
		priority: field.text({ minLength: 1, maxLength: 16, default: "normal" }),
		status: field.text({
			minLength: 1,
			maxLength: 16,
			default: "open",
			server: true,
		}),
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
		lastSlaFollowUpAt: field.timestamp({
			nullable: true,
			withTimezone: true,
			server: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		tenantReference: constraint.unique({
			fields: ["organizationId", "reference"],
		}),
	},
	relations: {
		organization: relation.toOne({
			target: organizations,
			fields: ["organizationId"],
			references: ["id"],
		}),
		team: relation.toOne({
			target: teams,
			fields: ["teamId"],
			references: ["id"],
		}),
		requester: relation.toOne({
			target: memberships,
			fields: ["requesterMembershipId"],
			references: ["id"],
		}),
		assignee: relation.toOne({
			target: memberships,
			fields: ["assigneeMembershipId"],
			references: ["id"],
			onDelete: "setNull",
		}),
		// Inverse relations use the accepted relationRef spelling so the child
		// modules (which already import `tickets`) are never value-imported
		// back; no module cycle exists.
		comments: relation.toMany({ inverseOf: relationRef("comments", "ticket") }),
		labels: relation.toMany({ inverseOf: relationRef("labels", "ticket") }),
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
	indexes: {/* unchanged from the current fixture */},
});
```

Two authored-surface conveniences ride along, both ledger entries (S14):
`nullable` becomes optional with default `false`, and `relation.toMany`
inverse authoring (already implemented and retained by ADR-0019) becomes
loadable by structural reads (S12/additive list).

- **The author writes:** provenance as small Field modifiers. Nothing else
  changes at the Collection.
- **TypeScript infers:** `tickets.createInput()` = `{ teamId, reference,
summary, description, priority?, assigneeMembershipId? }`;
  `tickets.updateInput()` = `{ teamId?, priority?, summary?, description?,
assigneeMembershipId? }`. `id`, `organizationId`, `requesterMembershipId`,
  `status`, `createdAt`, `closedAt`, `lastSlaFollowUpAt`, `updatedAt` never
  appear in caller input.
- **The compiler generates:** the same Schema Projection, migration, and
  fingerprint bytes as today plus one `onUpdate: "now"` column behavior with
  its own migration identity; a provenance table in the Data Contract
  Projection; caller-input codecs; the internal CRUD kernel plans.
- **Runtime owns:** the lock/recheck write path, `onUpdate` value
  materialization and its returned final value, and Change Ledger capture for
  every kernel write, including explicitly supported managed writers.
- **Policy protects:** everything it protects today, over the possible caller
  surface plus the complete candidate regardless of lane (section 4.6).
- **Deleted handwritten code:** the `query.not(query.always())` Field fences
  and immutability equalities in `src/tickets/policy.ts` and siblings; the
  Mutation-owned `updatedAt` bookkeeping; the caller-authority grant for
  `closedAt`.
- **Invalid examples:**
  - `field.timestamp({ onUpdate: "now", server: true })` claiming two owners
    for one Field: `QP-COMPOSE-013 structuralTypeError` (“fields.updatedAt
    cannot be both database-owned and values-lane-owned”).
  - a caller patch containing `status`: rejected by the provenance-derived
    exact input codec's accepted unknown-key rule
    (`docs/v4/query-mutation-and-lifecycle.md`), before any database work.

### 4.2 Reusable selection and predicate values

```ts
// src/tickets/read-shapes.ts
import { expr } from "questpie";
import type { PolicyScope, RowOperand } from "questpie";

import { memberships } from "../memberships";
import { tickets } from "../tickets";

// A reusable object selection is an ordinary typed TypeScript value. The
// returned value's own enumerable keys are exactly the selection entries,
// so object spread composes selections; each use site revalidates the
// composed entries and derives its own dependency facts and Origin.
export const ticketSummary = tickets.select({
	id: true,
	reference: true,
	priority: true,
	status: true,
	summary: true,
	updatedAt: true,
	team: { select: { id: true, name: true, routingStatus: true } },
	assignee: { select: { id: true, principalId: true, role: true } },
});

// Reusable predicates are ordinary functions. `PolicyScope` carries the
// framework Execution facts (principal, tenant); `RowOperand<typeof c>` is
// the one operand type shared by `row`, `current`, and `candidate` scope
// members of that Collection. These predicates use `expr.exists`, so they
// are Policy-program predicates; section 7 explains why `expr.exists` is
// not Query-filter surface.
export const activeStaff = ({ principal, tenant }: PolicyScope) =>
	expr.exists(memberships, ({ row: member }) =>
		expr.and(
			member.organizationId.equal(tenant.id),
			member.principalId.equal(principal.id),
			member.status.equal("active"),
			member.role.in(["agent", "admin"]),
		),
	);

export const activeRequesterOf = (
	ticket: RowOperand<typeof tickets>,
	{ principal }: PolicyScope,
) =>
	expr.exists(memberships, ({ row: member }) =>
		expr.and(
			member.id.equal(ticket.requesterMembershipId),
			member.principalId.equal(principal.id),
			member.status.equal("active"),
			member.role.equal("customer"),
		),
	);
```

Predicates built only from Field operand methods and
`expr.and/or/not/always/never` are reusable in both Query filters and Policy
programs. Predicates containing `expr.exists` are Policy-side values; using
one in a Query filter fails with `QP-DATA-025` (section 7).

### 4.3 One paged, filtered, relation-loading Query

This one Query replaces today's four parallel `tickets.list*` plan/Query
pairs and the browser dispatch switch.

```ts
// src/tickets/queries.ts
import { codec, expr, policy } from "questpie";

import { defineQuery } from "#questpie/app";

import { tickets } from "../tickets";
import { ticketSummary } from "./read-shapes";

export const ticketQueue = defineQuery({
	name: "tickets.queue",
	network: true,
	policy: policy.authenticated(),
	query: tickets.list({
		parameters: {
			status: codec.nullable(codec.list(codec.text(), { maximum: 8 })),
			teamId: codec.nullable(codec.list(codec.uuid(), { maximum: 16 })),
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row: ticket, parameters }) =>
			expr.and(
				ticket.status.in(parameters.status), // null = filter absent, [] = none
				ticket.teamId.in(parameters.teamId),
			),
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

- **The author writes:** one plan-backed Query. No handler, no output codec,
  no timestamp repair, no per-variant browser dispatch.
- **TypeScript infers:** `TicketsQueueInput` =
  `{ status: string[] | null; teamId: string[] | null; first: number;
after: string | null }` and `TicketsQueueResult` =
  `{ nodes: Array<{ id: string; ... updatedAt: Date;
team: { id; name; routingStatus } | null;
assignee: {...} | null; labels: Array<{...}>; commentCount: number }>;
pageInfo: { endCursor: string | null; hasNextPage: boolean } }`.
- **The compiler generates:** one lowered PostgreSQL plan; the exact input
  and output runtime codecs (so `updatedAt` arrives as a real `Date` on both
  direct and network paths, deleting the `timestamp()` repair function); the
  cursor scope covering template, parameters, and reached Policy facts; the
  observed-dependency plan for Live Query; the wire and client members.
- **Runtime owns:** one bounded consistent read snapshot per Query root, the
  bounded top-N loading of `labels` under a plural parent (its omitted
  `select` defaults to the complete scalar row), and the authorized
  `commentCount` aggregate.
- **Policy protects:** ticket row scope intersects before the caller filters,
  ordering, cursor boundaries, and `first + 1`; the nested `labels` rows and
  the `comments` aggregate each run under their own Collection's disclosure
  Policy.
- **Deleted handwritten code:** four of the six plans in
  `src/tickets/query-plans.ts` plus three of the four list Queries in
  `src/tickets/queries.ts` and the browser dispatch branch (95-125 lines;
  `ticketDetailPlan` is separately superseded by 4.4, and
  `ticketSearchByReferencePlan` remains until the Search slice), plus the
  four output codecs and repair functions.
- **Invalid examples:**
  - `ticket.status.in(parameters.status)` under `expr.not(...)` or as a bare
    `expr.or` branch: proposed `QP-DATA-020 nullableFilterPosition`
    (section 6 states the formal rule).
  - `labels: { list: { page: { after: parameters.after } } }` under the
    plural parent: proposed `QP-DATA-021 nestedCursorUnderPluralParent`.
  - `commentCount: ({ row: ticket }) => ticket.comments.count() + 1`: a
    computed selection member must be exactly one call to a
    compiler-recognized relation aggregate; proposed `QP-DATA-025
unsupportedExpressionCapability`.

### 4.4 Singular-parent detail with nested child paging and three hops

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
			...tickets.select(true), // complete scalar row projection
			team: {
				select: {
					id: true,
					name: true,
					organization: { select: { id: true, name: true } },
				},
			},
			requester: { select: { id: true, principalId: true, role: true } },
			comments: {
				list: {
					where: ({ row: comment }) => comment.kind.equal("public"),
					orderBy: { createdAt: "desc", id: "desc" },
					page: ({ parameters }) => ({
						first: parameters.commentsFirst,
						after: parameters.commentsAfter,
					}),
					select: {
						id: true,
						body: true,
						createdAt: true,
						author: {
							select: {
								id: true,
								role: true,
								organization: { select: { name: true } },
							},
						},
					},
				},
			},
		},
	}),
});
```

Semantics this example pins:

- `tickets.get` returns `Result | null`; a missing row and a Policy-invisible
  row are the same `null`.
- `tickets.select(true)` is the documented boolean overload of the selection
  builder: the complete scalar row projection, which intentionally evolves
  with the Collection (section 5).
- The `comments.list.where` filters the nested payload only; the parent
  ticket still returns when every comment is filtered out.
- A singular parent may own one cursor-paged nested to-many page; its nested
  cursor binds into the same DataCursor scope as the root parameters.
- The chain comment → author (membership) → organization plus ticket → team →
  organization exercises three relation hops against the proposed depth
  budget of four (`QP-DATA-022` fires on the fifth); each hop's rows pass
  the target Collection's disclosure Policy.

### 4.5 Parent membership through quantifiers

```ts
export const ticketEscalations = defineQuery({
	name: "tickets.escalations",
	network: true,
	policy: policy.authenticated(),
	query: tickets.list({
		parameters: {
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row: ticket }) =>
			expr.and(
				ticket.status.equal("open"),
				ticket.comments.some(({ row: comment }) =>
					comment.kind.equal("escalation"),
				),
				ticket.labels.none(({ row: label }) => label.name.equal("ignored")),
			),
		orderBy: { updatedAt: "desc", id: "desc" },
		select: ticketSummary,
		page: ({ parameters }) => ({
			first: parameters.first,
			after: parameters.after,
		}),
	}),
});
```

Quantifier semantics: `some` over an empty relation is false; `none` is true;
`every` is vacuously true. All three quantify over the target Collection's
disclosure-authorized universe for the current Execution: hidden rows behave
exactly as absent rows, in membership and in `count()`, so the two are
indistinguishable through any observable of this Query, matching the accepted
missing/invisible equivalence. Nested `where` inside a selection never
changes parent membership; only `some`, `none`, and `every` do. Making the
authorized-universe rule hold under `.watch` requires the slice-1 dependency
proof in section 22; until that proof lands, this paragraph is design intent,
not an accepted guarantee.

### 4.6 Policy with the shared expression vocabulary

Provenance shrinks the Field authority map and deletes the immutability
equalities, but every structural invariant of the current fixture Policy is
kept: provenance narrows who may submit a Field, while candidate Policy still
verifies what any lane, including a buggy trusted `values` assignment,
actually submitted.

```ts
// src/tickets/policy.ts
import { definePolicy, expr, policy } from "questpie";
import type { PolicyScope, RowOperand } from "questpie";

import { memberships } from "../memberships";
import { teams } from "../teams";
import { tickets } from "../tickets";
import { activeRequesterOf, activeStaff } from "./read-shapes";

type Ticket = RowOperand<typeof tickets>;

const inTenantTeam = (ticket: Ticket, { tenant }: PolicyScope) =>
	expr.exists(teams, ({ row: team }) =>
		expr.and(
			team.id.equal(ticket.teamId),
			team.organizationId.equal(tenant.id),
		),
	);

const validAssignee = (ticket: Ticket, { tenant }: PolicyScope) =>
	expr.or(
		ticket.assigneeMembershipId.isNull(),
		expr.exists(memberships, ({ row: assignee }) =>
			expr.and(
				assignee.id.equal(ticket.assigneeMembershipId),
				assignee.organizationId.equal(tenant.id),
				assignee.status.equal("active"),
				assignee.role.in(["agent", "admin"]),
			),
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
					activeRequesterOf(ticket, { principal, tenant }),
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: (scope) => {
			const { candidate, principal, tenant } = scope;
			return expr.and(
				candidate.organizationId.equal(tenant.id),
				candidate.status.equal("open"),
				candidate.closedAt.isNull(),
				candidate.lastSlaFollowUpAt.isNull(),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				inTenantTeam(candidate, scope),
				validAssignee(candidate, scope),
				// The requester must be a currently active membership of this
				// principal, rechecked in the owning transaction even though the
				// values lane sourced it from Context.
				expr.exists(memberships, ({ row: requester }) =>
					expr.and(
						requester.id.equal(candidate.requesterMembershipId),
						requester.organizationId.equal(tenant.id),
						requester.principalId.equal(principal.id),
						requester.status.equal("active"),
					),
				),
			);
		},
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			expr.and(
				current.organizationId.equal(tenant.id),
				expr.or(
					activeStaff({ principal, tenant }),
					activeRequesterOf(current, { principal, tenant }),
				),
			),
		candidate: (scope) => {
			const { current, candidate, principal, tenant } = scope;
			const staff = activeStaff({ principal, tenant });
			return expr.and(
				candidate.organizationId.equal(tenant.id),
				candidate.priority.in(["low", "normal", "high", "urgent"]),
				inTenantTeam(candidate, scope),
				validAssignee(candidate, scope),
				// The closed/open state machine over any lane's candidate:
				expr.or(
					// stay open
					expr.and(
						current.status.equal("open"),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
					),
					// first close: staff only, closedAt supplied
					expr.and(
						current.status.equal("open"),
						candidate.status.equal("closed"),
						expr.not(candidate.closedAt.isNull()),
						staff,
					),
					// closed-state edit: the original close timestamp is pinned
					expr.and(
						current.status.equal("closed"),
						candidate.status.equal("closed"),
						candidate.closedAt.equal(current.closedAt),
					),
					// reopen: staff only
					expr.and(
						current.status.equal("closed"),
						candidate.status.equal("open"),
						candidate.closedAt.isNull(),
						staff,
					),
				),
				// A non-staff actor may change only summary/description; every
				// routing and lifecycle member must be unchanged.
				expr.or(
					staff,
					expr.and(
						activeRequesterOf(current, { principal, tenant }),
						current.status.equal("open"),
						candidate.teamId.equal(current.teamId),
						candidate.priority.equal(current.priority),
						candidate.status.equal(current.status),
						candidate.closedAt.isNull(),
						expr.or(
							expr.and(
								candidate.assigneeMembershipId.isNull(),
								current.assigneeMembershipId.isNull(),
							),
							candidate.assigneeMembershipId.equal(
								current.assigneeMembershipId,
							),
						),
					),
				),
			);
		},
	},
	fields: {
		update: ({ current, principal, tenant }) => {
			const staff = activeStaff({ principal, tenant });
			const requester = activeRequesterOf(current, { principal, tenant });
			return {
				summary: expr.or(staff, requester),
				description: expr.or(staff, requester),
				teamId: staff,
				assigneeMembershipId: staff,
				priority: staff,
			};
		},
	},
});
```

What changed against the current 243-line Policy file, and only this:

- provenance removed `status`, `closedAt`, `lastSlaFollowUpAt`, `updatedAt`,
  and the immutable Fields from the caller surface, so the Field authority
  map shrinks to the five caller-writable Fields and the
  `query.not(query.always())` fences disappear;
- the immutability equalities (`candidate.id.equal(current.id)`,
  `requesterMembershipId`, `createdAt`) disappear because the kernel
  enforces `immutable: true` before Policy;
- the repeated staff/requester/team/assignee predicates become four ordinary
  typed functions.

Every tenant-equality, state-machine, requester-liveness, team-existence,
assignee-validity, and closed-timestamp-pin invariant of the fixture
survives, because candidate Policy is the backstop for the trusted `values`
lane, not only for callers. The nondisclosure contract is unchanged:
`expr.exists` inside a Policy program is a boolean-only Policy Evidence Read;
it cannot return the evidence row and does not recursively apply the target
Collection's disclosure Policy.

### 4.7 Named Mutations over the Collection kernel with the `values` lane

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

export const assignTicket = defineMutation({
	name: "ticket.assign",
	network: true,
	input: codec.object({
		ticketId: codec.uuid(),
		...tickets.updateInput().pick({ assigneeMembershipId: true }),
	}),
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx, errors }) => {
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			patch: { assigneeMembershipId: input.assigneeMembershipId },
			select: true,
		});
		if (updated === null) throw errors.ticketUnavailable();
		return updated;
	},
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
			expected: { status: "open" },
			values: { status: "closed", closedAt: ctx.now },
			select: true,
		});
		if (updated === null) throw errors.ticketUnavailable();
		return updated;
	},
});

export const reopenTicket = defineMutation({
	name: "ticket.reopen",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: { ticketUnavailable, transitionRejected },
	handler: async ({ input, ctx, errors }) => {
		const current = await ctx.data.tickets.get({
			key: { id: input.ticketId },
		});
		if (current === null) throw errors.ticketUnavailable();
		if (current.status !== "closed") throw errors.transitionRejected();
		const updated = await ctx.data.tickets.update({
			key: { id: input.ticketId },
			expected: { status: "closed" },
			values: { status: "open", closedAt: null },
			select: true,
		});
		if (updated === null) throw errors.ticketUnavailable();
		return updated;
	},
});
```

- **The author writes:** trusted assignments in `values`, caller data in
  `input`/`patch`, and no `output` codec. `ticket.edit` (not shown) is the
  same shape as `assignTicket` over more picked members.
- **TypeScript infers:** the Mutation output from the typed Collection write
  (`select: true` here), because the compiler can materialize its runtime
  codec. A kernel `get`/`update` with omitted `select` defaults to the
  complete scalar row. A nullable Field no lane supplies and with no
  `default` is SQL `NULL`. Explicit `output` remains for deliberate pins,
  unsupported inference, and recursive shapes.
- **Runtime owns:** the keyed row lock, the `expected` compare-and-set, fresh
  current-row and candidate Policy inside the transaction, `onUpdate` value
  materialization, and the result receipt.
- **Policy protects:** the final candidate regardless of lane. `values` may
  write server-owned Fields, but it cannot bypass normalization, validation,
  candidate Policy, or constraints; the state machine in 4.6 still decides,
  which is exactly how a buggy `values` assignment is caught.
- **Deleted handwritten code:** the `ticketResult` copier and its 40-line
  codec; the `closedAt` caller-authority grant; the Policy-side denial rules
  for Fields no caller can send.
- **Invalid examples:**
  - `patch: { closedAt: ctx.now }`: `closedAt` is `server: true`, so it is
    not part of `updateInput()`; the patch fails typechecking and the exact
    runtime codec rejects the unknown key.
  - `values: { updatedAt: someDate }`: database-owned `onUpdate` Fields
    accept no lane at all; proposed `QP-DATA-023 databaseOwnedField`.

### 4.8 Transaction-owned Job acceptance

```ts
export const addTicketComment = defineMutation({
	name: "ticket.addComment",
	network: true,
	input: codec.object({ ticketId: codec.uuid(), body: codec.text() }),
	policy: policy.authenticated(),
	errors: { ticketUnavailable },
	handler: async ({ input, ctx, errors }) => {
		const ticket = await ctx.data.tickets.get({
			key: { id: input.ticketId },
		});
		if (ticket === null) throw errors.ticketUnavailable();
		const comment = await ctx.data.comments.create({
			input: { ticketId: ticket.id, body: input.body, kind: "public" },
			values: { authorMembershipId: ctx.values.membershipId },
			select: true,
		});
		const job = await ctx.jobs.ticket.slaFollowUp.accept({
			input: {
				organizationId: ticket.organizationId,
				ticketId: ticket.id,
				reference: ticket.reference,
				summary: ticket.summary,
				dueAt: new Date(ctx.now.getTime() + 1_500),
			},
			// No idempotencyKey: the compiler proves this callsite executes at
			// most once per Mutation call (it is not inside a loop or a repeated
			// helper), so the identity derives from the Mutation Call Identity,
			// the Job Resource identity, and this acceptance slot. Branches and
			// early throws keep the at-most-once property.
		});
		return { comment, job };
	},
});
```

The acceptance envelope is one object: `{ input, idempotencyKey?, notBefore? }`.
Explicit `idempotencyKey` is required, and diagnosed when missing, wherever
the compiler cannot prove the callsite runs at most once per Mutation call
(loops, batch helpers, calls reached from more than one place), for
server-direct acceptance, and for deliberate cross-call deduplication.
Replaying the identical identity returns the same receipt; changed canonical
input, `notBefore`, or run-as conflicts. Rollback of the Mutation removes the
acceptance.

### 4.9 Ordinary Job without lease ceremony

```ts
// src/ticket-sla-follow-up-job.ts
import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";

export const slaFollowUp = defineJob({
	name: "ticket.slaFollowUp",
	input: codec.object({
		organizationId: codec.uuid(),
		ticketId: codec.uuid(),
		reference: codec.text(),
		summary: codec.text(),
		dueAt: codec.timestamp(),
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
		await ctx.attempt.sleepUntil(input.dueAt); // signal-aware, clock-owned
		return { ticketId: input.ticketId, followedUpAt: ctx.attempt.now() };
	},
});
```

Compared with the current fixture handler, the manual
`await ctx.attempt.heartbeat()` opener, the `performance.timeOrigin`
wall-clock reconstruction, and the `ctx.signal.throwIfAborted()` closer are
gone. The exact liveness contract is in section 10: automatic heartbeat runs
on a Runtime timer and stops at the attempt deadline, so neither a CPU-bound
loop nor an I/O-bound hang can hold a lease forever; `sleepUntil` must fit
inside the remaining attempt budget, and a crash mid-sleep re-sleeps a fresh
attempt toward the same absolute instant. `ctx.attempt.heartbeat()` and
`ctx.signal` remain documented escape hatches for long CPU-bound work.

### 4.10 Better Auth composition with typed config

```ts
// src/auth/service.ts
import { codec, config, defineService } from "questpie";

export const supportAuth = defineService({
	name: "teamSupport.auth",
	lifetime: "application",
	effect: "external",
	eager: true, // compiler-required: the credential resolver
	// depends on this Service (section 13)
	config: {
		databaseUrl: config.secret(codec.text()),
		secret: config.secret(codec.text()),
		trustedHost: codec.optional(codec.text()),
	},
	runtime: { packages: ["better-auth"] }, // reviewable external-package
	// allowlist; the lockfile owns
	// version pinning
	create: async ({ config, signal }) => {
		const { createSupportBetterAuth } =
			await import("../../runtime/better-auth");
		const infrastructure = await createSupportBetterAuth(config, signal);
		return Object.freeze({
			handler: (request: Request) => infrastructure.auth.handler(request),
			principalId: async (headers: Headers) => {
				const session = await infrastructure.auth.api.getSession({ headers });
				return session?.user.id ?? null;
			},
			close: infrastructure.close,
		});
	},
	dispose: (auth) => auth.close(),
});
```

The credential resolver and the two `/api/auth/*path` Routes keep their
current shape (ADR-0015 `policy` and `credentials: "none"` spelling). Better
Auth keeps its own bounded `pg.Pool` inside `runtime/better-auth.ts`, now fed
from `config.databaseUrl`. The Better Auth CLI migration entrypoint consumes
the same generated loader instead of ambient environment reads:

```ts
// tracer/auth/migration-config.ts
import { loadAppConfig } from "#questpie/app";
import { createSupportBetterAuth } from "../../runtime/better-auth";

const { "teamSupport.auth": authConfig } = await loadAppConfig();
export const { auth } = await createSupportBetterAuth(authConfig);
```

Provider schema: the four `support_auth_*` tables stay provider-owned today,
which is honest evidence of a gap, not an endorsement. Section 13 defines the
two closure paths (an explicit bounded external-schema declaration for
application composition now; one-lifecycle migration projection before any
Auth Package ships, per ADR-0005). Session organization/membership/role
fields stay non-authoritative hints; Context re-reads the Membership; Policy
stays QUESTPIE-owned.

### 4.11 One explicit HTTP projection and one MCP projection

These members extend the same `tickets.detail` Definition shown in 4.4; they
are one Definition, not a second export (a second `defineQuery` with the same
name would be the accepted duplicate-identity collision).

```ts
export const ticketDetail = defineQuery({
  name: "tickets.detail",
  network: true,
  http: {
    method: "GET",
    path: "/api/tickets/:ticketId",
    request: {
      path: { ticketId: "id" },
      query: { commentsFirst: "commentsFirst",
        commentsAfter: "commentsAfter" },
    },
    responses: { ok: 200, missing: 404 },
  },
  mcp: {
    tool: "support_ticket_detail",
    description: "Read one support ticket with its recent public comments.",
    readOnly: true,
  },
  policy: policy.authenticated(),
  query: /* exactly the plan from 4.4 */,
});
```

Both projections are explicit opt-ins beside `network: true`, both call the
same generated Operation adapter, and neither owns a handler, Policy rule, or
schema of its own. Mutation HTTP projections additionally carry the mandatory
`Idempotency-Key` mapping and the reserved post-commit outcome surface
(section 15).

### 4.12 Generated client, vanilla observation, React, optimistic overlay

```ts
// tracer/browser/questpie.ts
import { createClient } from "#questpie/client";
export const desk = createClient({ baseUrl: location.origin }).withContext({
	organizationId,
	membershipId,
});
```

```ts
// vanilla observation, framework-neutral
const queueStore = desk.queries.tickets.queue.observe({
	input: { status: ["open"], teamId: null, first: 25, after: null },
});
const stop = queueStore.subscribe(() => render(queueStore.get()));
// queueStore.get(): { status: "loading" } | { status: "ready", data, stale }
//                 | { status: "declined", error } | { status: "failed",
//                   failure, retry }
```

```tsx
// React: the queue component observes; each row owns its own mutation state
import { useLiveQuery, useMutation } from "questpie/react";

import { desk } from "./questpie";
import type { TicketsQueueInput, TicketsQueueResult } from "#questpie/client";

function TicketRow({
	ticket,
	queueInput,
}: {
	ticket: TicketsQueueResult["nodes"][number];
	queueInput: TicketsQueueInput;
}) {
	const close = useMutation(desk.mutations.ticket.close);
	return (
		<li>
			{ticket.reference} {ticket.summary}
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
									nodes: page.nodes.map((node) =>
										node.id === ticket.id
											? { ...node, status: "closed" }
											: node,
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
				<UncertainBadge onRecover={close.recover} />
			)}
		</li>
	);
}

export function TicketQueue({ status }: { status: string[] | null }) {
	const input: TicketsQueueInput = {
		status,
		teamId: null,
		first: 25,
		after: null,
	};
	const queue = useLiveQuery(desk.queries.tickets.queue, { input });

	if (queue.status === "loading") return <Spinner />;
	if (queue.status === "declined") return <Denied error={queue.error} />;
	if (queue.status === "failed")
		return <Retry failure={queue.failure} onRetry={queue.retry} />;

	return (
		<ul data-stale={queue.stale}>
			{queue.data.nodes.map((ticket) => (
				<TicketRow key={ticket.id} ticket={ticket} queueInput={input} />
			))}
		</ul>
	);
}
```

The overlay lifecycle is exact: pre-commit failure or a declared error removes
the overlay; confirmed success reconciles it against the authoritative
refresh; post-commit ambiguity marks that call `uncertain`, keeps the
overlay, and `recover()` replays the exact Mutation Call Identity (the
accepted exact-duplicate recovery; changed input conflicts) or performs an
authoritative refetch. It never rolls back a possibly committed write. A
Policy revocation observed on refresh removes both optimistic and
authoritative data for the revoked scope.

## 5. Derived versus pinned contracts

The stale claim “adding a Collection Field automatically changes no Operation
input or output” is corrected. The approved model: **every Operation chooses a
derived or pinned surface; derived surfaces evolve intentionally with the
Collection; nothing changes silently, at compile time or at runtime**.

Demonstration: add one staff-facing Field to `tickets`:

```ts
escalationLevel: field.integer({ minimum: 0, maximum: 3, default: 0 }),
```

1. **Derived Query output changes.** `tickets.detail` selects
   `tickets.select(true)`; its result gains `escalationLevel: number`.
   `TicketsDetailResult` gains the member; the App Contract digest and the
   Operation output codec change in the same compile.
2. **Pinned Query output is stable.** `tickets.queue` selects the pinned
   `ticketSummary` object; its result does not change. Adding the Field there
   is an explicit one-line edit to the selection value.
3. **Caller-writable input derivation.** `escalationLevel` has caller
   provenance, so `tickets.updateInput()` gains `escalationLevel?: number`,
   and Mutations that derive input from it gain the member. Policy still
   decides who may write it (a `fields.update` entry granting it to staff).
4. **Server-owned exclusion.** Had the Field been declared `server: true`,
   no caller input anywhere would change; only the `values` lane and
   `select: true` outputs would see it.
5. **Generated declaration and contract diff.** The compile emits: a Schema
   Projection change (one migration), a Data Contract Projection change, new
   input/output codec bytes for every derived surface, updated named type
   aliases, and an unchanged wire _protocol_ version. `questpie build`
   output and the golden digests make the exact blast radius reviewable in
   one diff.
6. **Runtime honesty for clients already in flight.** A derived-surface
   change is a contract change, and the accepted compatibility machinery
   surfaces it rather than hiding it:
   - a retained client built against the previous deploy that calls the
     changed Operation is rejected before the operation body by the exact
     application/client-contract digest check, the same explicit
     incompatibility outcome as any contract change; pinned surfaces keep
     retained clients compatible;
   - the Query Template Digest of a derived plan is computed over the
     materialized (post-expansion) field set, so an in-flight `DataCursorV2`
     for that Query, including the nested comments cursor of 4.4, fails
     with the accepted `QP-DATA-010 invalidCursor` recovery and the client
     restarts pagination;
   - an open Live Query socket crosses the deploy through the accepted
     ADR-0012 reset delivery, never through silent drift.
     Slice 1 (section 22) carries the hostile test “Field added while a nested
     cursor is outstanding and a watch is open.”
7. **The directing TypeScript failure.** A browser editor form keyed
   exhaustively over the Mutation's input, shown below, fails to compile
   with `error TS2739: Property 'escalationLevel' is missing in type ...`,
   naming the exact new member at the exact consumer.

```ts
import type { TicketEditInput } from "#questpie/client";
const editors: Record<keyof TicketEditInput, EditorKind> = {
	ticketId: "hidden",
	teamId: "select",
	priority: "select",
	summary: "text",
	description: "markdown",
	assigneeMembershipId: "select",
};
```

Inference-driven evolution is a feature; a hidden change would be the bug.

## 6. Query and deep Relation language

The complete grammar shown across sections 4.3-4.5, stated as rules:

- **Constructors.** `collection.list(plan)` and `collection.get(plan)` build
  structural read plans. `get` returns `Result | null` and permits no root
  `page` member; `list` returns `{ nodes, pageInfo }` and requires a total
  order. The accepted `list`/`get` nouns are kept; no
  `findMany`/`findOne`/`read` family exists.
- **Parameters** are codec-typed, bound before SQL, and part of the cursor
  scope; the parameter grammar folds into the one codec kernel
  (`codec.list(inner, { maximum })`, `codec.cursor()`), superseding the
  `query.parameter.*` spelling (ledger S7). Bounded scalar lists keep
  canonical-set semantics: `in([])` is false, `notIn([])` is true (ADR-0008
  retained). A `codec.nullable(...)` parameter used in a comparison makes
  that comparison an **optional filter**: bound `null` means the filter is
  absent (ledger S13).
- **Optional-filter rule (formal).** An optional filter is legal only when
  its immediate enclosing combinator is `expr.and` and no ancestor
  combinator is `expr.not` (positive polarity). Disabling it then can only
  widen the result. `expr.or(expr.and(optionalFilter, b), c)` is legal;
  `expr.not(expr.and(optionalFilter, b))` and a bare
  `expr.or(optionalFilter, b)` are proposed `QP-DATA-020
nullableFilterPosition`.
- **Ordering** is one object whose authored property order is the total
  order; values are `"asc" | "desc"` or `{ direction, nulls }`. Field names
  are lower-camel, so no key can be an integer-like string that JavaScript
  would reorder; the compiler additionally rejects any such key. Reuse an
  ordering by referencing a whole object (`orderBy: ticketOrder`); when
  composing with spread, JavaScript keeps an overridden key at its first
  position, so the documentation states plainly that spread-merging two
  ordering fragments is legal but the emitted order follows first
  appearance, and whole-object reuse is the recommended idiom.
- **Selection** is `true` (complete scalar row), an object selector, a
  reusable `collection.select({...})` value, the documented boolean overload
  `collection.select(true)`, or a computed member. A computed member is a
  callback whose body is exactly one call to a compiler-recognized relation
  aggregate (`count()` today); anything else is proposed `QP-DATA-025`.
  A selection value's own enumerable keys are its entries, so object spread
  composes selections and each use site revalidates. An omitted `select`
  anywhere (kernel calls, nested `list`) defaults to the complete scalar
  row. There is no exclusion syntax, so no include/exclude ambiguity.
- **Relations.** To-one relations nest `{ select }` and may chain within the
  proposed depth budget of four hops (`QP-DATA-022` with the exact path and
  Origin beyond it). To-many relations load through
  `{ list: { where?, orderBy, first, page?, select? } }`: under a singular
  parent (`get`, or a proven unique row) `page` may carry a cursor; under a
  plural parent only bounded top-N `first` is legal. Full child paging under
  plural parents requires a separate Query or a singular-parent read; the
  compiler says exactly that in `QP-DATA-021`.
- **Membership.** Nested `where` filters payload only. `some`/`none`/`every`
  are the only parent-membership operators in Query filters, with the
  empty-relation semantics and disclosure-authorized universe defined in
  4.5. `expr.exists` is not Query-filter surface (section 7).
- **Aggregates.** `relation.count()` in selection, computed over the same
  authorized universe as the corresponding `some`. At most four aggregate
  members per plan (proposed; slice 1 pins the number with measured
  evidence), counted into the dependency and expression-node budgets.
  Further aggregates wait for a consumer.
- **Reuse.** Selections are plain composable values; predicates are ordinary
  functions typed with `PolicyScope` and `RowOperand<typeof collection>`
  (4.2). A compiled use site derives normalized nodes, dependency facts, and
  Origin; a fragment referencing a Collection outside its declared scope
  fails at the use site with both Origins.
- **Plan-backed and handler-backed.** A Query with a `query:` member and no
  handler infers input and output from the plan. A handler Query composes
  `ctx.data.<collection>.list/get` reads inside **one** bounded
  repeatable-read snapshot per Query root (this repairs the currently open
  multi-transaction gap) and pins `output` only where inference is
  unsupported. Handler-inline plans may compare Fields against plain
  runtime values (bound as statement parameters), which is how a read
  scopes itself to `ctx.values` facts today; plan-backed predicates see
  only `{ row, parameters }`. Giving plan predicates read-only
  `principal`/`tenant`/`values` operands, so the common caller-scoped list
  can stay plan-backed, is a proposed additive extension awaiting approval
  (section 24): the operands already exist in Policy programs and their
  reached facts already enter the cursor policy scope.
- **Live Query.** `.watch` appears on the same callable generated Query when
  compilation proves watchability; the observed-dependency plan covers data,
  Policy, tenancy, Relation, quantifier, aggregate, and pagination reads.

What the compiler lowers versus what stays TypeScript: the plan object
literal, selections, predicates, ordering, and pages normalize at compile
time into one closed AST with deterministic bytes, one prepared SQL statement
family, one parameter codec, one output codec, and one dependency plan.
Callback selection members and reusable predicate functions execute exactly
once during controlled structural evaluation; nothing user-authored runs per
row. Policy scope intersects before caller filters, pagination, locks, and
disclosure, exactly as ADR-0010 requires.

## 7. Policy and custom authorization

- One vocabulary, two capabilities. `expr.and/or/not/always/never` plus Field
  operand methods are shared by Query filters and Policy programs.
  `expr.exists(collection, predicate)` exists only inside Policy programs,
  where it compiles to the accepted boolean-only, nondisclosing Policy
  Evidence Read. It is deliberately **not** Query-filter surface: a Query
  existence read against another Collection would either skip that
  Collection's disclosure Policy (the ADR-0010 evidence semantics, which
  would leak hidden-row existence through parent membership) or silently
  mean something different from the same spelling in Policy. Query parent
  membership therefore always goes through declared Relations and
  `some`/`none`/`every`, which apply target disclosure Policy. Using
  `expr.exists` in a Query filter is proposed `QP-DATA-025
unsupportedExpressionCapability`, with the diagnostic naming the
  quantifier alternative. `expr.never()` replaces
  `query.not(query.always())` where a residual denial is still meaningful.
- Boundaries retained verbatim from ADR-0010: evidence is boolean-only,
  nondisclosing, never returns a row/count/identity/facet/payload, never
  recursively applies target disclosure Policy, is bounded and cycle-checked,
  and its mutable reads are recorded Policy dependencies.
- The fixed Collection Policy matrix stays: `read` (admit + rows), `create`
  (admit + candidate), `update` (admit + rows + candidate), `delete`
  (admit + rows), and `fields` (create/update maps over the caller-writable
  surface only). `policy.authenticated()` stays as the admission shortcut.
- Custom synchronous admission: `policy.admit(({ principal, tenant, values })
=> boolean)` over immutable Execution facts only. It cannot read
  Collections, call Services, or await anything; the callback type is
  synchronous and receives no I/O capability. Relational conditions belong
  in `rows`/`candidate` programs where they see current database facts
  inside the owning snapshot or transaction. Asynchronous external
  authorization lookups inside admission are unrepresentable.
- Recommended external-authorization model, documented as the pattern page:
  the credential resolver authenticates identity; Principal carries immutable
  credential facts; current roles, tenant membership, and entitlements live
  in PostgreSQL Collections read by Context and Policy; external entitlement
  systems synchronize into those Collections (a Job is the natural sync
  owner); Route and Action integrations never mint Authority.

## 8. Collection CRUD, provenance, and lifecycle

- **Kernel.** Every Collection owns `get`, `list`, `create`,
  `update({ key, expected?, patch?, values?, select? })`, and
  `delete({ key })` internally, generated whether or not anything is public.
  `key` accepts the primary key or the complete column set of any declared
  unique constraint (compiler-verified), so natural-identity rows need no
  surrogate-id pre-lookup. `expected` is the compare-and-set clause;
  `select` defaults to the complete scalar row. A write losing a race to a
  declared unique constraint throws a typed `ConstraintViolation` carrying
  the declared constraint name and no raw database detail
  (`operation.isConstraintViolation(error, name)`), which handlers remap to
  declared errors. Cross-Collection readability checks are kernel reads: a
  `get` returning `null` means missing or not readable under the target's
  own Policy, and Policy programs never restate another Collection's read
  Policy (a recursive `readable()` evidence primitive stays rejected per
  ADR-0010). The kernel owns codecs, unknown-key rejection, locks and
  candidate recheck, constraints, lifecycle order, selection, output
  authority, Change Ledger capture, and empty-patch rejection. Named
  Mutations compose this kernel and cannot bypass it; there is no raw SQL or
  raw transaction handle in application code.
- **Provenance vocabulary** (per Field, orthogonal to nullability and
  defaults; `nullable` defaults to `false`, ledger S14):
  - default: caller-writable on create and update;
  - `immutable: true`: caller-writable on create, frozen afterwards;
  - `server: true`: only the trusted `values` lane may supply it;
  - `server: true, immutable: true`: `values` on create only;
  - `default: "..."`: database default when no lane supplies a value; a
    nullable Field with no default and no lane assignment is SQL `NULL`;
  - `onUpdate: "now"`: database-owned; no lane may supply it; the database
    advances it on every kernel write and the returned row carries the final
    value. This is the normal `updatedAt` spelling and also covers
    explicitly supported managed writers.
    Normal scalar Fields are caller-writable unless provenance says otherwise;
    there are no repetitive denial rules for server Fields.
- **Input helpers.** `collection.createInput()` and
  `collection.updateInput()` return codec-object values derived from
  provenance, with `.pick({ field: true })` and `.omit({...})` object
  selection. They preserve inference: picking a Field keeps its exact codec,
  and the values compose into `codec.object` spreads as ordinary members.
- **Trusted values.** `values` entries may derive from caller input, the
  current row, transaction-scoped Collection reads, `ctx.now`, `ctx.callId`,
  and deterministic ordinary TypeScript. The final candidate always passes
  normalization, validation, candidate Policy, and constraints; `values`
  bypasses only caller Field authority, which is exactly its meaning, and
  candidate Policy is written to verify what any lane submitted (4.6).
- **Lifecycle.** Four fixed phases, all statically bundled and digested:
  - `normalize({ input })`: pure, deterministic, capability-free; ordinary
    string functions like `.trim()` are the intended idiom; the evaluator
    seam enforces the purity claim (no ambient clock, random, fetch, or
    module state);
  - `validate({ candidate, current?, errors, now })`: pure candidate
    validation with the transaction-stable clock value;
  - `check({ candidate, current?, ctx })`: Policy-aware transaction reads
    before the write, for invariants that need current database facts. Its
    reads are bounded by the same statement and dependency budgets as the
    owning Mutation, and exceeding them fails with the owning budget
    diagnostic while the row lock is released with the rolled-back
    transaction;
  - `afterWrite({ row, previous?, ctx })`: joins the owning transaction; may
    perform bounded kernel reads/writes, audit writes, and Job acceptance.
    Its `ctx` type is structurally narrowed to exactly `data`, `jobs`,
    `now`, and `callId`: no `services`, no `actions`, no Route/Request
    capability, so the no-external-effect rule is a type error, not a
    convention. Its list reads require an explicit bounded `first`, and all
    its work counts into the owning Mutation's statement, row, and
    dependency budgets, which makes a small bounded fan-out (one Job per
    listed row) legal and an unbounded fan-out a budget failure by
    construction; the durable large-fan-out pattern is a named open
    capability (section 24). Re-entrant kernel writes (afterWrite
    triggering another Collection's afterWrite) are depth-bounded and
    diagnosed (proposed `QP-DATA-024 lifecycleRecursionExceeded`), and run
    in deterministic write order inside the one owning transaction,
    preserving the ADR-0011 fixed mutation order for each write.
    There is no `afterRead` hook; read shaping belongs to selection, codecs,
    and Queries.
- **Simple CRUD and cross-Collection transitions** are shown in 4.7; the
  `addComment` Mutation in 4.8 shows kernel writes on two Collections plus
  durable acceptance in one transaction.
- **Later PostgreSQL parity audit** (recorded, not designed here): generated
  columns, identity columns, domains, enums, arrays, ranges, JSONB interior
  operators, extensions, full-text, PostGIS, and vector storage each need a
  provenance/codec/migration/fingerprint answer before public exposure.

## 9. Named Mutation and transactional Job acceptance

Covered concretely in 4.7 and 4.8. The contract points:

- a named Mutation is the only cross-Collection invariant owner; it composes
  the kernel, so Policy, lifecycle, constraints, Change Ledger, and receipts
  are unavoidable;
- Mutation output is inferred from typed kernel writes when the compiler can
  materialize the codec (kernel results always qualify); explicit `output`
  pins remain for stability, recursion, and unsupported shapes;
- one Mutation may accept several independently keyed Jobs, including
  absolute `notBefore` work; acceptance commits or rolls back with the
  business writes; replay by Mutation Call Identity returns the stored
  receipt without re-acceptance;
- the compiler-derived default identity exists only for statically provable
  at-most-once Mutation callsites (a lexical acceptance expression not
  inside a loop and not reachable twice per call; branches and early throws
  preserve at-most-once); everywhere else the missing `idempotencyKey` is a
  compile diagnostic naming the callsite.

## 10. Ordinary Job DX and the later trigger seam

- The happy path is section 4.9: application code plus `runAs` and `retry`.
  No lease machinery appears.
- **Exact liveness contract.** The Runtime heartbeats on its own timer while
  the handler runs, and stops renewing at the attempt deadline: the lease is
  bounded by the accepted per-attempt deadline, never by event-loop
  liveness. A CPU-starved loop stops heartbeating earlier (the timer cannot
  fire); an I/O-hung but event-loop-alive handler heartbeats only until the
  attempt deadline, then the Runtime cancels, the lease expires, and retry
  plus stale-worker fencing engage. Framework-owned waits
  (`ctx.attempt.sleepUntil`, kernel calls, future capabilities) observe
  cancellation and lease loss. The documentation states the CPU-bound limit
  honestly, and `ctx.attempt.heartbeat()` plus `ctx.signal` remain public
  advanced controls for long CPU-bound work.
- `ctx.attempt.now()` is the Runtime-owned attempt clock.
  `ctx.attempt.sleepUntil(date)` is a process-local, signal-aware wait, not
  a durable timer: the target must fit inside the remaining attempt budget,
  otherwise the call fails immediately with a diagnostic pointing at
  delayed acceptance (`notBefore`); a crash or lease loss mid-sleep produces
  a fresh attempt that re-sleeps toward the same absolute instant, and the
  retry `horizon` keeps bounding total run life. Durable sleep stays in the
  checkpoint slice. `Date.now()` remains structurally forbidden.
- Acceptance: one object envelope, full `idempotencyKey` name, `notBefore`,
  and the derived-default rule from section 9. Direct server acceptance
  (`app.execution(...).jobs.<name>.accept({...})`) always requires the
  explicit key.
- Run-as honesty: `durable.caller({ whenDenied: "fail" })` is the only
  recipe. A Job that concerns a different person (a notification
  recipient) carries that person's id as ordinary input and executes
  within the accepting caller's authority. A trusted service-principal
  run-as recipe is a real gap the audit confirmed and stays a named open
  capability with the later trigger seam (section 24); this packet does
  not invent `durable.system`.
- Future triggers use a named object (`triggers: { nightlySweep: {...} }`),
  each mapping to the Job's one exact input with its own causation, identity,
  and runAs semantics. This packet freezes only the seam's shape: no
  heterogeneous trigger arrays, no Event relay to enqueue a Job, webhooks
  remain Routes that accept Jobs, and Collection-trigger syntax stays open
  until bulk/delete/cascade/soft-delete/raw-writer/version semantics close.
- Reaction removal is a later compatibility and deletion slice after Job
  trigger parity; `defineReaction` remains valid surface until then. Browser
  code gets no generic Job control; applications expose Policy-protected
  Operations for user-visible cancellation or status.

## 11. Generated vanilla client

- **Shape.** Nested kind/domain maps with one object envelope per call:

  ```ts
  client.queries.tickets.queue({ input, signal, timeout });
  client.mutations.ticket.close({ input, callId, signal });
  client.actions.notifications.send({ input, effectKey, signal });
  ```

  The exact Resource Identity (`query:tickets.queue`) remains wire, artifact,
  and tooling authority; the nested map is the human projection. The client
  maps adopt the server maps' collision rules: same-kind leaf/namespace
  collisions and final-`then` segments fail compilation with both Origins
  (extending QP-COMPOSE-023/024 to client emission).

- **One descriptor source.** The callable member is also the stable
  descriptor and observer source: `.key(input)` yields the compiler-derived
  cache identity (operation identity, normalized input bytes, Context
  partition, deployment contract); `.observe({ input, signal })` returns the
  framework-neutral store; `.watch({ input })` exists exactly where the
  compiler proved watchability. There is no second `operations` registry and
  no `desk.call(operation, input)` indirection.
- **Named types.** For every Operation the client emits `TicketsQueueInput`,
  `TicketsQueueResult`, and `TicketsQueueError` aliases (declared-error
  union), deleting the `Awaited<ReturnType<...>>` idiom.
- **Observer core.** Framework-neutral: subscribe/get/refresh/dispose, request
  deduplication by `.key`, staleness from Mutation invalidation facts and
  Live Query resets, cancellation via `AbortSignal`, and deployment
  incompatibility surfacing as a typed `failed` state. Invalidation facts are
  compiler/Change-Ledger derived; applications never author string cache
  keys.
- **Ambiguity semantics.** Mutation calls never auto-retry; post-commit
  response loss surfaces the accepted committed-result-recovery contract
  (replay by the same `callId` recovers the stored receipt; changed input
  conflicts).

## 12. `questpie/react` and optimistic updates

- `useQuery(operation, { input, enabled? })`,
  `useLiveQuery(operation, { input, enabled? })`, and
  `useMutation(operation)` are thin `useSyncExternalStore` adapters over the
  observer core; they own no cache, no transport, and no identity. A
  component that acts per row instantiates `useMutation` per row (4.12).
  TanStack Query can later adapt the same core; QUESTPIE React never
  requires it.
- Query state union: `loading | ready(data, stale, refreshing) |
declined(error) | failed(failure, retry)`. Live queries add reset/refresh
  transitions inside `ready.stale` rather than flashing `loading`.
- Mutation state union: `idle | pending | success(data) | declined(error) |
failed(failure) | uncertain(callId, recover)`. `uncertain` is the honest
  post-commit state and is never silently mapped to `failed`.
- Optimistic model (shown in 4.12): opt-in per call; explicit ordinary-TS
  updater; the target is a generated callable Operation plus exact input;
  every mutation call owns its own overlay layer, composed above
  authoritative data in call order; pre-commit or declared failure removes
  the overlay; confirmed success reconciles against the authoritative
  refresh; `uncertain` keeps the overlay, marks the state, and recovery
  either replays the exact Call Identity or refetches authoritatively; a
  possibly committed write is never rolled back; Policy revocation removes
  optimistic and authoritative data together; optimistic creates use a
  pending view model or an explicit temporary identity and never fake the
  exact server row.

## 13. Typed Config, Service lifecycle, and Better Auth composition

- **Config.** A Service declares `config` once using the one codec kernel
  plus a `config.secret(...)` marker (no second scalar grammar). The
  compiler composes every declared schema into one generated `AppConfig`
  type keyed by Service name. Structural evaluation sees only the schema.
  Values reach every execution surface through one mechanism:
  - `createApp({ config })` for embedding and tests (plain objects);
  - the generated environment mapping for `questpie start`;
  - the generated `loadAppConfig()` loader for CLI-invoked entrypoints such
    as the Better Auth migration config (4.10), so no CLI path reads
    ambient environment ad hoc;
  - worker attempts inherit the running application's config;
  - Service factories receive their exact typed slice.
    Two Services may each declare a schema member that one deployment value
    feeds (both pools want the database URL): the schemas stay per-consumer
    and the deployment edge maps one source value to both paths. That
    duplication is deliberate honesty about two consumers; both copies are
    read at the same startup, and a reference/alias mechanism is deferred with
    a named condition (a third consumer needing independent rotation).
    Secrets never enter Build Input, manifests, digests, generated
    declarations, logs, or diagnostics; the redacted wrapper unwraps only
    within the owning Service's construction call stack. Missing or invalid
    values fail readiness with exact paths before the first request.
- **Service lifecycle**, closed explicitly:
  - application lifetime: one instance per Runtime instance; execution
    lifetime: per root, retained through response EOF/error/cancellation
    (unchanged);
  - `eager: true` marks readiness dependencies: created during startup,
    before traffic; failure fails readiness and cannot downgrade to
    anonymous. The compiler **requires** `eager: true` on any Service the
    credential resolver depends on, directly or transitively (proposed
    diagnostic), so an auth outage is a readiness failure, never a
    per-request lazy retry that traffic keeps hitting;
  - other lazy Services stay lazy and coalesced, but a rejected creation no
    longer poisons the Runtime: the rejection propagates to current
    consumers, the cached promise is cleared, and the next consumer retries.
    This supersedes the current cached-failure behavior deliberately;
  - disposal stays once, reverse dependency order; creation receives an
    `AbortSignal`; cancellation during creation runs the acquired-resource
    release; dispose failures are reported, never re-thrown into consumers;
  - test overrides replace a dependency at the typed construction seam
    (`createApp({ services: { "teamSupport.auth": fake } })`) without any
    authority bypass: the fake still flows through the same capability
    boundaries.
- **Runtime packages.** `runtime: { packages: [...] }` declares
  executable-only npm dependencies that stay external to the generated
  bundle. Its purpose is declaration and review: today's ad-hoc dynamic
  import becomes a named allowlist entry recorded in Runtime Build
  integrity. Version pinning and supply-chain integrity remain the
  lockfile's job inside the Build Input; this member adds no second pinning
  authority.
- **Provider schema.** Two closure paths, both explicit:
  - application composition (today's fixture) uses a bounded
    **external-schema declaration**: the application names the
    provider-owned tables (`support_auth_*`), drift verification excludes
    exactly those and reports them as externally owned, and no unified
    drift-safety claim covers them. This turns the current silent second
    migrator into a declared, reviewed boundary;
  - a reusable Auth **Package** must project its schema through the one
    Compiled Manifest / Migration Plan / checksum / fingerprint / drift
    lifecycle before it ships; ADR-0005 is explicit that a native Auth API
    does not permit a second hidden schema migrator.
    Slice 5 lands the declaration, repairs `tracer/auth/migration-config.ts`
    to the generated loader, and adds the drift hostile.
- **Better Auth** is the first proof (4.10); the second materially different
  proof for any generic provider seam is a custom signed-cookie or API-key
  credential path with no provider schema (the fixture's integration-key
  branch already sketches it) plus one non-Auth provider Service used by
  Route and Action. Until both exist, no `credential.cookie()`-style
  convenience family and no database-adapter capability ships; Better Auth
  keeps its separate bounded pool, and no adapter gets ambient raw Runtime
  database authority.
- **Credential resolution** stays ordinary TypeScript over the narrow
  resolver contract and must handle: absent (anonymous), resolved, malformed
  (typed failure), conflicting mechanisms (closed precedence declared in the
  resolver, never source order), unavailable (typed, never anonymous), and
  cancelled. There is no auth-provider registry and no credential DSL.

## 14. Route matching decision (Q63)

The one intentionally open detail. Three modes compared against Better Auth
(`/api/auth/*path`, mounted as one GET Route and one POST Route on the same
literal wildcard) and the second provider mount (an OIDC/OAuth callback
provider or an S3-compatible byte gateway; both also own a whole prefix):

1. **Exclusive per-pattern subtree ownership.** Stated precisely:
   - subtree ownership is a property of the literal wildcard path pattern,
     not of one Route Definition;
   - Routes declaring the exact same wildcard pattern with pairwise-disjoint
     methods jointly form that pattern's owner group (the ordinary exact
     method/path collision rule applies among them), which is exactly how
     the two Better Auth Routes mount today;
   - any other Route at a strictly more specific literal path under the
     owned prefix collides against the owner group **regardless of its own
     method**, including methods no co-owner declared, so the subtree stays
     genuinely exclusive;
   - the compiled manifest carries one subtree-ownership row per pattern
     listing the owner Routes, their methods, and Origins, so “who owns
     `/api/auth/*` and is a child Route legal” is answerable before
     runtime.
2. **Explicit fallback (more-specific wins).** Supports carve-outs, but
   reintroduces precedence reasoning, makes the provider's effective surface
   depend on the rest of the application, and silently changes provider
   behavior when someone adds a more specific Route: the accidental-override
   class ADR-0007 rejects at composition level.
3. **Augmentable subtree.** Typed owner-approved child contributions would
   be correct if a provider Package wanted to accept host children. Neither
   proof integration wants that; building the acceptance machinery now
   fails the two-consumer bar.

**Recommendation: mode 1.** It is the smallest rule supporting both real
integrations and keeps every invariant: no source or package order, no
accidental override, both Origins on every collision (proposed
`QP-COMPOSE-025 routeSubtreeCollision`), exact and wildcard ownership visible
in the compiled manifest, matching explainable before runtime. The realistic
carve-out demand (“disable sign-up”, “rate-limit one auth sub-route”) is
served today by provider-level configuration and by the owner Routes' own
limits; a real integration that needs a host-owned child Route inside a
provider subtree is the named condition for revisiting modes 2 or 3 through
a focused supersession. No universal routing plugin system is created for
one provider mount.

This recommendation is isolated for final human approval in section 24.

## 15. RPC, real HTTP, OpenAPI, and MCP projections

- **RPC.** `POST /_questpie/operation` stays the first-party generated-client
  transport for `network: true` Operations, with Operation Wire versioning,
  Context transport, limits, declared errors, Call Identity, and Effect
  Identity exactly as accepted. It is never presented as the public HTTP
  story, and its OpenAPI representation is not pretended to be REST.
- **HTTP projection.** Explicit opt-in per Operation via the `http` member
  (4.11): method, path template, object pickers mapping input members to
  path/query/header/body locations, success status and headers, and declared
  failure mappings to statuses. Exactly one `http` binding per Operation in
  this packet; multiple bindings are deferred with slice 6 as owner. Rules:
  - no automatic REST derivation from Operation names;
  - GET only for Queries whose input encodes deterministically into
    path/query within a proposed 2,048-byte encoded path-plus-query budget
    (aligned with the accepted cursor envelope); otherwise POST; exceeding
    the budget at bind time is the ordinary execution limit diagnostic, and
    an unprovable budget at compile time is an Origin diagnostic;
  - every Mutation projection automatically binds the caller-supplied
    `Idempotency-Key` request header to the Operation's `callId`, so HTTP
    retries reach the accepted exact-duplicate replay instead of minting
    fresh default call identities; the binding is built in rather than
    authored, so it cannot be forgotten (the audit showed authors
    guessing at a manual spelling);
  - response bodies use the exact declared output/error codecs and fail
    closed; framework outcomes keep their meaning: the accepted post-commit
    outcome (`COMMITTED_RESULT_UNAVAILABLE`, with its recovery identities)
    is surfaced through one reserved status and body shape, is documented
    as non-retryable-without-identity, and is never flattened into a
    generic 500/retry hint; Action ambiguity keeps its non-retryable
    meaning likewise;
  - unrepresentable mappings are Origin diagnostics, not silent omissions
    (proposed `QP-COMPOSE-026 httpProjectionInvalid`, also covering
    path/method collisions with both Origins).
- **Raw Route** remains the escape hatch for actual HTTP protocols:
  webhooks, auth handlers, streaming, files, redirects, custom media types.
- **OpenAPI** is generated from explicitly HTTP-projected Operations plus raw
  Routes that declare sufficient explicit schemas; everything else is
  omitted with a diagnostic. `operationId` derives deterministically from
  Resource Identity; security schemes describe credential transport only and
  never claim Policy semantics.
- **MCP** is a native compiler projection selected per Operation via the
  `mcp` member, separate from `network: true`. Tools reuse the same
  executor, Context, Policy, limits, typed outcomes, and Execution Envelope;
  input JSON Schema derives from the input codec; outcomes map deliberately:
  successful output and declared errors become structured content and
  tool-execution errors, framework failures become protocol errors, and the
  post-commit outcome is a reserved tool-execution error carrying its
  recovery identities. `readOnly`/destructive annotations are untrusted
  hints, never authorization. MCP ingress is not a second trust path: the
  MCP endpoint mounts like any ingress and resolves Principal through the
  one ADR-0015 credential resolver; confirmation, rate limits, and audit
  sit around the same executor in the host binding.
- **Collision domains.** The compiler owns three collision domains across
  application and Package contributions, sharing Origin-reporting but not a
  data structure: one path trie for raw Routes plus Operation HTTP
  projections (`QP-COMPOSE-025/026`), and one flat tool-name namespace for
  MCP identities (proposed `QP-COMPOSE-027 mcpToolCollision`). Every
  collision is a compile-time failure with both Origins; there is no
  source-order or package-order precedence. Packages contribute Operations
  plus structural HTTP/MCP metadata and receive no code-generation
  callbacks.
- **Digests.** `http` and `mcp` members enter the projection artifacts and
  their digests; they do not change Operation Wire bytes, so a deployment
  can change HTTP/MCP presentation without breaking retained RPC clients.

## 16. Package authoring

- A Package exports known QUESTPIE Definitions, structural values, and typed
  Augmentations; `#questpie/package` specializes the executable factories to
  the sealed Package Contract. Activation is explicit in `questpie.json` and
  visible in the composition graph; installation activates nothing.
- Forbidden, restated as contract: `compiler.use(plugin)`, arbitrary compiler
  callbacks, raw code-generation hooks, a global `customType` registry,
  ambient host-only authority, install-time activation, last-wins or
  source-order composition.
- The extension line is explicit: a Package parameterizes **fixed,
  core-implemented** node kinds (declarations, config schemas, migrations,
  metadata); it never registers executable callbacks into the compiler, the
  expression kernel, or SQL lowering. No configuration-only mechanism for a
  third party to add a new operator or index kind exists in this packet;
  if one is ever wanted, it is its own superseding decision against
  ADR-0007 and this section.
- A Package may declare: required PostgreSQL extensions (with version
  bounds), config schema, runtime packages, migrations through the one
  migration/fingerprint lifecycle, generated server/client type
  contributions where legitimate, and documentation. Activation produces a
  reviewable inventory and migration diff before runtime.
- Vendoring stays the customization path for sealed Definitions, exactly as
  SPEC section 5 records.

## 17. pg_search Search proof

Replace the standalone pgvector-first capability proof with a staged
pg_search-backed Search projection. Scope honesty first:

- this replaces the _standalone public pgvector capability proof_, not any
  internal fact: current pg_search vector retrieval may still depend on
  pgvector internally, and this packet does not claim pg_search eliminates
  pgvector;
- the application-facing API speaks the QUESTPIE Search language only; the
  words pg_search, Tantivy, BM25, pgvector, HNSW, and provider SQL never
  appear in application code;
- embedding/vector storage remains an internal physical detail of Search; no
  public `field.vector()` or generic vector operators ship unless a real
  consumer needs vectors as ordinary Collection data outside Search.

**Stage 1 (the first proof slice)**, against Support Desk tickets/comments:
full-text/BM25 relevance, structured filtering, ranking, highlighting,
facets and aggregates, autocomplete where the engine supports it,
deterministic migrations, extension readiness, physical index ownership,
document/projection versioning, rebuild and cutover, diagnostics with
Origins, current Tenant and Collection Policy, deletion and Field output
authority, authorized totals/facets/cursors, and generated Query plus client
types.

**Stage 2 (a separate slice)**: semantic/vector retrieval and hybrid
retrieval with RRF. Stage 2's first deliverable is the embedding-generation
ownership model, which stage 1 deliberately does not need: producing an
embedding is an external effect, so it belongs to the derived-projection
worker through an explicit external-effect seam with Action-grade ambiguity
handling, and an embedding failure affects freshness, never authority.
Claiming hybrid retrieval before that model exists would be dishonest about
where the external call lives.

Accepted Search authority preserved verbatim (ADR-0018): Search is a
committed derived projection, not authorization; the index returns candidate
keys; one bounded source plan rejoins current rows; stale, forged, deleted,
foreign-tenant, or newly denied candidates disclose nothing, including
through totals, facets, cursors, and statistics; no JavaScript
post-filter/refill authority shortcut. The candidate keys may come from a
lagging engine, but the bounded rejoin plan always executes against the
authoritative primary through the Runtime's own pool; a topology that
rejoins on a read replica is rejected, because replication lag would turn
Search freshness lag into a disclosure defect. Full-text physical indexes
are Search capability projections; the public foundational Index contract
stays B-tree-only.

Deployment honesty, documented with the proof:

- pg_search requires supported PostgreSQL extension installation and preload
  configuration; local and CNPG proof runs default to the official published
  ParadeDB image, and an owned image is built only if the proof needs a
  PostgreSQL version the provider does not publish, with patch cadence,
  multi-arch, registry, and CVE-scanning costs named before that fallback is
  chosen;
- ordinary hosted Supabase PostgreSQL is not assumed to permit pg_search; a
  ParadeDB replica is a materially different deployment topology and is
  documented as such (and excluded from rejoin, above);
- pgvector-only compatibility is not pg_search Search support;
- an absent or incompatible extension version fails readiness explicitly and
  names the extension, the found version, and the requirement.

## 18. PostGIS proof and the proposed extension seam

PostGIS is the second, materially different extension proof: database
scalar/value representation (geometry/geography, SRID, dimension), codecs and
canonical bytes, extension readiness, migrations and fingerprints, spatial
operators, spatial indexes (GiST/SP-GiST) as capability projections, Query
and Policy lowering, generated client representation, and Package
Origins/diagnostics. Its operators and index kinds are core-implemented node
kinds that the capability parameterizes, per section 16's extension line.

Only after pg_search stage 1 and PostGIS both pass may a shared narrow
extension seam be considered. The following list is a **falsifiable
hypothesis the proofs must not design toward**, not a commitment: extension
requirement/readiness declaration, migration/fingerprint participation,
capability-parameterized core node kinds, capability-scoped physical index
projection, and codec projection into generated contracts. Everything
capability-specific (BM25 grammar, RRF, SRID rules, spatial operator
semantics) stays outside any seam. If the two proofs do not converge, no
seam is extracted and both remain first-party capability Packages.

## 19. Compiler guarantees and diagnostics

The redesign adds surface but no new guarantee class. The compiler owns:

- deterministic normalization of plans, selections, predicates, provenance,
  lifecycle slices, config schemas, and projections into canonical bytes and
  domain-separated digests;
- exact generated contracts: named input/result/error aliases, client maps,
  server maps, App Config, and provenance-derived input codecs;
- Origin-bound diagnostics for every rejection. Existing spellings are
  reused only where their registered trigger matches (`QP-COMPOSE-013`,
  `QP-COMPOSE-023/024`, `QP-POLICY-001/002`, `QP-DATA-010/013`, the
  accepted exact-input unknown-key rejection). Proposed new spellings in
  this packet: `QP-DATA-020 nullableFilterPosition`, `QP-DATA-021
nestedCursorUnderPluralParent`, `QP-DATA-022 relationDepthExceeded`,
  `QP-DATA-023 databaseOwnedField`, `QP-DATA-024
lifecycleRecursionExceeded`, `QP-DATA-025
unsupportedExpressionCapability` (capability-branding violations get
  their own code rather than widening `QP-COMPOSE-013`, whose recorded
  overload follow-up the first slice also closes), `QP-COMPOSE-025
routeSubtreeCollision`, `QP-COMPOSE-026 httpProjectionInvalid`, and
  `QP-COMPOSE-027 mcpToolCollision`. Each registry addition follows the
  accepted revision process; implementations cannot invent spellings;
- hard budgets: the accepted 100-row pages, bounded list parameters,
  dependency counts, expression nodes, and declaration size, plus the
  proposed relation depth of four hops, at most four aggregate members per
  plan, the 2,048-byte GET encoded path-plus-query budget, and the
  TypeScript instantiation budget SPEC section 6 already requires (the
  exact fraction stays an implementation-gate decision; slice 1 measures
  this vertical against it), each failing with the exact path and Origin;
- static parity: generated declarations and Runtime projections must expose
  identical member inventories (the current `ctx.data` declaration/runtime
  disagreement is a repair gate before any of this ships).

## 20. Exact Accepted ADR supersession ledger

Each entry names the exact clause and the change class. Additive extensions
are listed separately and are not supersessions.

| #   | ADR and clause                                                                                                                                                                                                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | ADR-0011: “`defineCollectionOperations(collection, body)` is closed compile-time shorthand. Selected `list`, `get`, `create`, `update`, and `delete` members lower … to ordinary Query or Mutation Resources.”                                                               | **Superseded.** The always-generated internal CRUD kernel plus named Operations replace the shorthand. `defineCollectionOperations` is removed after the Collection+Mutation slice; existing fixtures migrate to named Operations.                                                                                                                                                                |
| S2  | ADR-0011: “The Context exposes a transaction-stable `operationTime` …”                                                                                                                                                                                                       | **Superseded (spelling).** The public name becomes `ctx.now`; semantics unchanged.                                                                                                                                                                                                                                                                                                                |
| S3  | ADR-0011: “`createdAt` and `updatedAt` remain ordinary Fields. Any server value or `updatedAt` change is an explicit Mutation-owned assignment.” and ADR-0008: “automatically advancing `updatedAt` belongs to the later transaction-owned Mutation contract.”               | **Superseded.** `onUpdate: "now"` makes `updatedAt` a database-owned invariant with compiler-owned migration, fingerprint, returned-value, and Change Ledger semantics; it also applies to explicitly supported managed writers.                                                                                                                                                                  |
| S4  | ADR-0011: “Sparse caller Field authority runs before closed pure normalization. Schema defaults and closed server `values` then construct the complete candidate …”                                                                                                          | **Superseded (extended semantics).** The fixed order is retained, but the write model gains Field provenance and a named-Mutation trusted `values` lane: caller Field authority applies only to the caller patch over the provenance-derived surface; `values` assignments skip caller Field authority by definition and still pass normalization, validation, candidate Policy, and constraints. |
| S5  | ADR-0011: “Lifecycle jobs have explicit owners: closed Field normalization, closed server values, a named Mutation …, a transaction-owned typed dispatch intent …, and an Action … There is no general hook catalogue.” and the matching ADR-0016 lifecycle-mapping clauses. | **Superseded (narrow).** The four fixed Collection phases `normalize`/`validate`/`check`/`afterWrite` become authored executable slices with the capability bounds in section 8. Still no general hook catalogue, priorities, or ordering registry.                                                                                                                                               |
| S6  | ADR-0010: “`definePolicy(collection, body)` … `policy.exists(collection, predicate)` provides bounded, compiler-authored, boolean-only relational evidence …”                                                                                                                | **Superseded (spelling only).** The vocabulary becomes `expr.*` with `expr.exists` restricted to Policy programs; every evidence semantic clause of ADR-0010 is retained verbatim.                                                                                                                                                                                                                |
| S7  | ADR-0019: “Existing `shape`, `value`, `constraint`, `relation`, `relationRef`, `dataQuery`, `query`, `index`, `seed`, `mutation`, `context`, and `principal` jobs remain available.”                                                                                         | **Superseded (partial).** `dataQuery` and the `query.*` expression and parameter namespaces are replaced by Collection-noun plans, `expr.*`, and codec-kernel parameters (`codec.list`, `codec.cursor`); the remaining names stay.                                                                                                                                                                |
| S8  | ADR-0022: “Direct client/App maps retain their accepted exact-key spelling.”                                                                                                                                                                                                 | **Superseded.** The generated client adopts nested kind/domain maps with the same QP-COMPOSE-023/024 collision rules; exact Resource Identity remains wire/artifact/tooling authority.                                                                                                                                                                                                            |
| S9  | ADR-0015: “Creation is lazy and coalesced.”                                                                                                                                                                                                                                  | **Superseded (extended).** Lazy remains the default; `eager: true` readiness Services (compiler-required for credential-resolver dependencies) and non-poisoning lazy failure retry are added; disposal and lifetime clauses unchanged.                                                                                                                                                           |
| S10 | ADR-0019: “A source-controlled `questpie.json` `projections` object selects them; `questpie build` emits them …”                                                                                                                                                             | **Superseded.** Per-Operation `http` and `mcp` members replace the coarse `projections` selection object; emission, explain, and compiler ownership clauses stay.                                                                                                                                                                                                                                 |
| S11 | Deep-DX DECISION-MAP #3: “A Collection must not silently publish new caller input or output when a Field is added.” and FABLE-SYNTHESIS packet item 5.                                                                                                                       | **Corrected (research, not ADR).** Replaced by the derived-versus-pinned model in section 5, including the runtime compatibility story for retained clients, cursors, and Live Query.                                                                                                                                                                                                             |
| S12 | ADR-0008: “Structural Query v1 has exact selection, closed filters, explicit total ordering, forward cursor pagination, **one-hop Relations**, and declared dependencies.”                                                                                                   | **Superseded.** Bounded multi-hop to-one traversal (proposed depth four) replaces the one-hop cap, with `QP-DATA-022` guarding the budget.                                                                                                                                                                                                                                                        |
| S13 | ADR-0008 grammar: “Scalar and scalar-list parameters are non-null; cursor is the only nullable parameter.”                                                                                                                                                                   | **Superseded.** Nullable parameters become optional filters under the formal positive-conjunction rule (section 6) with `QP-DATA-020` guarding position.                                                                                                                                                                                                                                          |
| S14 | Foundational grammar: `field.*` options require `nullable`.                                                                                                                                                                                                                  | **Superseded (authored spelling only).** `nullable` defaults to `false`; equivalent declarations produce byte-identical Schema Projection, following the ADR-0008 revision precedent for authored-TypeScript-only changes.                                                                                                                                                                        |

Additive extensions that are **not** supersessions: to-many loading,
quantifiers, and `count()` (the “projected `toMany`” and aggregates contracts
ADR-0008 explicitly reserved; `relation.toMany({ inverseOf })` authoring is
already implemented and retained by ADR-0019); Job acceptance object envelope
and compiler-derived default identity (generated surface, not ADR-frozen);
named client type aliases; `.observe`/`.key` descriptor members;
`questpie/react`; Service `config`, `eager`, and `runtime.packages`; the
external-schema declaration; the HTTP `Idempotency-Key` convention and
reserved post-commit surfacing (ADR-0023-compatible surface additions); the
pg_search and PostGIS proofs (the “focused decision” ADR-0018 required).

Not touched: ADR-0013 Reaction, ADR-0023 post-commit outcome semantics,
ADR-0026 Job checkpoint language, ADR-0028 Effect Identity/limits/Wire v3,
ADR-0017 multi-instance, ADR-0012 Live Query, ADR-0008 cursor bytes and text
order, and every nondisclosure clause.

## 21. Deletion test and measurable DX scorecard

Named deletions in `fixtures/team-support-desk` (from the DX-EVIDENCE rows,
re-verified against the files):

| Deleted or shrunk                                                                                          | Where                                                                        | Estimate     |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------ |
| Four of six list plans + three Queries + browser dispatch                                                  | `src/tickets/query-plans.ts`, `src/tickets/queries.ts`, `tracer/browser`     | 95-125 lines |
| Output codecs + timestamp repair for every Query                                                           | `src/tickets/queries.ts`, `src/comments/queries.ts`, `src/labels/queries.ts` | 60-90 lines  |
| `Awaited<ReturnType<...>>` aliases                                                                         | `tracer/browser/questpie.ts`                                                 | 15-25 lines  |
| Request-generation guards, loading/error state, refresh fan-out                                            | `tracer/browser/app.tsx`                                                     | 90-130 lines |
| `ticketResult` copier + result codec                                                                       | `src/ticket-mutations.ts`                                                    | 55-70 lines  |
| `query.not(query.always())` fences, immutability equalities, `closedAt` caller grant, predicate repetition | `src/tickets/policy.ts` and siblings                                         | 25-40 lines  |
| Env reads + secret default + validation in the auth runtime and migration config                           | `runtime/better-auth.ts`, `tracer/auth/migration-config.ts`                  | 20-35 lines  |
| Dynamic-import bundler workaround idiom                                                                    | `src/auth/service.ts`                                                        | 8-15 lines   |
| Manual heartbeat, abort check, wall-clock reconstruction                                                   | `src/ticket-sla-follow-up-job.ts`                                            | 25-35 lines  |

The Policy row shrank from the draft's 40-60 estimate: restoring every
candidate invariant (section 4.6) keeps more lines than the first draft
assumed, and that is the correct trade.

Honest zero rows: nondisclosure, snapshot repair, and declaration/runtime
parity delete no application lines; they repair Accepted guarantees.
`ticketSearchByReferencePlan` stays until the Search slice.

Scorecard for the adoption gate (measured, per DELIVERY-FLOW section 4):
net handwritten lines removed in Support Desk and in the representative
Autopilot slices; concepts named per journey (target: the seven of section
2); generated declaration size and TypeScript instantiations within the
accepted budgets; compile and codec parity across direct/network/worker;
diagnostic quality on the invalid examples of sections 4 and 19; migration
effort per slice; remaining compatibility shims with named deletion
conditions; and the AI authoring and navigability audit below.

First AI authoring baseline (audit 01, below): 7 hesitations on a
complete unfamiliar vertical, 0 implementation-source lookups, 0 wrong
primitive choices, 2 confirmed capability gaps, and every remaining
hesitation closed by documentation repair. Later audits against repaired
docs and further verticals must not regress the zero-source-lookup and
zero-wrong-primitive baselines and should reduce hesitations.

### AI authoring and navigability audit

Method: after the four-lane repair, a fresh clean-room Sonnet 5 session
received only [ai-audit/BEGINNER-GUIDE.md](./ai-audit/BEGINNER-GUIDE.md),
[ai-audit/API-REFERENCE.md](./ai-audit/API-REFERENCE.md), and one concrete
feature request (ticket watchers with a per-watcher reminder digest:
watch/unwatch, a caller-scoped paged relation-loading list, watcher-list
authorization, per-watcher deduplicated delayed Jobs from a comment write,
optimistic React, and HTTP+MCP exposure). It authored the feature against
the proposed public surface only and returned a structured seven-entry
confusion log; the complete recorded result is
[ai-audit/AUTHORING-AUDIT.md](./ai-audit/AUTHORING-AUDIT.md).

What went right: correct primitive choice for every requirement
(Collection with all-`server` provenance for the join row, Policy matrix,
plan Query with nested bounded to-many, two Mutations, one Job accepted in
a loop with an explicit per-watcher/comment `idempotencyKey` and
`notBefore`, `useMutation` with an optimistic overlay, `useLiveQuery`,
`http` and `mcp` members), and zero attempts to open implementation or
generated source.

The seven hesitations, evaluated:

| #   | Hesitation                                                                 | Class                                                     | Resolution                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Caller-scoped plan predicate (`parameters.callerMembershipId` placeholder) | missing-docs, plus a real surface gap                     | Documented the handler-Query pattern with plain-value binding; plan-scope execution-fact operands proposed as approval item 24.9                                                |
| 2   | Ordering by a to-one related field                                         | missing-docs (modeling guidance)                          | Documented “page the Collection you order by”; the watched-tickets read pages `tickets` with a `some(watchers)` quantifier; relation-nested `orderBy` explicitly does not exist |
| 3   | Non-primary unique lookup for unwatch                                      | missing-docs, resolved by a kernel refinement             | `key` now accepts any declared unique constraint's complete column set (section 8)                                                                                              |
| 4   | Job `runAs` for a recipient who is not the caller                          | missing-capability (confirmed)                            | Documented caller-only run-as with the recipient-as-data pattern; service-principal recipe named as approval item 24.10; the audit's invented `durable.system` was not adopted  |
| 5   | Checking target-ticket readability without duplicating read Policy         | missing-docs                                              | Documented the kernel-read pattern (`get` returning `null` is the readability check); a recursive `readable()` evidence primitive stays rejected per ADR-0010                   |
| 6   | Unique-constraint conflict mapping                                         | insufficient-diagnostics, resolved by a kernel refinement | Typed `ConstraintViolation` with the declared constraint name and a documented remap idiom (section 8)                                                                          |
| 7   | Bounded `afterWrite` fan-out                                               | insufficient-docs plus a confirmed capability edge        | Explicit `first` required, Mutation budgets bound the work; unbounded durable fan-out named as approval item 24.11                                                              |

One additional gap the audit exposed without logging it: it guessed a
manual `headers: { "Idempotency-Key": "callId" }` spelling for the
Mutation HTTP projection. The binding is now implicit and mandatory
(section 15), so it cannot be authored wrongly or forgotten.

Rule applied throughout: documentation was repaired first wherever the
model was already sound (entries 1, 2, 5 and the guidance halves of 3, 6,
7); the two kernel refinements (unique-constraint `key`,
`ConstraintViolation`) generalize declared compiler facts rather than
inventing new API for one consumer; and the genuine capability gaps
(plan-scope caller facts, service-principal run-as, durable fan-out)
became explicit approval questions instead of silent API growth.

Standing acceptance criterion for every section 22 slice: its golden path
must be authorable from the beginner guide and API reference alone, with
no Runtime, compiler, or generated implementation source open. Audit 01
met that criterion before the documentation repairs; later audits run
against the repaired documents and new verticals, and must hold the
zero-source-lookup and zero-wrong-primitive baselines while reducing
hesitations.

## 22. Tracer-led implementation slices

Every slice ships through the runnable tracer, keeps the walking skeleton
green, and ends with Standards and Spec review of its exact boundary. Kernel
claims use focused falsifiable proofs; Product surface uses tracer-led TDD.
Every slice also carries the section 21 acceptance criterion: its golden
path must be authorable from the beginner documentation and API reference
alone, with no Runtime, compiler, or generated implementation source open.

1. **Query + Relations.** Tracer: `tickets.queue` + `tickets.detail` +
   `tickets.escalations` replacing the four list Queries in Support Desk,
   through browser and Live Query, plus one caller-scoped handler Query
   (the audit's watched-tickets shape); if section 24 approves plan-scope
   execution-fact operands, this slice lands and cursor-scopes them. Kernel claims: one snapshot per Query
   root; Policy-before-filter with quantifiers; cursor scope with nested
   pages; disclosure-authorized quantifier universe under `.watch`
   (dependency observation across hidden related rows). Hostile tests:
   hidden related rows in `some/none/every`; nullable-filter positions
   (including the legal and-inside-or case); nested cursor under plural
   parent; depth and aggregate budgets; cursor forgery across parameters and
   Policy facts; Field added while a nested cursor is outstanding and a
   watch is open; instantiation measurement of this exact vertical against
   the SPEC budget. Also closes the recorded `QP-COMPOSE-013` overload
   follow-up while registering the new `QP-DATA` codes. Parity:
   direct/network/worker/browser. Docs owner: the Query grammar page.
   Artifacts: plan AST v2, dependency plans, named aliases. Deletion:
   `query-plans.ts` plans and the `dataQuery` spelling.
2. **Collection + Mutation.** Tracer: provenance on all six Collections,
   `values` lane in close/reopen/assign/edit, lifecycle
   `normalize`/`validate` on tickets, `check`/`afterWrite` audit on
   comments, `updatedAt` flip to `onUpdate: "now"`, plus the audit-driven
   kernel refinements: declared-unique-constraint `key` lookup, the typed
   `ConstraintViolation` outcome, and the bounded afterWrite fan-out (one
   Job per listed row under explicit `first`). Kernel claims: candidate
   Policy over merged lanes catches a deliberately buggy `values`
   assignment; immutability before Policy; empty-patch rejection retained;
   CAS `expected`; lifecycle purity enforcement; afterWrite narrowed-ctx
   capability negatives; recursion bound. Hostiles: caller smuggling server
   Fields; `values` writing database-owned Fields; `values` forging tenant
   or requester caught by candidate Policy; lifecycle attempting I/O;
   managed-writer `onUpdate`; unique-race conflict mapped to a declared
   error without raw database detail; unbounded afterWrite list rejected.
   Deletion: `defineCollectionOperations`, Field fences, `ticketResult`.
3. **Job DX.** Tracer: SLA Job without ceremony; multi-key acceptance;
   derived-default identity callsite; delayed direct acceptance. Kernel
   claims: automatic heartbeat bounded by the attempt deadline (stuck-but-
   alive handler loses its lease at the deadline); sleepUntil budget
   rejection and mid-sleep crash recovery toward the same absolute instant;
   derived identity at-most-once proof under branches and early throws.
   Hostiles: CPU-starved heartbeat documentation case; loop without key
   diagnosed; replay/conflict matrix. Deletion: heartbeat/clock ceremony
   lines.
4. **Generated client + observer + React + optimistic overlays.** Tracer:
   Support Desk browser rewritten on `questpie/react` with per-row mutation
   state; optimistic close with forced post-commit ambiguity and recovery;
   Policy revocation mid-session. Kernel claims: cache identity binds
   operation/input/context/deployment; invalidation from Change Ledger
   facts; no auto-retry. Hostiles: overlay on reset; uncertain never rolled
   back; revoked data removal. Deletion: app.tsx orchestration and aliases.
5. **Config + Service + Auth + Route mount.** Tracer: Better Auth on typed
   config with the generated `loadAppConfig()` CLI path, compiler-required
   eager, runtime packages, and the external-schema declaration for
   `support_auth_*`; integration-key second credential path; non-Auth
   provider Service used by Route and Action. Kernel claims: secrets absent
   from all artifacts; readiness failure taxonomy; lazy failure retry;
   drain semantics; drift verification reporting declared external tables
   as externally owned. Hostiles: conflicting credentials precedence;
   provider outage vs absent credential; config secret in diagnostics;
   undeclared provider table caught by drift. Deletion: env reads, the
   ambient migration-config read, bundler workaround.
6. **HTTP + OpenAPI + MCP.** Tracer: `tickets.detail` HTTP projection plus a
   Mutation projection with `Idempotency-Key`, the webhook Route in one
   OpenAPI document, and one MCP tool called through a real MCP client
   against Policy. Kernel claims: same executor; outcome fidelity including
   the reserved post-commit surface on HTTP and MCP; collision domains.
   Hostiles: ambiguous mappings; GET encoding budget; HTTP retry without
   the idempotency header; MCP metadata-as-authorization attempt. Owns the
   deferred multi-binding decision.
7. **Package authoring + pg_search stage 1.** Tracer: ticket full-text
   search in Support Desk through an activated Package on the official
   ParadeDB image. Kernel claims: candidate-keys-only; authorized universe
   for totals/facets/cursors; rebuild/cutover; extension readiness;
   primary-only rejoin. Hostiles: stale/forged/foreign-tenant candidates;
   revocation between index and rejoin; revocation committed on primary
   not yet visible on a replica (topology rejection); missing extension.
8. **pg_search stage 2 + PostGIS + seam decision.** Tracer: embedding-
   generation ownership model, then hybrid/RRF retrieval; one geo
   Collection with spatial operators and index through the same Package
   contract; then the seam hypothesis evaluated with both proofs on the
   table.
9. **Representative Autopilot port + measured deletion.** Tracer: the
   sampled Route-to-Operation migration slices; the adoption scorecard of
   section 21 becomes claims instead of estimates.

Each slice names clean commit boundaries (one coherent green boundary per
capability), its generated-artifact changes (goldens, digests, wire), its
adversarial review boundary (the exact commit range), and its deletion
condition (the named files or clauses that must disappear before the slice
closes).

## 23. Adversarial-review findings and repairs

Four independent Sonnet 5 lanes attacked the complete Support Desk vertical
of this packet's first draft: beginner DX/deletion (12 findings), compiler
inference/grammar/diagnostics (15), authority/Policy/transaction/ambiguity
(10), and composition/routing/projections/extensions/portability (15). All
material findings are repaired in the body above; this section records what
changed and how contradictions were reconciled. The lane transcripts are
session evidence; nothing below is merely appended commentary.

Blockers repaired:

1. **Invented `relation.toMany({ target, field })` with a module cycle**
   (lanes 1+2). Replaced with the accepted
   `relation.toMany({ inverseOf: relationRef(...) })` spelling in 4.1;
   `relationRef` added to section 3; ledger clarified (S12 covers the
   one-hop supersession; toMany authoring already exists).
2. **Candidate Policy weaker than the current fixture** (lanes 2+3: dropped
   tenant equality, create status/closedAt/lastSlaFollowUpAt shape,
   requester liveness, team/assignee existence on update, closed-state
   `closedAt` pin, customer-edit field pinning). Section 4.6 fully restores
   every invariant; sections 1, 8, and 21 now state that provenance narrows
   who may submit while candidate Policy verifies what any lane submitted,
   and the deletion estimate was reduced accordingly.
3. **`expr.exists` in Query filters would leak hidden-row existence**
   (lane 3; lane 2 flagged the same ambiguity). Resolved by restricting
   `expr.exists` to Policy programs (`QP-DATA-025`); Query membership uses
   quantifiers only. Sections 1, 4.2, 6, 7 updated. This reconciles lane
   2's alternative (dual branding of one spelling) against lane 3's leak
   proof: the leak wins, so the restriction ships.
4. **HTTP projection had no idempotency identity and no post-commit
   surface** (lane 3). Section 15 now mandates the `Idempotency-Key` to
   `callId` mapping for Mutation projections and reserves an HTTP status/
   body and an MCP outcome bucket for `COMMITTED_RESULT_UNAVAILABLE` with
   its recovery identities.
5. **Better Auth provider schema and the broken CLI config path** (lane 4).
   Section 13 defines the external-schema declaration now and the ADR-0005
   Package obligation later; 4.10 shows the repaired
   `migration-config.ts` on the generated `loadAppConfig()`.
6. **Q63 rule under-specified against its own motivating mount** (lane 4).
   Section 14 now defines per-pattern ownership, disjoint-method owner
   groups, and any-method exclusion below the prefix; the circular
   forward-compatibility framing was dropped and the realistic carve-out
   case answered.
7. **Operator/index registration versus the no-plugin rule** (lane 4).
   Section 16 draws the line explicitly (parameterize fixed core node
   kinds, never callbacks); section 18's seam list is downgraded to a
   falsifiable hypothesis.
8. **Derived-surface evolution ignored in-flight clients** (lane 2).
   Section 5 point 7 now states the retained-client rejection, post-
   expansion template digest and cursor invalidation, and Live Query reset
   behavior, with a slice-1 hostile.

Major repairs: formal optional-filter rule with the legal and-inside-or case
(lane 2); computed-selection restriction to one recognized aggregate call
with an invalid example (lane 2); aggregate-count and GET-encoding budgets
plus the instantiation-budget measurement (lanes 2+4); `check` read bounds
and the structurally narrowed `afterWrite` ctx (lane 3); attempt-deadline
bound on automatic heartbeat and exact `sleepUntil` semantics (lane 3);
compiler-required eager for credential-resolver dependencies (lane 3);
staged pg_search with the embedding-ownership gate, primary-only rejoin, and
the official-image default (lane 4); three collision domains with their own
diagnostic codes instead of one trie and instead of widening
`QP-COMPOSE-013` (lane 4); config six-surface coverage and the shared-value
duplication rule (lane 4); per-row React mutation state and the removed
`callId === ticket.id` comparison (lane 1); typed reusable predicates via
`PolicyScope`/`RowOperand` (lane 1); `parameters` naming unified, `expr`
imports added, selection-spread semantics stated, `select(true)` overload
documented, kernel `select` and nullable-default rules stated, 4.11 merged
into the 4.4 Definition, `assignTicket`/`reopenTicket` added, and the
`query-plans.ts` deletion claim corrected to four of six plans (lane 1).
Ledger repairs: S12 (one-hop supersession), S13 (nullable parameters), S14
(`nullable` optional), S10 rewritten as the real ADR-0019 `projections`
supersession (lanes 2+4). Minor repairs (orderBy spread honesty, depth
number, secret-unwrap wording, `runtime.packages` purpose, section 3
non-exhaustive note, section 2 reuse note, multi-binding deferral, MCP
ingress statement, digest participation) are folded in place.

Findings assessed and not adopted: lane 2's suggestion that immediate-parent
`expr.and` alone suffices for optional filters (rejected: an optional filter
under `expr.not` would narrow results when disabled; the shipped rule adds
positive polarity); lane 1's suggestion to show `reopenTicket` or scope the
claim (both mutations are now shown, so no scoping was needed).

A fifth, clean-room lane followed the repairs: the AI authoring audit of
section 21 (complete record in
[ai-audit/AUTHORING-AUDIT.md](./ai-audit/AUTHORING-AUDIT.md)), whose seven
hesitations drove the documentation repairs, the kernel `key` and
`ConstraintViolation` refinements, the afterWrite fan-out bound, the
implicit `Idempotency-Key` binding, and three new approval questions,
while confirming every primitive choice and both idempotency rules
survived first contact with a model that had never seen the design.

## 24. Remaining human approval decisions

1. **Q63 Route wildcard mode.** Approve exclusive per-pattern subtree
   ownership as specified in section 14, or select fallback/augmentable
   instead.
2. **Supersession ledger.** Approve each S1-S14 entry individually; any
   rejection re-opens the affected section.
3. **Provenance spelling.** Approve the Field-modifier spelling
   (`server`/`immutable`/`onUpdate`, optional `nullable`) or request the
   alternative explicit `write: { create, update }` matrix from the
   redesign candidate.
4. **Expression vocabulary.** Approve `expr` as the shared vocabulary name
   and the Policy-only restriction of `expr.exists`.
5. **Client envelope.** Approve the one-object call envelope and nested
   client maps as the generated client's primary surface.
6. **HTTP idempotency and post-commit surface.** Approve the mandatory
   `Idempotency-Key` mapping and the reserved
   `COMMITTED_RESULT_UNAVAILABLE` HTTP/MCP surfacing.
7. **Provider schema.** Approve the bounded external-schema declaration for
   application-composed providers, with one-lifecycle projection mandatory
   for Packages.
8. **pg_search deployment.** Approve the official ParadeDB image as the
   proof default, with the owned-image fallback only under the named
   version-matrix condition.
9. **Plan-scope execution facts.** Approve (or defer) read-only
   `principal`/`tenant`/`values` operands in plan-backed Query predicates,
   so the common caller-scoped list needs no handler (two independent
   audit requirements hit this; the interim handler pattern is
   documented).
10. **Service-principal run-as.** Acknowledge the confirmed gap: a trusted
    non-caller run-as recipe for Jobs that act for a recipient rather than
    the accepting caller. It stays with the later trigger seam; approving
    this item only names it, it does not add `durable.system` now.
11. **Durable fan-out.** Acknowledge the confirmed gap: fanning one
    committed fact out to an unbounded recipient set needs a durable
    pattern outside the Mutation transaction (today's answer is bounded
    in-transaction fan-out only). Owned by the later Job trigger/breadth
    work.
