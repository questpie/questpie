---
title: Read and change application data
description: Build typed application Queries, transactional Mutations, and low-boilerplate Collection operations.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - structural data plan versus semantic Query vocabulary
  - one Definition with one inline handler and no runtime registry
  - concrete generated read-only and transactional handler contexts
  - locally inferred output with an optional explicit contract pin
  - Collection list, get, create, update, and delete Operation Set
  - closed compile-time Operation Set expansion to ordinary Query and Mutation Resources
  - network true as compiled Fetch and generated-client exposure
  - one engine for direct, Fetch, generated-client, nested, and Studio calls
  - Mutation-owned transaction, operation time, cancellation, and durable dispatch
  - explicit server assignments and updatedAt ownership
  - runtime validation, declared errors, and nondisclosing keyed results
---

# Read and change application data

Use a Query when an application needs a named read result. Use a Mutation when
it needs to change one or more Collections atomically. Both are ordinary
Resources with explicit names, local input contracts, one inline handler, and
exact generated server and client types.

You do not declare which Collections a handler may use in a second capability
map. The generated `ctx` already knows this application. Query mode exposes
Policy-enforced reads; Mutation mode exposes Policy-enforced reads, writes, and
transactional dispatch. It never exposes a raw database connection, SQL
builder, transaction handle, Policy bypass, or `asSystem` shortcut.

This chapter builds three application surfaces:

- one named Query that reads Companies, Company Memberships, Channels, and
  Messages and returns a purpose-built view;
- one five-operation Collection convenience surface for ordinary message CRUD;
- one named Mutation that writes Messages, Channels, and Message Events in one
  transaction, then commits durable dispatch intent with them.

The API in this staging chapter is a candidate contract. Each code block must
later compile verbatim before the chapter can become public documentation.

## Build a view from four Collections

First define the reusable structural data plan for the paged part of the view:

```ts title="src/features/channel-overview.ts"
import { defineQuery } from "#questpie/app";
import { operation, policy } from "questpie";
import { channelMessagePage } from "./message-data";

// The imported plan is shown in full below. Keeping it in the same file would
// have exactly the same framework meaning.
export const channelOverview = defineQuery({
	name: "channels.overview",
	input: operation.input(channelMessagePage),
	policy: policy.authenticated(),
	errors: {
		unavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const company = await ctx.data.companies.get({
			key: { id: ctx.tenant.id },
			select: { id: true, name: true },
		});

		const membership = await ctx.data.companyMemberships.get({
			key: {
				companyId: ctx.tenant.id,
				principalId: ctx.principal.id,
			},
			select: { role: true },
		});

		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, companyId: true, name: true },
		});

		if (
			company === null ||
			membership === null ||
			channel === null ||
			channel.companyId !== company.id
		) {
			throw errors.unavailable();
		}

		const messages = await ctx.data.run(channelMessagePage, input);

		return {
			company,
			membership: { role: membership.role },
			channel: { id: channel.id, name: channel.name },
			messages,
		};
	},
	network: true,
});
```

The structural plan imported above is a complete accepted `dataQuery` value:

```ts title="src/features/message-data.ts"
import type { AppData } from "#questpie/app";
import { dataQuery, query } from "questpie";

export const channelMessagePage = dataQuery<
	AppData["collections"]["messages"]
>()({
	from: "messages",
	parameters: {
		channelId: query.parameter.uuid({ nullable: false }),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	select: ({ fields }) => ({
		id: fields.id,
		authorId: fields.authorId,
		body: fields.body,
		createdAt: fields.createdAt,
	}),
	where: ({ fields, parameters }) =>
		fields.channelId.equal(parameters.channelId),
	orderBy: ({ fields }) => [
		fields.createdAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
```

`operation.input(channelMessagePage)` reuses the plan's exact runtime parameter
contract. It does not expose the plan itself to the client. The client can bind
`channelId`, `first`, and `after`; it cannot replace the selection, predicate,
order, page rule, Policy, or Authority.

