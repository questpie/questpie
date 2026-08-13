# Policy and Execution frontier synthesis

- Status: wave-one synthesis; no acceptance authority
- Atlas tickets: #3 and #4
- Inputs: `SPEC.md`, `CONTEXT.md`, ADR-0005/0007/0008, v3 job evidence,
  three independent interface designs, and one exploratory Opus-high review
- Next gate: primary-source evidence, TypeScript feasibility proof, normalized
  artifact design, PostgreSQL lowering proof, then a fresh Opus-medium review

## Outcome first

The smallest coherent direction currently has five parts:

1. A typed Context Resolver preserves the useful v3 boundary job: resolve
   credentials and application selector input, validate or bootstrap a Tenant,
   fail before Policy/handler, and expose one immutable generated `ctx` for the
   Execution.
2. The resolver receives only a bounded read-only bootstrap surface. It does
   not receive raw database access, Queue, arbitrary Services or ambient System
   Authority. Its result may carry small typed convenience values.
3. Current database membership and roles still stay relational Policy
   predicates evaluated inside the Query snapshot or Mutation transaction. A
   resolver check improves early failure and DX; it is not the final row/write
   authority after concurrent state changes.
4. Policy is bound to one exact Collection, so base-row autocomplete has a
   real type source. Relational evidence uses a closed, bounded, statically
   explainable `EXISTS` grammar with exact target typing and no raw SQL.
5. An Operation's exact compiled input and output are its maximum Field surface.
   Policy may conditionally narrow that surface. Policy never rewrites values;
   server assignments belong to the Mutation lifecycle.
6. Policy evidence reads and ordinary data-disclosure reads are different jobs.
   Evidence returns only a boolean and does not recursively invoke the target's
   presentation Policy. Returning target data always enforces target Policy.

This is direction, not a frozen API. The exact relation authoring form, custom
Execution facts, artifact versions and cursor scope remain open until proof.

## End-application API candidate

The normal author should see one Collection-bound Policy, not an untyped helper
whose Fields appear by magic:

```ts
import { definePolicy, policy, query } from "questpie";
import {
	channelMemberships,
	companyMemberships,
	messages,
} from "./collections";

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",

	read: {
		admit: policy.authenticated(),

		rows: ({ row, principal }) =>
			query.and(
				policy.exists(companyMemberships, ({ row: membership }) =>
					query.and(
						membership.companyId.equal(row.companyId),
						membership.principalId.equal(principal.id),
						membership.status.equal("active"),
					),
				),

				query.or(
					row.visibility.equal("company"),
					policy.exists(channelMemberships, ({ row: membership }) =>
						query.and(
							membership.channelId.equal(row.channelId),
							membership.principalId.equal(principal.id),
							membership.status.equal("active"),
						),
					),
				),
			),
	},

	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal }) =>
			policy.exists(channelMemberships, ({ row: membership }) =>
				query.and(
					membership.channelId.equal(candidate.channelId),
					membership.principalId.equal(principal.id),
					membership.canPost.equal(true),
				),
			),
	},

	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal }) =>
			query.or(
				current.authorId.equal(principal.id),
				policy.exists(companyMemberships, ({ row: membership }) =>
					query.and(
						membership.companyId.equal(current.companyId),
						membership.principalId.equal(principal.id),
						membership.role.in(["owner", "admin", "moderator"]),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			query.and(
				candidate.companyId.equal(current.companyId),
				candidate.channelId.equal(current.channelId),
			),
	},

	fields: {
		output: ({ row, principal }) => ({
			moderationNote: row.authorId.equal(principal.id),
		}),
		update: ({ current, principal }) => ({
			moderationNote: current.authorId.equal(principal.id),
		}),
	},
});
```

This syntax is deliberately small:

- the first `messages` argument supplies the exact base Collection type;
- each `policy.exists(otherCollection, callback)` supplies the exact inner row
  type before TypeScript contextually types the callback;
- `query.*` supplies only closed boolean operators and never executes user code
  per database row;
- no callback receives raw SQL, database, Request, service bag or System
  Authority;
- sparse `fields` entries mean "add this conditional restriction", not "repeat
  every Field already selected by the Operation".

The final relation spelling may instead require declared Relation hops. That
choice must preserve the same end-app locality and exact target typing.

## Where autocomplete comes from

