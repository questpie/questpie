---
title: Authorize data with Policy
description: Resolve execution identity and enforce one typed relational authorization model everywhere.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - closed transport-neutral Context input and bounded read-only bootstrap
  - generated protocol, direct, realtime, and durable Context input
  - direct root Execution with explicit Principal and ordinary Authority
  - immutable generated ctx values and nested propagation
  - Collection-bound Policy contextual typing
  - relational Policy evidence and SQL pushdown
  - current and candidate write authorization
  - conditional Field input and output authority
  - direct, Fetch, nested, realtime, worker, Search, and Studio parity
  - nondisclosure, explicit System Authority, and derived RLS boundaries
---

# Authorize data with Policy

Policy is QUESTPIE's application authorization model. You bind one Policy to a
Collection and describe who may invoke each operation, which rows they may
reach, and which selected or supplied Fields they may see or change. QUESTPIE
applies the same compiled decision to generated Collection operations, named
Queries and Mutations, direct server calls, Fetch requests, watched Queries and
durable worker attempts.

## Resolve one typed application context

V3's request context solved an important developer job: resolve identity and
application scope once, then make them available to Policy, handlers, nested
data work and execution-scoped Services without threading parameters through
every function. V4 keeps that convenience with a closed Context Definition.

```ts
// src/app-context.ts
import { context, defineContext } from "questpie";
import { companyMemberships } from "./model/collaboration";

export const appContext = defineContext({
	name: "app.context",

	input: {
		companyId: context.uuid(),
	},

	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") {
			throw context.error.unauthenticated();
		}

		const membership = await bootstrap.get(companyMemberships, {
			key: {
				companyId: input.companyId,
				principalId: principal.id,
			},
			select: {
				id: true,
				companyId: true,
				status: true,
			},
		});

		if (membership === null || membership.status !== "active") {
			throw context.error.notFound("tenant");
		}

		return {
			tenant: context.tenant({ id: membership.companyId }),
			values: {
				selectedMembershipId: membership.id,
			},
		};
	},
});
```

The Context Definition declares application meaning, not HTTP encoding.
`input.companyId` is the one transport-neutral value needed to construct an
Execution. QUESTPIE's generated protocol decides how to carry it over Fetch,
realtime reconnect and other framework transports. The resolver never reads a
raw Request, header or URL.

The generated browser client exposes that same exact Context input:

```ts
// web/messages.ts
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({
	companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
});

const page = await company.queries["messages.page"]({
	channelId: "018f6094-cf3c-70e9-8d68-80d523f14c19",
	first: 20,
	after: null,
});
```

`withContext` returns an immutable scoped client; it does not mutate a shared
client. `companyId` autocompletes from `appContext.input`; an unknown key or
non-UUID value fails before a request is sent. The generated transport encodes
the exact Context input in its versioned protocol. Credentials resolve the
Principal on the server, and the Runtime creates ordinary Authority.

Keeping scoping immutable matters in SSR, tests and multi-company interfaces:
two concurrent calls can use two scoped clients without changing global state.
An application with no Context input uses the base client directly.

A direct root call supplies the same selector plus an explicit Principal:

```ts
// scripts/read-messages-as-user.ts
import { principal } from "questpie";
import { createApp } from "#questpie/app";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

const page = await app.execution(
	{
		principal: principal.user({
			id: "018f5f80-38f2-75de-a648-e8d3cae0e7ce",
		}),
		context: {
			companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
		},
	},
	({ queries }) =>
		queries.messages.page({
			channelId: "018f6094-cf3c-70e9-8d68-80d523f14c19",
			first: 20,
			after: null,
		}),
);

console.log(page.nodes);
await app.close();
```

`app.execution` owns one root Execution and disposes its execution-scoped
Services after the callback. Its `context` member has the same generated type
as the client option. The callback receives the exact generated server
operations. This ordinary entry point has no `authority` option: leaving one
out never means System, and a caller cannot pass a System value through this
API.

The Context input is untrusted until the resolver validates it. A generated
client and a direct server caller supply the same typed `{ companyId }` value.
Both go through the same Context Definition, so moving an operation between
Fetch and direct execution cannot change which facts the resolver sees.

## Supply Context without a browser client

Only a root Execution supplies Context input. Nested work inherits the resolved
Context and cannot replace it.

