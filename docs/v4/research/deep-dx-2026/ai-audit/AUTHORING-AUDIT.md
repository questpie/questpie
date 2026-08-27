# Clean-room AI authoring audit 01: ticket watchers

- Date: 2026-08-27
- Auditor: fresh Sonnet 5 session `b7fe50cd-03ad-4d6d-9a6f-52cf14260f90`,
  run from `/tmp` with low internal effort and access to exactly two
  documents, [BEGINNER-GUIDE.md](./BEGINNER-GUIDE.md) and
  [API-REFERENCE.md](./API-REFERENCE.md), plus the ticket-watchers feature
  request. It saw no design discussion, implementation history, review
  answers, or repository source, and it inspected no implementation or
  generated files.
- Content below is the complete final answer of that session, unchanged
  except for repository-standard whitespace formatting (oxfmt).
- Evaluation and the resulting repairs are recorded in
  [APPROVAL-PACKET-1.md](../APPROVAL-PACKET-1.md) sections 21 and 23.

---

# A. Code outline

## Collection: `watchers` (provenance/relations)

```ts
// src/watchers.ts
import { constraint, defineCollection, field, relation } from "questpie";
import { tickets } from "./tickets";
import { memberships } from "./memberships";

export const watchers = defineCollection({
	name: "watchers",
	fields: {
		id: field.uuid({ default: "randomUuid", server: true, immutable: true }),
		organizationId: field.uuid({ server: true, immutable: true }),
		ticketId: field.uuid({ server: true, immutable: true }),
		membershipId: field.uuid({ server: true, immutable: true }),
		createdAt: field.timestamp({
			default: "now",
			withTimezone: true,
			server: true,
			immutable: true,
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		// one watch row per ticket/member — also used as the unwatch lookup key
		oneWatchPerMember: constraint.unique({
			fields: ["ticketId", "membershipId"],
		}),
	},
	relations: {
		ticket: relation.toOne({
			target: tickets,
			fields: ["ticketId"],
			references: ["id"],
		}),
		membership: relation.toOne({
			target: memberships,
			fields: ["membershipId"],
			references: ["id"],
		}),
	},
});
```

All fields are `server: true` — a watcher row is entirely system-derived (caller supplies only `ticketId` through the Mutation input, never `membershipId`/`organizationId`).

## Policy

```ts
// src/watchers/policy.ts
import { definePolicy, expr, policy } from "questpie";
import { watchers } from "../watchers";
import { memberships } from "../memberships";
import { activeStaff } from "../tickets/policy"; // reused predicate

const activeMember = ({ principal, tenant }) =>
	expr.exists(memberships, ({ row: m }) =>
		expr.and(
			m.organizationId.equal(tenant.id),
			m.principalId.equal(principal.id),
			m.status.equal("active"),
		),
	);

export const watcherPolicy = definePolicy(watchers, {
	name: "watchers.default",
	read: {
		admit: policy.authenticated(),
		// watcher list visible only to staff or the ticket's requester // GUESS
		rows: ({ row: w, principal, tenant }) =>
			expr.and(
				w.organizationId.equal(tenant.id),
				expr.or(
					activeStaff({ principal, tenant }),
					expr.exists(memberships, ({ row: m }) =>
						expr.and(
							m.principalId.equal(principal.id),
							m.status.equal("active"),
							// requester-of-this-ticket check duplicated from tickets policy // GUESS
							expr.exists(watchers, ({ row: w2 }) => w2.id.equal(w.id)),
						),
					),
				),
			),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, tenant, principal }) =>
			expr.and(
				candidate.organizationId.equal(tenant.id),
				activeMember({ principal, tenant }),
				// caller must be able to READ the target ticket — no first-class
				// "readable-by" cross-collection helper is documented, so the
				// ticket read-Policy condition is re-derived here // GUESS
				expr.exists(tickets, ({ row: t }) =>
					expr.and(
						t.id.equal(candidate.ticketId),
						t.organizationId.equal(tenant.id),
					),
				),
			),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			expr.and(
				current.organizationId.equal(tenant.id),
				// a watcher may only remove their own watch row
				expr.exists(memberships, ({ row: m }) =>
					expr.and(
						m.id.equal(current.membershipId),
						m.principalId.equal(principal.id),
					),
				),
			),
	},
});
```

## Query: `tickets.myWatched`