The imported `policy` namespace cannot infer a Collection by itself. This form
is invalid and must never appear in public documentation:

```ts
policy.rows(({ fields }) => fields.workspaceId.isNotNull());
```

There is no value in that call that tells TypeScript which `fields` map exists.
The acceptable inference sources are explicit:

| Callback member                    | Exact source                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| base `row`, `current`, `candidate` | the `messages` argument to `definePolicy`                                               |
| nested membership row              | the Collection or Relation target passed before its callback                            |
| `principal`, `tenant`, `authority` | the closed core Execution operand contract                                              |
| Field-authority keys               | a mapped type over the bound Collection's exact Field keys                              |
| extracted reusable predicate       | a helper already bound to a concrete Collection, never a context-free `fields` callback |

The proof must cover four-hop nesting, extracted helpers, inverse Relations,
Package-owned Collections, negative unknown Fields/operators, emitted
declarations, hover snapshots, type instantiations and check time.

## A basic v4 Context Resolver

The first usable layer should retain v3's most useful context experience while
closing its authority holes:

```ts
// src/application/context.ts
import { context, defineContext } from "questpie";
import { companyMemberships } from "../model/collaboration";

export const appContext = defineContext({
	name: "application",
	input: {
		companyId: context.uuid(),
	},

	resolve: async ({ input, principal, bootstrap }) => {
		const membership = await bootstrap.get(companyMemberships, {
			key: {
				companyId: input.companyId,
				principalId: principal.id,
			},
			select: {
				id: true,
				role: true,
			},
		});

		if (!membership) return context.forbidden();

		return {
			tenant: { id: input.companyId },
			values: {
				membershipId: membership.id,
				role: membership.role,
			},
		};
	},
});
```

This is candidate syntax. It demonstrates the required jobs and type sources:

- `input` is a closed selector contract populated by Fetch, direct-call, test,
  realtime-reconnect or worker entry code. It declares no HTTP header, path or
  other transport binding;
- `principal` is resolved by Auth before application context;
- `bootstrap.get(companyMemberships, ...)` gets its exact row type from the
  imported Collection value and records that one read-only bootstrap dependency;
  it is not an ambient all-Collection or arbitrary query bag;
- selected Fields infer the `membership` result;
- the resolver's supported closed return shape supplies exact immutable
  `ctx.tenant` and `ctx.values` types;
- missing membership fails Execution construction before ordinary Policy or a
  handler runs.

The exact bootstrap declaration, runtime output-codec rule and direct/Fetch
Context-input protocol remain proof items. The compiler may require an explicit output
pin when it cannot materialize a safe wire/runtime contract from the inferred
return.

The Context Resolver runs once per root Execution and concurrent consumers
share its result. Nested synchronous work inherits it. Execution-owned Services
are memoized and disposed separately; functions and Service instances do not
become immutable context values.

This resolver may validate current membership for early denial and provide a
role for display or branching. A Mutation that changes protected state still
uses relational Policy inside its transaction, and a Live Query recomputation
refreshes the relevant authorization state. The resolver result is not a
long-lived grant cache.

## What Principal, Tenant, Authority and Context mean

These words answer different questions:

- **Principal:** who authenticated, including anonymous identity facts. Auth
  creates this at a trusted boundary.
- **Tenant:** the application isolation scope selected and validated during
  Context Resolution. This early validation does not replace current
  transaction/snapshot-bound relational Policy.
- **Authority:** which trusted class of action the Runtime permits the Execution
  to request. Ordinary input cannot construct System Authority.
- **resolved application value:** a bounded immutable value derived once for
  the Execution, such as membership identity, role, verified client class or a
  signed region claim. It is convenient context, not an unbounded grant set or
  a substitute for current relational Policy.
- **generated `ctx`:** the concrete application runtime interface handlers use.
  It carries the immutable Execution facts plus exact generated Data, Services
  and Operations. Authors do not enumerate those services per call site.

The public handler spelling is still open. KISS favors direct
`ctx.principal`/`ctx.tenant`/`ctx.authority`; `Execution` remains the lifecycle
term even if the values are not nested under a verbose `ctx.execution` object.

## Why membership does not become only a context boolean

This resolver is insufficient when used as the only authorization check:

```ts
// Rejected direction: authorization cached before its owning snapshot.
resolve: async ({ principal, selectedCompany, data }) => ({
	isMember: await data.memberships.exists({
		companyId: selectedCompany,
		principalId: principal.id,
	}),
});
```

