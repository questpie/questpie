---
title: Build applications with QUESTPIE
description: A developer-first tour of the compiled PostgreSQL application runtime.
status: design-fiction
---

# Build applications with QUESTPIE

QUESTPIE turns TypeScript application definitions into a typed PostgreSQL
backend. You define data, authorization and application operations. QUESTPIE
compiles them into reviewed migrations, a standalone Runtime, an exact server
context, a generated client and one operational view in Studio.

The same application contract runs a direct server call, a network request, a
realtime recomputation and durable work. You do not maintain a second Admin API,
authorization layer or worker data model.

## What you build

This guide builds a collaboration application:

- a Company contains Spaces and Channels;
- a Principal joins a Company and may join private Channels;
- members read and create Messages under relational Policy;
- clients watch a Channel feed;
- a Mutation submits a Message and atomically dispatches follow-up work;
- a durable publishing process waits for approval and calls an external
  delivery provider;
- File metadata, Search results and Studio use the same application Policy.

The domain is only a connected example. QUESTPIE does not require a tenant,
collaboration or CMS model.

## The application in one view

Application code contains direct exported Definitions. A file or folder helps
you organize TypeScript; it does not create framework identity.

```text
src/
  app.ts
  model/collaboration.ts
  features/messages.ts
  features/publishing.ts
  integrations/auth.ts
  integrations/delivery-route.ts
```

A feature normally keeps its Policy and operations together:

```ts
// src/features/messages.ts
import { defineMutation, defineQuery } from "#questpie/app";
import { definePolicy, policy, query } from "questpie";
import {
	channelMemberships,
	companyMemberships,
	messages,
} from "../model/collaboration";

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
});

export const channelFeed = defineQuery({
	name: "messages.channelFeed",
	input: {
		channelId: query.parameter.uuid(),
		first: query.parameter.integer({ minimum: 1, maximum: 100 }),
		after: query.parameter.cursor({ nullable: true }),
	},
	handler: async ({ input, ctx }) => ctx.data.run(channelFeedData, input),
});

export const submitMessage = defineMutation({
	name: "messages.submit",
	input: {
		channelId: query.parameter.uuid(),
		body: query.parameter.text({ maximumLength: 20_000 }),
	},
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.create({
			input: {
				channelId: input.channelId,
				body: input.body,
			},
			select: {
				id: true,
				channelId: true,
				body: true,
				state: true,
				createdAt: true,
			},
		});

		await ctx.dispatch.messageSubmitted({ messageId: message.id });
		return message;
	},
});
```

This page uses the candidate APIs that the later chapters teach and test. The
important shape is stable across the guide:

- one exported Definition owns each Resource identity;
- the Policy is bound to its Collection and builds a closed SQL predicate;
- Query and Mutation keep the handler next to the contract;
- the handler receives one concrete generated `ctx` for the application;
- local input and handler output infer exact generated types where QUESTPIE can
  materialize their runtime wire contract;
- a Mutation owns one PostgreSQL transaction and its durable-dispatch boundary.

You can split the module whenever normal TypeScript organization benefits. The
compiler does not require a separate handler file, service manifest or runtime
registry.

## Where the types come from

QUESTPIE does not make callback members appear from an ambient global registry.
Each public callback has a visible type source:

| Code                            | Type source                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Policy `row`                    | the `messages` value passed to `definePolicy`                                   |
| nested Policy `membership`      | the exact Collection passed to `policy.exists`                                  |
| handler `input`                 | the local Query or Mutation input declaration                                   |
| handler `ctx`                   | the generated App Contract for this application, narrowed to the Operation mode |
| `ctx.data.messages`             | the generated Collection projection                                             |
| `ctx.dispatch.messageSubmitted` | the generated durable-handler projection                                        |
| client input and result         | the compiled exposed Operation contract                                         |

Unknown Fields, operations and services fail in the editor and compiler. Public
declarations do not expose an ORM type or recursively infer the whole
application from every leaf Definition.

## What QUESTPIE generates

The Static Application Compiler evaluates supported structural Definitions and
emits deterministic application artifacts:

- a Compiled Manifest with exact Resource identity and ownership;
- an Origin Map that points generated behavior back to source;
- a Schema Projection and reviewed migration plan;
- Policy, Query and operation programs;
- one concrete App Contract for server handlers;
- exact generated client members and exposed errors;
- matched Runtime build metadata.