| Entry                                                         | Where Context input comes from                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| generated browser/server client                               | an immutable `client.withContext({ companyId })` scope encoded by the generated protocol                                                         |
| direct server call or test                                    | the `context` member passed to `app.execution(...)`                                                                                              |
| ordinary framework Fetch request without the generated client | the versioned QUESTPIE wire envelope; callers should generate or validate it from the App Contract                                               |
| custom Route                                                  | its later Route ingress contract maps protocol-specific input into a root Execution; raw Request data never becomes a Policy operand by accident |
| nested Query/Mutation/Collection call                         | inherited automatically from the parent Execution                                                                                                |
| watched Query reconnect                                       | the subscription protocol carries the typed Context input and creates a fresh resolved Execution according to the realtime contract              |
| Reaction, Job or Workflow attempt                             | durable intent declares its Context/run-as strategy; the worker creates a fresh Execution and never deserializes a mutable `ctx`                 |
| CLI or Studio                                                 | their generated application entry supplies explicit typed Context and ordinary or explicitly trusted Authority                                   |

QUESTPIE may encode Context in an HTTP header, request body or connection
frame internally. That wire choice is versioned protocol machinery and is not
repeated in every `defineContext`. If an application truly needs a domain
header, host name or path segment, the custom Route or ingress adapter owns that
mapping separately from Context Resolution.

Auth has already resolved `principal` at this boundary. `bootstrap` is a
bounded read-only lookup surface for the Context Definition. Passing
`companyMemberships` to `bootstrap.get` supplies the exact composite key,
selection and result type. The resolver cannot enumerate all Collections, run
raw SQL, write data, dispatch work, use application Services or obtain System
Authority.

Resolution runs once for one root Execution. A failure stops the Execution
before Policy or an operation handler runs. A successful result creates exact
immutable members:

```ts
ctx.tenant.id; // string, selected from context.tenant(...)
ctx.values.selectedMembershipId; // string, inferred from resolve
```

Nested operations inherit the same resolved values. Execution-scoped Services
are created lazily, reused within that Execution and disposed with it; Service
instances are not Context values. A new Fetch request, direct root call,
realtime reconnect or physical durable attempt creates a new root Execution
and resolves its own context.

The early membership lookup improves errors and avoids running application
work for a plainly invalid selection. It does not turn
`selectedMembershipId` into a durable authorization grant. Membership status,
role, bans and resource ownership are mutable relational facts. Policy reads
and rechecks them in the Query snapshot or Mutation transaction, including
after a lock wait. Realtime Policy dependencies also make later membership
revocation affect watched results.

The Context Definition keeps the useful v3 job while removing five unsafe v3
mechanics: a Request-only flat value bag, total database/Collection/Queue/
Service access under system mode, “no Request means system,” ambient partial
authority overrides, and loss of Principal/Tenant identity at durable entry.

## Bind Policy to the Collection

With the Execution facts resolved, bind one Policy to the protected
Collection. This is the complete application-facing shape:

```ts
// src/features/messages.ts
import { definePolicy, policy, query } from "questpie";
import {
	channelMemberships,
	channels,
	companyMemberships,
	messages,
	spaces,
} from "../model/collaboration";

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",

	read: {
		admit: policy.authenticated(),
		rows: ({ row: message, principal, tenant }) =>
			policy.exists(channels, ({ row: channel }) =>
				query.and(
					channel.id.equal(message.channelId),
					policy.exists(spaces, ({ row: space }) =>
						query.and(
							space.id.equal(channel.spaceId),
							space.companyId.equal(tenant.id),
							policy.exists(companyMemberships, ({ row: membership }) =>
								query.and(
									membership.companyId.equal(space.companyId),
									membership.principalId.equal(principal.id),
									membership.status.equal("active"),
								),
							),
						),
					),
					query.or(
						channel.visibility.equal("company"),
						policy.exists(channelMemberships, ({ row: membership }) =>
							query.and(
								membership.channelId.equal(channel.id),
								membership.principalId.equal(principal.id),
								membership.status.equal("active"),
							),
						),
					),
				),
			),
	},

	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, principal, tenant }) =>
			policy.exists(channels, ({ row: channel }) =>
				query.and(
					channel.id.equal(candidate.channelId),
					policy.exists(spaces, ({ row: space }) =>
						query.and(
							space.id.equal(channel.spaceId),
							space.companyId.equal(candidate.companyId),
							space.companyId.equal(tenant.id),
							policy.exists(companyMemberships, ({ row: membership }) =>
								query.and(
									membership.companyId.equal(space.companyId),
									membership.principalId.equal(principal.id),
									membership.status.equal("active"),
								),
							),
						),
					),
					query.or(
						channel.visibility.equal("company"),
						policy.exists(channelMemberships, ({ row: membership }) =>
							query.and(
								membership.channelId.equal(channel.id),
								membership.principalId.equal(principal.id),
								membership.status.equal("active"),
								membership.canPost.equal(true),
							),
						),
					),
				),
			),
	},

	update: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.companyId.equal(tenant.id),
				query.or(
					current.authorId.equal(principal.id),
					policy.exists(companyMemberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(current.companyId),
							membership.principalId.equal(principal.id),
							membership.status.equal("active"),
							membership.role.in(["owner", "admin", "moderator"]),
						),
					),
				),
			),
		candidate: ({ current, candidate }) =>
			query.and(
				candidate.companyId.equal(current.companyId),
				candidate.channelId.equal(current.channelId),
				candidate.authorId.equal(current.authorId),
			),
	},

	delete: {
		admit: policy.authenticated(),
		rows: ({ current, principal, tenant }) =>
			query.and(
				current.companyId.equal(tenant.id),
				query.or(
					current.authorId.equal(principal.id),
					policy.exists(companyMemberships, ({ row: membership }) =>
						query.and(
							membership.companyId.equal(current.companyId),
							membership.principalId.equal(principal.id),
							membership.status.equal("active"),
							membership.role.in(["owner", "admin"]),
						),
					),
				),
			),
	},

	fields: {
		output: ({ row, principal }) => ({
			moderationNote: row.authorId.equal(principal.id),
		}),
		create: ({ authority }) => ({
			moderationNote: authority.isSystem(),
		}),
		update: ({ current, principal, authority }) => ({
			body: current.authorId.equal(principal.id),
			moderationNote: authority.isSystem(),
		}),
	},
});
```

This one Definition covers the jobs that v3 `access` handled well: operation
admission, row scope, create and update state, Field input, and Field output.
It also closes the gaps that made v3 behavior depend on the transport or on
which in-memory evaluator happened to run.

The callbacks build a closed Policy expression. They do not run once per row
and cannot call the database, raw SQL, the network or an arbitrary service.
QUESTPIE compiles the expression into the data plan and fails the build when it
cannot preserve its meaning.

## Principal, Tenant and Authority

Every operation runs inside one immutable Execution. Three facts answer three
different questions:

| Fact      | Question it answers                                     | Example                                                      |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Principal | Who is acting?                                          | an anonymous visitor, user, OAuth client or service identity |
| Tenant    | Which application scope did this execution select?      | company `cmp_northwind`                                      |
| Authority | Which trusted class of work may this execution request? | ordinary user or explicit System work                        |

Auth resolves credentials into a Principal. Your application selects and
validates a Tenant at its ingress boundary. The Runtime constructs Authority;
ordinary request input cannot construct or upgrade it.

Selecting a Tenant is convenient scoping, not authorization proof. A caller
may send another company's ID. The Policy must still prove current membership
from relational data in the Query snapshot or Mutation transaction.

These facts are available without manual parameter plumbing. A Policy callback
receives the structural operands directly:

```ts
// src/features/tasks.ts
import { definePolicy, policy } from "questpie";
import { tasks } from "../model/work";

export const taskPolicy = definePolicy(tasks, {
	name: "tasks.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.companyId.equal(tenant.id),
	},
});
```

An operation handler receives the same facts on its generated `ctx`:

```ts
// src/features/current-company.ts
import { defineQuery } from "#questpie/app";

export const currentCompany = defineQuery({
	name: "companies.current",
	handler: async ({ ctx }) =>
		ctx.data.companies.get({
			key: { id: ctx.tenant.id },
			select: { id: true, name: true },
		}),
});
```

`ctx.principal`, `ctx.tenant` and `ctx.authority` remain stable for that
Execution. Nested operations inherit them. The Runtime may use async-local
state internally, but omitting a Request or an argument never changes a user
Execution into System Authority.