All four reads run under one Query-owned read snapshot. Each Collection's
Policy still applies. The membership lookup in the handler is application data
for the returned view; it does not replace the relational Policy evidence that
authorizes Companies, Channels, or Messages.

The handler returns a new application shape instead of exposing four database
rows. QUESTPIE infers that local awaited return type and materializes its closed
runtime output codec. An inaccessible keyed row and a missing keyed row both
produce `null` from `get`, so the single declared `CHANNEL_UNAVAILABLE` error
does not reveal which protected record exists.

## Read `dataQuery` and `defineQuery` as different concepts

The word “query” appears in two public names because the values solve different
jobs. Use this reader vocabulary throughout the guide:

| Code name          | Reader term          | What it owns                                                                                                                        |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `dataQuery(...)`   | structural data plan | exact Collection reads, parameters, selection, filter, total order, cursor page, and derived dependencies                           |
| `defineQuery(...)` | application Query    | Resource identity, Policy entry, read snapshot, handler, errors, output, limits, exposure, observation, and generated client method |

The accepted `dataQuery` name does not change. Calling it a structural data
plan in prose keeps it distinct from the semantic Query Resource without
silently inventing a second API name.

A structural data plan is an unbranded value. It has no independent Resource
identity, network endpoint, Policy entry, or handler. `ctx.data.run` executes it
inside an existing Execution.

An application Query is a named Resource. Its handler may execute one plan,
read several Collections, call read-only Services, or combine those results
with ordinary TypeScript. It owns the result that another server component or
generated client calls.

Do not split the application Query into a contract export and a mandatory
handler export. The compiler internally separates the structural source slice
from executable code, but the developer changes one cohesive Definition:

```ts
export const channelOverview = defineQuery({
	name: "channels.overview",
	input: operation.input(channelMessagePage),
	handler: async ({ input, ctx }) => {
		// Application computation stays next to its public contract.
	},
});
```

A large handler can be an ordinary imported TypeScript function. Its file is
code organization, not a binding convention. There is no handler registry,
paired filename, repeated Resource name, or runtime discovery step. Because a
separately declared function cannot inherit contextual typing retroactively,
give it the generated handler type explicitly:

```ts title="src/features/channel-overview-handler.ts"
import type { QueryHandler } from "#questpie/app";
import { channelOverviewInput } from "./channel-overview-input";
import { channelMessagePage } from "./message-data";

export const channelOverviewHandler = (async ({ input, ctx }) => {
	const messages = await ctx.data.run(channelMessagePage, input);
	return { messages };
}) satisfies QueryHandler<typeof channelOverviewInput>;
```

The Definition still owns and binds that imported function through its
`handler` member. QUESTPIE does not discover the function or pair files.

## Know where every type comes from

The Query example has no illustrative implicit `any` and no ambient
application registry:

| Code                                                  | Exact contextual type source                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `defineQuery`                                         | the application-specialized factory exported by the current generated `#questpie/app` contract             |
| `AppData["collections"]["messages"]`                  | the concrete generated Data Contract                                                                       |
| plan `fields`                                         | that exact generated Message Collection projection                                                         |
| plan `parameters`                                     | the local `parameters` object                                                                              |
| Query `input`                                         | `operation.input(channelMessagePage)`                                                                      |
| Query `errors`                                        | the literal local `errors` map                                                                             |
| Query `ctx`                                           | the concrete generated App Contract, narrowed to Query mode and the Principal admitted by the local Policy |
| `ctx.data.companies` and the other Collection members | the generated application's exact Collection map                                                           |
| each `key`, `select`, and result                      | the target Collection's generated key, Field, and Policy-aware result contract                             |
| handler return                                        | local awaited TypeScript inference checked against the closed wire algebra                                 |
| direct and client call                                | the compiled `channels.overview` Operation contract                                                        |

Unknown Collection names, Fields, inputs, errors, or write methods fail in the
editor. Query `ctx` has no `create`, `update`, `delete`, or dispatch member.
The Operation's `policy.authenticated()` admission runs before the handler;
authentication failure is a framework Policy result, not an application error
that handler code must declare and throw.