Runtime startup loads these artifacts. It does not discover plugins, flatten
Modules or merge application objects in import order.

## What happens on a read

1. Auth resolves a credential into a Principal.
2. The application selects a Tenant and the Runtime creates one immutable
   Execution with Authority, deadline, cancellation, locale and trace context.
3. Tenant selection narrows the intended scope. Relational Policy still proves
   current membership; a caller cannot gain access by selecting another ID.
4. A Query opens a bounded read snapshot.
5. Collection reads add compiled Policy predicates to SQL. Unsupported Policy
   never falls back to filtering rows after fetch.
6. The Runtime observes the data, Relation, Policy, tenant, pagination and
   supported service reads that the Query actually performs.
7. The output codec validates the result and the Runtime returns the same
   semantic result to direct and network callers.

A generated client calls the named Query with only its declared input. The
client cannot send arbitrary selection, filter, Policy or Authority objects.

## What happens on a write

1. A Mutation creates one transaction and one operation time.
2. QUESTPIE checks admission, decodes the declared input and checks only the
   caller-supplied Field paths.
3. Update and delete locate the target through Policy, lock it and recheck after
   a wait.
4. The Mutation applies declared server-owned values, validates the complete
   candidate row and checks resulting-state authority.
5. Business rows, Change Ledger entries and durable dispatch intent commit in
   the same transaction.
6. The Runtime validates the selected result and exposes it only after commit.

Missing and Policy-invisible keyed rows do not become an existence oracle.
External effects do not run inside a retryable database transaction. A Mutation
dispatches durable follow-up work, and an Action owns the external call.

## Realtime is an observed Query

A watched Query is the same authorized Query with a subscription lifecycle. The
Runtime records supported reads during each execution and replaces the
dependency set after recomputation. A membership change can therefore remove a
Message even when the Query handler itself did not mention the membership
Collection.

Reactive writes add a durable Change Ledger record inside the business
transaction. A notification only wakes work; reconciliation against PostgreSQL
closes gaps after a lost wake or process restart.

QUESTPIE does not imply that several independent watched Queries change
atomically on the client. The realtime chapter states the exact checkpoint and
convergence guarantee.

## Durable work follows the transaction

A Mutation commits durable intent with business data. Workers advance that
intent with stable identity, leases, attempts, retry, backoff, cancellation and
terminal failure. A process crash after commit but before notification loses
neither the business change nor the follow-up work.

Each Reaction, Job or Workflow attempt receives a fresh Execution. QUESTPIE
does not serialize a mutable request context or silently preserve a user's old
role. Durable causation and run-as semantics are explicit and visible in Studio.

Durable Workflow uses the same Job, timer, signal, lease and history spine. It
does not start a second runtime.

## Routes, Actions and integrations have narrow jobs

- A Query owns read-only application computation.
- A Mutation owns one transaction and atomic durable dispatch.
- An Action owns external effects without an automatic transaction-retry
  guarantee.
- A Route owns raw HTTP needs such as webhooks, streams and file transfer.
- Auth resolves credentials to Principal without defining the compiler ABI.
- File records own metadata, Relations and Policy; blob storage owns bytes.
- Search indexes committed state durably and cannot create a second access
  model.

Most application code uses Query and Mutation. A Route is not the default RPC
mechanism, and an Action is not a place to hide an ordinary transactional
write.

## One Runtime and one operational truth

QUESTPIE runs as a standalone long-lived process and exposes a low-level Fetch
boundary for tests and special embedding. PostgreSQL remains visible and
portable. Provider-specific behavior is tested against concrete managed
PostgreSQL targets instead of hidden behind a generic database engine API.

The Runtime emits append-only events with one Execution Envelope. Studio uses
the same artifacts and events to show compilation, Origins, migrations, Policy,
operations, transactions, Change Ledger progress, subscriptions, dispatch,
worker attempts, errors, logs and traces. Studio does not become a second
backend or a product-specific Operator App framework.

## The guarantee you should expect

QUESTPIE's value is not one isolated ORM or code generator feature. The
guarantee is that the same compiled application meaning survives across:

- TypeScript authoring and generated types;
- PostgreSQL schema and reviewed migrations;
- direct, network, realtime and worker execution;
- Policy and transaction boundaries;
- crash recovery and durable follow-up work;
- generated clients and operational inspection.

The next chapter builds the application from an empty directory and shows every
generated artifact before the server starts.