Mutable facts such as membership, role, ownership and bans do not belong in a
long-lived context boolean. Policy reads them at the consistency boundary that
owns the operation. This keeps the v3 convenience of one shared context without
reusing stale authorization across a transaction wait, realtime recomputation
or worker retry.

## Where callback autocomplete comes from

The imported `policy` value does not know your application schema. Every
callback has a visible value that supplies its exact contextual TypeScript
type:

| Callback value                                   | Exact type source                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Context `input.companyId`                        | the `context.uuid()` declaration in the same Definition                              |
| Context `principal`                              | the closed Principal contract produced by Auth before resolution                     |
| Context `membership` result                      | the `companyMemberships` argument and exact `key`/`select` passed to `bootstrap.get` |
| generated `ctx.tenant` and `ctx.values`          | the checked return value of the one `appContext.resolve` callback                    |
| direct `app.execution` callback `queries`        | the concrete generated App Contract, narrowed to ordinary Authority                  |
| generated-client Context and Query members       | the compiled Context selector and exposed Operation contracts                        |
| `message`, `current`, `candidate` and Field keys | the `messages` argument passed to `definePolicy`                                     |
| `channel`                                        | the `channels` argument passed to that `policy.exists` call                          |
| `space`                                          | the `spaces` argument passed to that `policy.exists` call                            |
| either `membership`                              | the exact membership Collection passed to that `policy.exists` call                  |
| `principal`, `tenant`, `authority`               | QUESTPIE's closed Execution operand contract                                         |
| `ctx` in `currentCompany`                        | the generated App Contract, narrowed to read-only Query mode                         |

For example, `message.channelId` offers UUID operators, while
`message.createdAt` offers timestamp operators. `channel.spaceId` exists in the
channel callback but not in the message callback. An unknown Field, an
incompatible comparison or a string in place of a Collection is a TypeScript
error and a compiler diagnostic.

Do not write a context-free helper such as this:

```ts
// Invalid: nothing supplies the Collection or its Field map.
policy.rows(({ row }) => row.companyId.isNotNull());
```

If you extract a reusable row rule, keep its Collection type source:

```ts
// src/features/message-scope.ts
import { policy } from "questpie";
import { messages } from "../model/collaboration";

export const messageRows = policy.rows(messages, ({ row, tenant }) =>
	row.companyId.equal(tenant.id),
);
```

The extracted predicate remains bound to `messages`; attaching it to another
Collection is a type and compile error.

## Operation admission and row scope

`admit` decides whether the Principal may invoke an operation at all. `rows`
then narrows the rows that operation may observe or target.

```ts
read: {
  admit: policy.authenticated(),
  rows: ({ row, tenant }) => row.companyId.equal(tenant.id),
},
```

The two checks are separate on purpose. An anonymous request can fail before a
query runs. An authenticated member can run a list operation and receive only
rows its predicate permits.

Policy is fail-closed at the Collection boundary. A Collection does not become
a public capability merely because it exists. An exposed operation needs one
unambiguous attached Policy and an explicit rule for the operation it enables.
Within that already-declared operation surface, ordinary selected Fields are
allowed unless a Field rule narrows them. You do not repeat every safe Field in
a second allow list.

Caller filters only narrow the Policy result:

```text
effective rows = compiled Policy rows AND operation rows AND caller filter
```

QUESTPIE applies the effective predicate before pagination, count, Relation
selection and row locking. It never fetches forbidden rows and filters them in
JavaScript. An unsupported expression stops compilation instead of producing a
broader query.

## Relational authorization with `policy.exists`

A real application often cannot authorize a Message from one `companyId`
comparison. The complete example follows the stored hierarchy from Message to
Channel to Space, then proves an active Company membership. A private Channel
also requires its own active membership.

`policy.exists(collection, callback)` is authorization evidence. It has four
important properties:

1. The Collection argument types the nested `row` before the callback body is
   checked.
2. The callback can correlate nested Fields with outer Fields and Execution
   operands.
3. The expression returns only a boolean. It cannot disclose the matching row.
4. The compiler records the target Collection, Fields and correlations as
   Policy dependencies.

An evidence read does not recursively invoke the membership Collection's
presentation Policy. Doing so could make “may read a Message?” depend on “may
list the ACL table?” or create a Policy cycle. The evidence expression is
trusted application structure and reveals only its final boolean.

This rule does not grant handler access to memberships. If a Query returns a
membership row or selects it through a Relation, the membership Collection's
normal row and Field Policy applies.