On its own it makes revocation timing, Query snapshots, Mutation lock/recheck,
Live Query dependencies and Job attempts ambiguous. An unbounded `channelIds`
value additionally violates bounded list semantics and turns cursor stability
into cache invalidation.

The default rule is therefore:

> Bounded identity, selector and bootstrap values may enter Execution for DX
> and early failure; current database authority remains a relational Policy
> predicate at the owning snapshot/transaction boundary.

The resolver therefore needs explicit rules for snapshot timing, Policy
bootstrap, dependency observation, recomputation and failure. It cannot become
an arbitrary v3-style mutable context callback or System CRUD escape hatch.

## Current row and candidate row

The earlier word `proposed` was opaque. Use these semantic terms in examples:

- `current`: the stored row selected under Policy and locked where required;
- `candidate`: the complete resulting row after caller input, accepted schema
  defaults and explicit server-owned assignments, but before persistence.

For create there is no `current`. For update both exist. `candidate` matters
only when authority depends on resulting state—for example preventing a Message
from being moved to a Channel the Principal cannot reach. A normal tenant-owned
Mutation can instead overwrite `companyId` from trusted Execution data and omit
an unnecessary candidate rule.

Policy only decides whether the state is allowed. It cannot return a rewritten
value, set a timestamp or fill ownership. Those are separate Mutation-owned
value/lifecycle operations.

## Field authority without duplicate allow lists

Fail-closed does not require repeating every safe Field in every Policy:

1. a Collection alone exposes no network capability;
2. each Query/Mutation or compiler-expanded Collection Operation declares an
   exact maximum input and output surface;
3. only that declared surface can appear in generated client types;
4. Policy may conditionally narrow selected output or caller-supplied input;
5. adding a Collection Field changes neither input nor output;
6. no Policy attachment, ambiguous attachment or unsupported lowering fails
   closed.

For output, a denied conditional Field is omitted, never replaced with `null`;
`null` remains ordinary data. Its generated result member is optional or an
exact union. For input, a conditional rule checks only paths the caller
actually supplied; an untouched restricted Field does not make an update fail.
Server-owned Fields are absent from public input, not merely denied at runtime.

This makes the common path default-allow _inside an already explicit Operation
surface_ while the application remains default-deny about capabilities and new
Fields. It balances DX and security without two independent allow lists.

## Relational Policy requirements

A realistic Policy must express, in one closed AST:

- `and`, `or`, `not` and explicit SQL-null behavior;
- same-codec Field/literal and correlated Field/Field comparisons;
- bounded `exists`/`notExists` over exact Collections or declared Relations;
- composite correlations and nested paths deep enough for
  Message -> Channel -> Space -> Membership;
- current and candidate predicates;
- row-dependent Field restrictions;
- exact dependencies and a complete SQL-pushdown proof.

Unsupported nodes, excessive depth/width, invalid correlations and cycles are
compile errors. There is no post-fetch authorization fallback and no N+1
Policy callback execution.

The accepted structural Query v1 deliberately permits only one Relation hop.
The collaboration fixture is concrete evidence that Policy needs more. Three
implementation shapes remain under investigation:

1. amend the shared accepted relation predicate grammar with bounded recursion;
2. add a Policy-specific authoring grammar that normalizes into a shared
   internal relational predicate core;
3. require explicitly typed Collection correlations inside Policy while
   structural Query remains unchanged.

Nothing may silently reinterpret ADR-0008 bytes. Any shared grammar amendment
needs an explicit superseding decision, new versions, goldens and budgets.

## Evidence reads versus disclosure reads

`policy.exists(memberships, ...)` asks whether authorization evidence exists.
It returns no Membership data. Automatically invoking `memberships` read Policy
would cause ordinary membership rules to recurse or make authorization depend
on whether users may list ACL rows.

The current leading distinction is:

- **Policy evidence read:** part of the owning Policy predicate; returns only a
  boolean; does not recursively apply the target presentation Policy; records
  exact Collection/Relation/Field dependencies and remains explainable.
- **data disclosure read:** a Query, Relation selection, Search rehydration or
  returned row; always applies the target's row and Field Policy.

Caller-supplied relation filters, if a later public API permits them, are data
reads and must not become target-existence oracles. Policy evidence is authored
trusted application structure, not caller input.