The compiler accepts inferred output only when it can materialize one canonical
runtime codec. Exact objects, nullable values, arrays, supported scalar values,
pages, and declared optional redactions are valid. Functions, classes, cycles,
symbols, `Map`, `Set`, broad index signatures, `any`, `unknown`, and unresolved
generics fail at their source Origin instead of being silently serialized.

Pin `output` only when the public contract must remain stable independently of
handler inference:

```ts
export const publishedOverview = defineQuery({
	name: "channels.publishedOverview",
	input: operation.input(channelMessagePage),
	output: publishedOverviewOutput,
	handler: async ({ input, ctx }) => {
		// The inferred return must satisfy the explicit pin.
	},
});
```

An output pin is an assertion plus runtime codec, not a cast. It cannot make an
unsupported JavaScript value transportable.

## Add the common Collection operations once

Most Collections do not need five custom handlers. Define their ordinary
surface in one local Operation Set:

```ts title="src/features/message-operations.ts"
import { defineCollectionOperations, mutation } from "questpie";
import { messages } from "../model/collaboration";
import { messagePolicy } from "./message-policy";
import { channelMessagePage } from "./message-data";

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,

	list: {
		data: channelMessagePage,
	},

	get: {
		select: {
			id: true,
			channelId: true,
			authorId: true,
			body: true,
			createdAt: true,
			updatedAt: true,
		},
	},

	create: {
		input: ["channelId", "body"],
		values: ({ principal, tenant }) => ({
			companyId: mutation.overwrite(tenant.id),
			authorId: mutation.overwrite(principal.id),
		}),
		select: {
			id: true,
			channelId: true,
			authorId: true,
			body: true,
			createdAt: true,
			updatedAt: true,
		},
	},

	update: {
		input: ["body"],
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			body: true,
			updatedAt: true,
		},
	},

	delete: {
		select: { id: true },
	},
});
```

The first argument supplies the exact Collection, Field, key, insert, update,
and result types. The local `policy` value supplies its attached authorization
program. The fixed operation keys supply the lifecycle mode:

| Member   | Compiled Resource          | Input source                         | Transaction owner     |
| -------- | -------------------------- | ------------------------------------ | --------------------- |
| `list`   | Query `messages.list`      | structural data plan parameters      | read snapshot         |
| `get`    | Query `messages.get`       | the named primary key                | read snapshot         |
| `create` | Mutation `messages.create` | listed writable Fields               | one write transaction |
| `update` | Mutation `messages.update` | primary key plus listed patch Fields | one write transaction |
| `delete` | Mutation `messages.delete` | the named primary key                | one write transaction |

The Operation Set is authoring shorthand, not a private CRUD engine. The
compiler lowers it to five ordinary Resources with the same Policy, codec,
error, snapshot or transaction, observation, dispatch, Origin, and explanation
machinery as `defineQuery` and `defineMutation`. Studio uses those Resources;
it does not bypass them with an Admin-only backend.

Discovery sees the one exported Operation Set Definition. The compiler expands
its closed members before it emits the Manifest and generated App Contract.
Runtime sees only the resulting statically bound Resources; it does not expand
the set, inspect the source object, or discover CRUD handlers at startup.

One export is enough because the suffixes and operation kinds are closed. The
explicit `name: "messages"` owns the semantic prefix; file and export names
remain Origin only. If two Definitions establish `messages.update`, the build
fails instead of merging them.

The generated client keeps the familiar low-boilerplate surface:

```ts title="web/messages.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({ companyId });

const page = await company.collections.messages.list({
	channelId,
	first: 20,
	after: null,
});

const message = await company.collections.messages.get({
	key: { id: messageId },
});

const created = await company.collections.messages.create({
	input: { channelId, body: "Ready for review" },
});

const updated = await company.collections.messages.update({
	key: { id: created.id },
	patch: { body: "Approved" },
});

await company.collections.messages.delete({
	key: { id: updated.id },
});
```