Every `exists` tree is finite and compiler-bounded. QUESTPIE rejects excessive
depth, unsupported correlations and cycles with the Origin of the offending
Definition. It does not turn nested syntax into an unbounded authorization
graph or an N+1 callback loop.

## Create and update use the resulting row

A read decides over a stored row. A write has more than one relevant state:

- `current` is the stored row selected under Policy and locked when required;
- `candidate` is the complete resulting row after decoded caller input,
  accepted schema defaults and explicit server-owned assignments, but before
  persistence.

Create has only `candidate`. Update has both `current` and `candidate`. Delete
has only `current`.

```ts
update: {
  admit: policy.authenticated(),
  rows: ({ current, principal }) =>
    current.authorId.equal(principal.id),
  candidate: ({ current, candidate }) =>
    query.and(
      candidate.companyId.equal(current.companyId),
      candidate.channelId.equal(current.channelId),
      candidate.authorId.equal(current.authorId),
    ),
},
```

The row rule answers “may this Principal target the stored row?” The candidate
rule answers “is the resulting state allowed?” This prevents a permitted edit
from moving the row into another company, channel or owner.

Policy never rewrites a value. A Mutation owns server assignments such as
`authorId`, `companyId`, `createdAt` or `updatedAt`; Policy checks the resulting
candidate. Automatic `updatedAt` behavior, if enabled by a later Mutation
lifecycle contract, is not a special Policy Field.

When a Mutation waits for a lock, QUESTPIE rechecks the stored target and
mutable relational evidence inside the transaction before writing. A role or
membership read before the transaction is not durable permission to commit.

## Narrow Field input and output

An operation's compiled input and output define its maximum Field surface.
Adding a Field to a Collection exposes nothing by itself. Policy may
conditionally narrow that explicit surface:

```ts
fields: {
  output: ({ row, principal }) => ({
    moderationNote: row.authorId.equal(principal.id),
  }),
  create: ({ authority }) => ({
    moderationNote: authority.isSystem(),
  }),
  update: ({ current, principal, authority }) => ({
    body: current.authorId.equal(principal.id),
    moderationNote: authority.isSystem(),
  }),
},
```

The object is sparse. `body` and `moderationNote` receive additional
conditions; Fields absent from the object keep the operation's declared
surface. The keys come from the bound `messages` Collection, so a misspelled or
foreign Field fails in the editor.

For output, a denied Field is omitted. QUESTPIE never replaces it with `null`,
because `null` remains application data. A conditional output Field therefore
appears as optional in the generated result type:

```ts
type MessageResult = {
	id: string;
	body: string;
	moderationNote?: string | null;
};
```

For create and update input, QUESTPIE checks only canonical Field paths the
caller supplied. A partial update does not require permission for untouched
Fields. Nested paths are represented internally as segment arrays, never
ambiguous dotted strings. A denied supplied path rejects the write; it is not
silently discarded or rewritten.

Server-owned Fields should normally be absent from public input altogether.
A Field rule is useful when the same explicit operation surface legitimately
allows a value for one Principal or Authority but not another.

Field output rules apply to every disclosed result, including create, update
and delete results, nested Relation selections, realtime recomputations and
Studio views. There is no separate response-redaction hook that can drift from
Policy.

## The same decision on every execution surface

Policy belongs to the application meaning, not to HTTP middleware.

| Surface                           | Execution and Policy behavior                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fetch and generated client        | Auth resolves Principal, ingress selects Tenant, then the compiled operation runs under ordinary Authority.              |
| Direct server call                | The caller supplies or inherits an explicit ordinary Execution. No Request does not mean System.                         |
| Nested operation                  | Principal, Tenant and Authority are inherited; the nested Collection and operation Policies still apply.                 |
| Watched Query                     | Every recomputation runs Policy again and observes relational evidence dependencies such as membership.                  |
| Reaction, Job or Workflow attempt | Each attempt starts a fresh Execution from its declared run-as strategy and rechecks current Policy.                     |
| Route or Action                   | Raw protocol or external effects stay outside Policy operands; their application data access still uses Policy.          |
| Search                            | Search yields candidates; disclosure uses the same Policy or a proven equivalent projection with a final safe recheck.   |
| Studio                            | Studio calls ordinary authorized operations or an explicitly trusted maintenance surface; it has no hidden Admin bypass. |