```ts
// src/watchers/queries.ts
import { codec, expr, policy } from "questpie";
import { defineQuery } from "#questpie/app";
import { watchers } from "../watchers";

export const myWatchedTickets = defineQuery({
	name: "tickets.myWatched",
	network: true,
	policy: policy.authenticated(),
	http: {
		method: "GET",
		path: "/api/watched-tickets",
		request: { query: { first: "first", after: "after" } },
		responses: { ok: 200 },
	},
	mcp: {
		tool: "support_watched_tickets",
		description: "List tickets the caller watches, newest activity first.",
		readOnly: true,
	},
	query: watchers.list({
		parameters: {
			first: codec.integer({ minimum: 1, maximum: 100 }),
			after: codec.nullable(codec.cursor()),
		},
		where: ({ row: w, parameters, principal, tenant }) =>
			expr.and(
				w.organizationId.equal(tenant.id),
				// scoped to the caller's own membership — no relation quantifier
				// needed since `principal`/`tenant` come through PolicyScope already,
				// but where callbacks only expose {row, parameters} per docs, so the
				// caller's own membership must be resolved as a parameter instead // GUESS
				w.membershipId.equal(parameters.callerMembershipId),
			),
		// ordering "newest activity first" by the *related ticket's* updatedAt
		// is not shown anywhere as a supported orderBy target (orderBy examples
		// only order by fields of the queried collection itself) // GUESS
		orderBy: { ticket: { updatedAt: "desc" }, id: "desc" },
		select: {
			id: true,
			ticket: {
				select: {
					id: true,
					reference: true,
					status: true,
					summary: true,
					updatedAt: true,
					team: { select: { id: true, name: true } },
					comments: {
						list: {
							where: ({ row: c }) => c.kind.equal("public"),
							orderBy: { createdAt: "desc", id: "desc" },
							first: 3,
							select: { id: true, body: true, createdAt: true },
						},
					},
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

`parameters.callerMembershipId` would have to be threaded in from `ctx.values` some other way since plan `where` only sees `{ row, parameters }` — this is unresolved; see confusion log #1.

## Mutations: watch / unwatch

```ts
// src/watchers/mutations.ts
import { codec, operation, policy } from "questpie";
import { defineMutation } from "#questpie/app";
import { watchers } from "../watchers";

const alreadyWatching = operation.error({
	code: "ALREADY_WATCHING",
	status: 409,
});
const notWatching = operation.error({ code: "NOT_WATCHING", status: 404 });

export const watchTicket = defineMutation({
	name: "ticket.watch",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: { alreadyWatching },
	http: {
		method: "POST",
		path: "/api/tickets/:ticketId/watch",
		request: {
			path: { ticketId: "ticketId" },
			headers: { "Idempotency-Key": "callId" },
		},
		responses: { ok: 200, alreadyWatching: 409 },
	},
	handler: async ({ input, ctx, errors }) => {
		// no documented way to surface a unique-constraint conflict as a typed
		// error — assumed the kernel raises the declared error automatically
		// when a `create` violates a unique constraint // GUESS
		try {
			return await ctx.data.watchers.create({
				values: {
					organizationId: ctx.tenant.id,
					ticketId: input.ticketId,
					membershipId: ctx.values.membershipId,
				},
				select: true,
			});
		} catch {
			throw errors.alreadyWatching();
		}
	},
});

export const unwatchTicket = defineMutation({
	name: "ticket.unwatch",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	policy: policy.authenticated(),
	errors: { notWatching },
	http: {
		method: "POST",
		path: "/api/tickets/:ticketId/unwatch",
		request: {
			path: { ticketId: "ticketId" },
			headers: { "Idempotency-Key": "callId" },
		},
		responses: { ok: 200, notWatching: 404 },
	},
	handler: async ({ input, ctx, errors }) => {
		// `delete` only documents `{ key }` where key is the primary key;
		// looking a row up by a *different* unique constraint
		// (ticketId+membershipId) inside a handler is not shown anywhere // GUESS
		const existing = await ctx.data.watchers.get({
			key: { ticketId: input.ticketId, membershipId: ctx.values.membershipId },
			select: { id: true },
		});
		if (existing === null) throw errors.notWatching();
		await ctx.data.watchers.delete({ key: { id: existing.id } });
		return { ok: true };
	},
});
```

## Job + acceptance from comment creation

```ts
// src/watchers/reminder-job.ts
import { codec, durable } from "questpie";
import { defineJob } from "#questpie/app";