The client cannot supply `companyId`, `authorId`, `createdAt`, or `updatedAt`.
Those Fields are outside the declared caller input. `companyId` and `authorId`
are explicit server assignments. The schema defaults initialize the ordinary
`createdAt` and `updatedAt` timestamp Fields on create. The update Value Program
explicitly overwrites `updatedAt` with the Mutation's stable operation time.
There is no hidden timestamp Field and no automatic schema hook.

The `values` callback builds a closed assignment program. It cannot read the
database, call a Service, perform external I/O, obtain the clock, or return an
undeclared target. Its operands come from the Collection-bound operation:

| Assignment value          | Type source                                 |
| ------------------------- | ------------------------------------------- |
| writable target keys      | the bound `messages` Collection             |
| `principal` and `tenant`  | the immutable Execution operand contract    |
| `operationTime`           | the Mutation-owned stable timestamp operand |
| `mutation.overwrite(...)` | the closed server-assignment grammar        |

Policy decides whether a value is allowed; it never supplies or rewrites that
value. This separation makes Studio able to say that the caller supplied
`body`, Context supplied `companyId`, Principal supplied `authorId`, the schema
default initialized timestamps, and the update operation overwrote
`updatedAt`.

Use a named Query or Mutation when the operation needs a custom view, several
Collections, conditional business steps, or application-specific errors. Do
not grow the Operation Set into a generic hooks bag.

## Write several Collections in one Mutation

The following Mutation creates a Message, updates its Channel, records one
Message Event, and adds durable dispatch intent. Every database call joins the
one transaction owned by `messages.submit`.

```ts title="src/features/submit-message.ts"
import { defineMutation } from "#questpie/app";
import { operation, policy } from "questpie";

export const submitMessage = defineMutation({
	name: "messages.submit",
	input: operation.object({
		channelId: operation.uuid(),
		body: operation.text({ minimumLength: 1, maximumLength: 20_000 }),
	}),
	policy: policy.authenticated(),
	errors: {
		channelUnavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		ctx.signal.throwIfAborted();

		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, companyId: true },
		});

		if (channel === null || channel.companyId !== ctx.tenant.id) {
			throw errors.channelUnavailable();
		}

		const message = await ctx.data.messages.create({
			input: {
				channelId: channel.id,
				companyId: ctx.tenant.id,
				authorId: ctx.principal.id,
				body: input.body,
				createdAt: ctx.operationTime,
				updatedAt: ctx.operationTime,
			},
			select: {
				id: true,
				channelId: true,
				authorId: true,
				body: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		const updatedChannel = await ctx.data.channels.update({
			key: { id: channel.id },
			patch: {
				lastMessageAt: ctx.operationTime,
				updatedAt: ctx.operationTime,
			},
			select: { id: true },
		});

		if (updatedChannel === null) {
			throw errors.channelUnavailable();
		}

		await ctx.data.messageEvents.create({
			input: {
				messageId: message.id,
				kind: "submitted",
				occurredAt: ctx.operationTime,
			},
			select: { id: true },
		});

		await ctx.dispatch.messageSubmitted({
			messageId: message.id,
			companyId: ctx.tenant.id,
		});

		return message;
	},
	network: true,
});
```

`ctx.operationTime` is one transaction-stable timestamp value. Reading the
ambient clock several times could produce inconsistent timestamps or different
values after a retry; using the owned operand makes every explicit assignment
inspectable. The Mutation does not infer special behavior from the Field name
`updatedAt`.

`ctx.dispatch.messageSubmitted(...)` writes typed intent in the same
transaction. It does not run the external effect inline. If the transaction
rolls back, the dispatch does not exist. If the process stops after commit, the
intent remains in PostgreSQL for the durable runtime to advance.

The `messageSubmitted` member comes from the concrete generated dispatch map
for this application; its separately owned durable Definition supplies the
exact payload type. An unknown dispatch name or missing `companyId` fails in
the editor. The durable-work chapter must show that Definition in full before
this example can pass its executable proof.