Package ownership and whether cross-owner evidence requires an explicit
accepted reference remain open composition questions. Evidence reads never
grant mutation or arbitrary data access.

## Execution lifecycle across the whole product

- Fetch and direct entry create the same typed immutable Execution; neither
  defaults to System Authority.
- Nested Operations inherit the Execution and cannot replace Principal,
  Tenant, Authority or resolved facts.
- Query evaluates relational Policy inside its owned read snapshot.
- Mutation evaluates current/candidate Policy, locks and rechecks inside its
  owned transaction.
- Live Query recomputation creates a fresh Execution and evaluates current
  membership again; Policy evidence dependencies participate in invalidation.
- Reaction, Job and Workflow attempts create fresh workload Executions. Durable
  state carries explicit identity/tenant/causation/run-as semantics, never a
  serialized mutable `ctx` or stale role boolean.
- Route may read raw protocol input, but that Request does not leak into global
  Policy operands.
- Action uses the same admission and Data Policy boundaries but owns external
  effects, not an automatic database transaction.
- Search returns candidates only; disclosure uses the same Policy or a proven
  equivalent compiled projection followed by safe recheck.
- Studio uses ordinary authorized Operations or explicit trusted Authority; it
  has no hidden Admin bypass.

The exact propagation syntax belongs to later atlas tickets. These are
ownership constraints that beta shortcuts must preserve.

## RLS position

RLS is not the v4 replacement for v3 `access`. Policy is the one product model.
A later PostgreSQL proof may derive a sound subset of compiled Policy into RLS,
roles or grants as defense in depth. It must preserve direct/Fetch/worker
semantics, connection-pool reset safety, candidate and Field rules, explain
output and migrations. Unsupported Policy cannot silently disappear at the
database boundary.

Until that proof passes, QUESTPIE must say "Policy is pushed into framework SQL"
rather than claim database-enforced authorization.

## Hostile proof matrix

| Scenario                                                 | Required result                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| caller selects a foreign Tenant                          | Tenant selection alone grants nothing; membership predicate denies    |
| company-, space- and private-channel membership          | one bounded correlated predicate, exact SQL and dependencies          |
| membership revoked during watched Query                  | wake/reconciliation recomputes under a fresh Execution and Policy     |
| membership changes while Mutation waits on a lock        | target scope and authority rechecked in the same transaction          |
| Principal belongs to more than 1,000 Channels            | succeeds through relational `EXISTS`, never a scalar-list fact        |
| missing versus invisible keyed row                       | one nondisclosing result                                              |
| nonexistent versus invisible referenced Channel          | one collapsed reference outcome                                       |
| update moves Message to an unauthorized Channel          | candidate denial after current-row authority; no write                |
| output Field denied for one row                          | property omitted in the same bounded statement, never null-masked/N+1 |
| direct/Fetch/Studio/worker call                          | same Policy engine and no ambient System bypass                       |
| Policy evidence reads Membership                         | boolean only; dependency recorded; no recursive disclosure Policy     |
| Query returns Membership                                 | Membership row and Field Policy apply                                 |
| unsupported expression or excessive depth                | compile error with Origin and bound                                   |
| cursor replayed under another Principal/Tenant/used fact | scope mismatch before data disclosure                                 |
| Package Policy conflict                                  | zero/ambiguous widening attachments fail closed                       |

## Open decisions before proof

1. Exact Collection/Relation-bound `exists` authoring and contextual typing.
2. Shared relation grammar amendment versus Policy-specific authoring grammar.
3. Numeric predicate depth, node, SQL and planner budgets.
4. Exact bounded Context Resolver input/bootstrap surface, output-codec rule and
   refresh semantics beyond core Principal/Tenant/Authority/locale/trace.
5. Exact trusted construction and propagation of Tenant and System Authority.
6. Candidate predicate and conditional-output SQL lowering.
7. Cursor scope version and which actually used Policy operands enter it.
8. Package-owned Collection Policy attachment and narrowing rules.
9. Cross-owner evidence reference authority.
10. Exact errors and precedence for admission, decode, Field authority, missing,
    reference visibility, current-row scope and candidate denial.
11. `questpie explain policy` artifact shape, including pushdown completeness,
    evidence dependencies and any derived database enforcement.

No ADR, canonical glossary, public docs or implementation gate should move
until these decisions are reduced to one focused contract and executable proof.