export const watcherReminder = defineJob({
	name: "watcher.reminder",
	input: codec.object({
		ticketId: codec.uuid(),
		commentId: codec.uuid(),
		watcherMembershipId: codec.uuid(),
	}),
	output: codec.object({ notifiedAt: codec.timestamp() }),
	// the job must act on behalf of the watcher (recipient), not the comment
	// author who triggered acceptance; only `durable.caller` is documented,
	// and "caller" here is ambiguous — assumed a system/service identity
	// exists for jobs not run "as" the triggering principal // GUESS
	runAs: durable.system({ whenDenied: "fail" }), // GUESS: durable.system() unverified
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1m",
		backoff: "exponential",
		maximumDelay: "10m",
		jitter: "full",
		horizon: "1d",
	}),
	handler: async ({ input, ctx }) => {
		// send/render reminder for input.watcherMembershipId about input.commentId
		return { notifiedAt: ctx.attempt.now() };
	},
});
```

```ts
// inside comments collection lifecycle, or the postComment Mutation handler
lifecycle: {
  afterWrite: async ({ row: comment, previous, ctx }) => {
    if (previous !== undefined) return; // only on create
    if (comment.kind !== "public") return;
    const page = await ctx.data.watchers.list({
      where: ({ row: w }) => w.ticketId.equal(comment.ticketId),
      orderBy: { id: "asc" },
      select: { id: true, membershipId: true },
      // "bounded reads" — assumed a default/implicit page cap applies since
      // no `first`/`page` is required by this call signature // GUESS
    });
    for (const watcher of page.nodes) {
      if (watcher.membershipId === comment.authorMembershipId) continue;
      await ctx.jobs.watcher.reminder.accept({
        input: { ticketId: comment.ticketId, commentId: comment.id,
          watcherMembershipId: watcher.membershipId },
        // dedup per watcher/comment under retry
        idempotencyKey: `watcher-reminder:${comment.id}:${watcher.membershipId}`,
        notBefore: new Date(ctx.now.getTime() + 30 * 60_000),
      });
    }
  },
},
```

`afterWrite`'s `ctx` is documented to have "no Services and no Actions" and to allow "bounded kernel reads/writes... and Job acceptance," so `ctx.data` and `ctx.jobs` are assumed present here — not explicitly spelled out with an example.

## React: optimistic `WatchToggle` + live list

```tsx
// browser/WatchToggle.tsx
import { useMutation } from "questpie/react";
import { desk } from "./questpie";

function WatchToggle({ ticket, listInput }) {
	const watch = useMutation(desk.mutations.ticket.watch);
	const unwatch = useMutation(desk.mutations.ticket.unwatch);
	const isWatching = ticket.isWatching; // GUESS: field name on ticket detail selection
	const active = isWatching ? unwatch : watch;

	return (
		<button
			disabled={active.status === "pending"}
			onClick={() =>
				active.call({
					input: { ticketId: ticket.id },
					optimistic: [
						{
							query: desk.queries.tickets.myWatched,
							input: listInput,
							apply: (page) =>
								isWatching
									? {
											...page,
											nodes: page.nodes.filter(
												(n) => n.ticket.id !== ticket.id,
											),
										}
									: {
											...page,
											nodes: [{ id: "optimistic", ticket }, ...page.nodes],
										},
						},
					],
				})
			}
		>
			{isWatching ? "Unwatch" : "Watch"}
		</button>
	);
}