Equivalent Principal, Tenant and Authority values produce the same semantic
decision on each surface. The Runtime may use different transport and worker
machinery, but it cannot substitute a different access model.

For realtime, changes to Messages, Channels, Spaces or either membership
Collection participate in invalidation when the Policy used them. A
recomputation never reuses a historic `allow` decision. For durable work, the
dispatch record carries durable identity and run-as intent, not a serialized
request, database handle, service instance or mutable `ctx`.

## Errors do not become existence oracles

QUESTPIE distinguishes failures when the distinction is safe and collapses
them when it would reveal protected state:

| Situation                                                | Observable result                                  |
| -------------------------------------------------------- | -------------------------------------------------- |
| required Principal is anonymous                          | declared unauthenticated error                     |
| Principal may not invoke an operation                    | declared forbidden error                           |
| list or count contains forbidden rows                    | rows are absent; count covers only visible rows    |
| keyed row is missing or Policy-invisible                 | the same not-found result                          |
| update/delete target becomes invisible after a lock wait | the same not-found result; no write                |
| supplied Field path is denied                            | forbidden input error with the safe canonical path |
| candidate state is denied                                | forbidden result with no persisted change          |
| referenced row is missing or invisible                   | one nondisclosing reference error                  |
| unsupported or unlowerable Policy                        | compile failure with Policy and source Origin      |

Field output denial is not an error; the Field is omitted as declared by its
generated optional result type. Policy compilation and attachment errors never
fall back to allow.

Database unique and foreign-key failures are normalized before they reach an
ordinary caller. A database constraint must not reveal that an inaccessible
row or value exists.

## System Authority is explicit, not ambient

System Authority is a trusted Runtime capability for migrations, repair,
reconciliation and narrowly declared application work. A request body, header,
direct call or worker payload cannot construct it. The Runtime records its use
in the Execution Envelope.

System Authority does not automatically disable every Policy. A rule can test
`authority.isSystem()` when its contract intentionally permits System work, as
the `moderationNote` input rule does above. Maintenance that must operate below
application Policy uses a separate framework-owned surface with a narrower job,
database role and audit trail. It is not exposed as `ctx.asSystem()`.

This distinction prevents a refactor from Fetch to a script, Job or Workflow
from silently widening access. Each durable attempt declares how it runs and
creates a fresh Execution; worker location itself grants no authority.

## Policy and PostgreSQL RLS

Policy is the one authored product model. QUESTPIE pushes its representable row
predicates into every framework-owned SQL statement. That is the normal
authorization boundary and it applies consistently beyond PostgreSQL reads,
including Field output, operation admission, realtime and durable work.

PostgreSQL row-level security is not a second Policy language and is not a
replacement for this Definition. A deployment may use compiler-derived RLS as
defense in depth only for the Policy subset whose behavior is proven
equivalent. The generated projection must preserve:

- existing-row scope as `USING` and candidate checks as `WITH CHECK`;
- relational evidence and transaction consistency;
- transaction-local Principal, Tenant and Authority settings on pooled
  connections;
- a runtime role that cannot bypass RLS through ownership or `BYPASSRLS`;
- fail-closed behavior when execution settings or a supported projection are
  missing.

RLS cannot implement operation admission, Field input/output authority,
response shape, nondisclosing errors, realtime dependencies or worker run-as
semantics. If the build does not emit and verify an RLS projection, QUESTPIE
claims Policy-enforced framework SQL, not database-enforced authorization.
Direct SQL through an unrestricted database role remains outside the Policy
guarantee.

## What QUESTPIE compiles

The compiler lowers each Policy Definition into a deterministic structural
program. The generated artifacts identify:

- the exact target Collection and operation phase;
- admission, current-row, candidate and Field rules;
- every referenced Collection, Relation, Field and Execution operand;
- the complete SQL pushdown plan and its bounds;
- output omission and input-path behavior;
- Origins for diagnostics and Studio explanation;
- any verified derived RLS projection.

No callback function enters canonical bytes. Runtime startup does not inspect
the callback or merge Policy objects. Studio can explain which rule and
evidence branch affected a decision without exposing protected evidence rows.

This compiled form is why the application-facing API can remain close to v3's
simple Collection-local access declaration while giving direct calls, clients,
realtime and durable workers one enforceable meaning.