This chapter intentionally does not define Reaction, Job, retry, or external
Action handler syntax. The durable-work chapter owns those contracts. The seam
fixed here is smaller: a Mutation can commit typed durable intent atomically,
and a transaction handler cannot disguise an external call as dispatch.

## Understand the Mutation boundary

A root Mutation owns exactly one PostgreSQL transaction. Its Collection calls
join that transaction; they do not open independent nested transactions:

```text
messages.submit Mutation
  -> messages.create          same transaction
  -> channels.update          same transaction
  -> messageEvents.create     same transaction
  -> messageSubmitted intent  same transaction
  -> validate output
  -> commit once
```

If any call throws before commit, all four writes roll back. Catching an inner
Collection failure does not create a savepoint and does not make a partly
failed write safe. A future explicit savepoint contract may add that behavior;
ordinary nesting does not imply it.

Do not call a named Mutation from another Mutation merely to reuse code. The
owner of nested Mutation identity, errors, retry, dispatch, and savepoints is
not hidden behind an ambient transaction. Extract an ordinary function that
accepts the current generated Mutation `ctx`, or use direct Collection calls,
so the root Mutation remains the visible transaction owner.

A Query can execute several reads and structural data plans under its one
snapshot. It cannot invoke a Mutation. A Mutation can read before it writes,
and every read observes the Mutation's transaction state. An Action or Route
may call an exposed Mutation through the normal Operation boundary, but it does
not inherit or extend that transaction around external work.

## Cancellation and deadlines are part of execution

Every generated handler context contains an `AbortSignal` at `ctx.signal` and
an immutable deadline. Collection reads, writes, locks, and dispatch observe
the signal without extra plumbing. Call `ctx.signal.throwIfAborted()` around
CPU-heavy application work or before starting another expensive step.

Cancellation before commit aborts the database work and leaves no successful
result or dispatch. Cancellation after commit cannot undo PostgreSQL state; the
Runtime reports the committed operation by its transaction and call identity
instead of pretending it rolled back. The operation contract must close the
lost-response and duplicate-delivery behavior before automatic Mutation retry
is enabled.

Handlers do not replace the signal, extend their own deadline, or detach work
with an unobserved promise. Durable follow-up belongs to dispatch. External
effects belong to an Action after commit.

## Validate at every untyped boundary

Generated TypeScript protects a typed caller. Runtime codecs protect the
server from an old client, hand-written request, malformed JSON, or untyped
direct integration.

Validation happens at distinct boundaries:

| Boundary                                  | Contract                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| named Query or Mutation input             | its local `operation.*` codec or reused structural-plan input                              |
| exposed Collection Operation Set `create` | exact declared caller Fields plus each Field/value codec                                   |
| exposed Collection Operation Set `update` | exact key plus supplied patch paths; untouched Fields are not reauthorized as caller input |
| complete candidate row                    | schema defaults, explicit server assignments, full validation, and resulting-state Policy  |
| PostgreSQL write                          | named Constraints remain authoritative under races                                         |
| handler output                            | inferred or explicitly pinned closed output codec                                          |
| declared error payload                    | the local `operation.error` contract                                                       |

The Runtime rejects unknown public Operation input keys and values outside
their bounds before SQL. Public input Field authority checks the canonical
segment-array paths supplied by the caller; it does not silently discard a
denied Field. Values passed to `ctx.data.*` by trusted handler code are server
application assignments, not caller input. They still pass the target
Collection's row and candidate Policy, exact Field codecs, complete-row
validation, and PostgreSQL Constraints. A handler is trusted to express
business logic, not trusted to bypass application authorization or schema.

Database unique, foreign-key, check, serialization, and cancellation failures
cross the public boundary only through a closed framework error or an
explicitly declared application mapping. Unknown thrown values become one
sanitized internal error. The client never receives raw SQL, constraint
details, stack traces, or evidence that a protected row exists.

The generated client knows the declared success and application-error shapes:

```ts title="web/submit-message.ts"
import { createClient, isOperationError } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({ companyId });

try {
	const message = await company.mutations["messages.submit"]({
		channelId,
		body: "Ready for review",
	});

	console.log(message.id, message.updatedAt);
} catch (error) {
	if (isOperationError(error, "CHANNEL_UNAVAILABLE")) {
		// Missing and Policy-invisible Channels intentionally share this result.
	} else {
		throw error;
	}
}
```

The generated error discriminant comes from the literal Definition map. A
misspelled error code or undeclared payload member fails in TypeScript.

## Direct and network calls use one engine

Server code creates an explicit ordinary Execution and calls the generated
Operation map:

```ts title="scripts/submit-message.ts"
import { createApp } from "#questpie/app";
import { principal } from "questpie";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

const message = await app.execution(
	{
		principal: principal.user({ id: principalId }),
		context: { companyId },
	},
	({ mutations }) =>
		mutations["messages.submit"]({
			channelId,
			body: "Ready for review",
		}),
);

console.log(message.id);
await app.close();
```

The browser call shown above enters the same compiled `messages.submit`
Resource after Auth and Context Resolution. Direct execution, Fetch, the
generated client, nested operation entry, realtime recomputation, and Studio do
not each implement validation, Policy, transactions, or errors again.

The common engine performs this sequence:

1. resolve the Resource and its exact compiled contract;
2. create or inherit an immutable Execution;
3. decode input and enforce operation admission;
4. open the Query snapshot or Mutation transaction;
5. execute every generated Collection call through its Policy;
6. validate the closed result or declared error;
7. commit a Mutation before reporting success;
8. encode the same result for direct or network delivery;
9. emit one correlated Execution Envelope for Studio and telemetry.

`network: true` only exposes the Resource through Fetch and the browser-safe
client. It does not select a second handler or weaken the direct contract. A
server-only Operation remains callable through the generated server map and is
absent from the generated client.

## What QUESTPIE compiles

The developer writes one Definition. The compiler produces the internal pieces
needed to preserve it:

- a structural Operation contract with identity, input, output, errors,
  Policy attachment, limits, and exposure;
- an executable slot for the inline handler and its transitive runtime code;
- exact read-only or transactional `ctx` types from the concrete App Contract;
- generated direct and browser-safe client members;
- deterministic runtime codecs and static bindings;
- Origins for the Definition, handler, inferred output, errors, Collection
  calls, and Operation Set members;
- matched Runtime-build identity so a stale handler cannot run against another
  Manifest.

Handler-only imports do not execute while the compiler evaluates structural
Definitions. Runtime startup binds every executable slot statically. It does
not scan folders, pair filenames, merge Modules, or load a registry built by
application code.

`questpie explain query:channels.overview` and
`questpie explain mutation:messages.submit` show the compiled contract, handler
Origin, generated client exposure, referenced Collections, Policy programs,
output codec, transaction mode, dispatch targets, limits, and Runtime-build
digest. Studio presents the same facts rather than reverse-engineering them
from text logs.

## Choose the smallest operation that owns the job

Use the following rule when adding application behavior:

| Need                                                                       | Use                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| a reusable selected, filtered, ordered Collection page                     | structural `dataQuery` data plan                                            |
| ordinary list/get/create/update/delete                                     | one Collection Operation Set                                                |
| a named read across Collections or Services                                | `defineQuery`                                                               |
| one atomic business write across Collections                               | `defineMutation`                                                            |
| durable work after a committed Mutation                                    | typed dispatch; define its later Reaction or Job owner outside this chapter |
| an external call that must not run in an automatically retried transaction | later Action contract                                                       |
| raw HTTP control such as webhook verification, streaming, or file transfer | later Route contract                                                        |

This keeps the common path short without introducing hidden behavior. The
Collection shorthand does not become a separate engine, the handler does not
become a service registry, and the Mutation does not become a generic hooks
container.

The next chapters attach observed Live Query dependencies and durable workers
to these same Query and Mutation boundaries. They can extend execution without
changing who owns reads, transactions, Policy, cancellation, output, or
committed dispatch.