function WatchedList() {
	const input = { first: 25, after: null };
	const watched = useLiveQuery(desk.queries.tickets.myWatched, { input });
	if (watched.status === "loading") return <Spinner />;
	if (watched.status !== "ready") return <Retry q={watched} />;
	return (
		<ul>
			{watched.data.nodes.map((w) => (
				<li key={w.id}>
					{w.ticket.summary} — {w.ticket.team.name}
					{w.ticket.comments.nodes.map((c) => (
						<p key={c.id}>{c.body}</p>
					))}
				</li>
			))}
		</ul>
	);
}
```

`ticket.isWatching` has no documented source (no boolean-derived selection member shown besides `count()` aggregates); marked GUESS.

## HTTP / MCP

Already declared inline on `myWatchedTickets` (`GET /api/watched-tickets`, MCP tool `support_watched_tickets`) and on the two Mutations (`POST .../watch`, `.../unwatch`, each carrying `Idempotency-Key`).

---

# B. Confusion log

1. Author `tickets.myWatched` Query — cursor page, newest-activity-first, own watches only
2. Guide §2 "Read data with Queries" / Reference "Read plans" §Expressions
3. `where` plan callbacks only receive `{ row, parameters }`; there is no shown way to scope a list to "rows belonging to the calling principal's membership" without threading membership id in as an explicit parameter — and it's unclear who supplies that parameter value (client can't be trusted to pass their own membershipId)
4. Assumed the framework implicitly injects caller-identity comparisons some other way, or that the parameter must be sourced server-side before invocation; used a placeholder `parameters.callerMembershipId` and flagged it
5. implementation
6. low
7. missing-docs

8. Author `tickets.myWatched` ordering by the related ticket's `updatedAt`
9. Reference "Read plans" §OrderObject
10. Every `orderBy` example orders by a field of the _queried_ collection itself; none shows ordering a list of `watchers` rows by a field on a to-one related row (`ticket.updatedAt`)
11. Assumed `orderBy: { ticket: { updatedAt: "desc" } }` is legal syntax mirroring selection nesting, though nothing confirms `OrderObject` accepts relation nesting
12. implementation
13. low
14. missing-docs

15. Author `unwatchTicket` Mutation — locate the watcher row to delete
16. Reference "Collection kernel (inside handlers)" — `get({ key, select? })` / `delete({ key })`
17. `key` is described only as "the primary key object"; the natural identity for unwatch is the unique pair `(ticketId, membershipId)`, not the surrogate `id`, and no example shows looking up by a non-primary unique constraint
18. Assumed `get`/`delete` accept any unique-constraint column set as `key`, not just the primary key
19. implementation
20. medium
21. missing-docs

22. Author `watcherReminder` Job acceptance triggered from a comment write
23. Guide §5 "Durable work with Jobs" / Reference "Jobs" §runAs
24. Only `durable.caller({ whenDenied })` is documented for `runAs`. The reminder job must run for the _watcher_ (a bystander), not the comment author who is the actual "caller" of the triggering Mutation — there is no shown primitive for "run as this specific principal" or "run as the system"
25. Invented `durable.system({ whenDenied })` as a guess; equally plausible the intended shape is `durable.caller` still applying but the job body just receives `watcherMembershipId` as data and does its own authorization, sidestepping `runAs` semantics entirely
26. implementation
27. low
28. missing-capability

29. Author `watchers` create Policy — admit only if caller can already read the target ticket
30. Guide §3 "Protect data with Policy" — `expr.exists` note, `candidate` docs
31. `expr.exists` is explicitly a _nondisclosing_ check and does not apply the target collection's read Policy; there's no documented way to ask "would `ticketPolicy.read` admit this row for this principal" from inside a different collection's Policy, so ticket-readability logic must be manually re-derived/duplicated inside `watcherPolicy`, risking drift from `ticketPolicy`
32. Assumed duplication is the intended pattern since no cross-Policy reference primitive exists
33. implementation
34. medium
35. missing-capability

36. Author `watchTicket` Mutation — reject a duplicate watch attempt
37. Reference "Queries and Mutations" §errors / "Collections" §constraints
38. No documented behavior for what happens when a Mutation `create` call violates a `constraint.unique`; not shown whether the kernel throws a typed/declared error automatically, a generic framework error, or requires the handler to pre-check with a `get`
39. Assumed a thrown exception can be caught and remapped to the declared `alreadyWatching` error; equally plausible the correct pattern is an explicit `get` before `create` (matching the compare-and-set style used elsewhere)
40. implementation
41. low
42. insufficient-diagnostics

43. Author watcher-notification fan-out inside `comments` `afterWrite`
44. Guide §1 "Lifecycle phases" — `afterWrite` capabilities / Reference "Collection kernel"
45. `afterWrite` is said to allow "bounded kernel reads/writes"; unclear whether `ctx.data.watchers.list(...)` requires an explicit `page`/`first` bound here or has an implicit cap, and whether an unbounded watcher count (e.g. thousands watching one ticket) would trip a documented recursion/size limit (`QP-DATA-024` only covers write-chain recursion, not fan-out list size)
46. Assumed an implicit page bound applies and omitted `first`; a large watcher list may in reality require explicit batching not shown anywhere
47. implementation
48. low
49. insufficient-diagnostics

---

# C. Summary

**Primitives used:** `defineCollection` (fields/constraints/relations, all-`server` provenance), `definePolicy` (read/create/delete with `rows`/`candidate`, reused `expr.exists` predicate), `defineQuery` (list plan with nested to-many selection, `http`+`mcp` projection), `defineMutation` ×2 (`watch`/`unwatch`, `http` with `Idempotency-Key`), `defineJob` + `.accept({ idempotencyKey, notBefore })` inside `afterWrite`, `useMutation` with `optimistic`, `useLiveQuery`.

**Caught wrong assumptions during drafting:** initially reached for `ctx.data.watchers.delete({ where: ... })` before checking the reference table, which only documents `{ key }`; initially wrote `runAs: durable.caller(...)` for the reminder job before noticing the recipient (watcher) is not the Mutation's caller, forcing the `durable.system` guess; initially ordered `myWatched` by `w.createdAt` before re-reading the requirement ("newest activity") and realizing that needs the _ticket's_ `updatedAt`, which orderBy examples never show reaching through a relation.

**Hesitation count:** 7 (one per confusion-log entry above).

**Top 3 doc repairs:**

1. Show at least one example of `get`/`delete`/`update` `key` matching a non-primary unique constraint, or explicitly state that `key` is primary-key-only and provide the intended lookup pattern for other unique constraints.
2. Document `orderBy` scope precisely: confirm whether relation-nested ordering exists, and if not, show the supported pattern for "list rows ordered by an aggregate/related row's field" (a very common feed/inbox shape).
3. Document `runAs` options beyond `durable.caller` — specifically how a Job triggered by one principal (comment author) should execute on behalf of a different principal (each watcher), including whether/how per-recipient authorization is meant to be modeled.
