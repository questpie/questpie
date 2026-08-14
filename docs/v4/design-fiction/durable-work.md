---
title: Run durable work after commit
description: Dispatch typed Reactions and Jobs, recover from crashes, and make retries safe.
status: accepted-seam
implementation-status: unimplemented
accepted-contracts:
  - Mutation-owned typed Transactional Dispatch to Reaction
  - statically bound caller-run-as Reaction with exact codecs
  - stable dispatch, run, attempt, lease, cancellation, and effect identities
  - bounded retry, timeout, cancellation, retention, and executable compatibility
  - Job as a distinct Resource over the accepted durable run engine
  - generated direct Job dispatch and Mutation-wrapped client dispatch
  - durable one-off, delayed, and recurring schedule acceptance
  - bounded retry, backoff, heartbeat, cancellation, and terminal failure
  - Action boundary for external effects and Mutation boundary for application writes
  - persisted result and declared permanent-error receipts
  - Execution Envelope and Studio durable-run inspection
  - Workflow checkpoint seam over named Mutation, Action, timer, and signal steps
proof-blocked-contracts:
  - final Job, schedule, Workflow, and generated-member spelling under ticket #21
  - canonical schedule and Job receipt bytes
  - ten-instance scheduler, status, cancellation, and failover matrix under ticket #19
  - durable payload encryption, redaction, retention, and erasure behavior
  - complete Workflow authorization, child work, compensation, limits, and evolution matrix
---

# Run durable work after commit

Use a Reaction for durable follow-up caused by a committed application change.
Use a Job for an explicit background command that can be dispatched now,
delayed, or placed on a recurring schedule. Both use the same durable run,
attempt, lease, retry, cancellation, and inspection machinery, but they keep
different application meanings.

You do not define an outbox Collection, instantiate a Queue, publish to a
broker, hold a PostgreSQL transaction while a worker runs, or reconstruct the
original request yourself. A Mutation accepts typed dispatch intent in its own
transaction. The Runtime advances that intent after commit and starts every
physical attempt in a fresh Execution.

This chapter builds two complete paths:

- `messages.submit` commits a Message and a `messageSubmitted` Reaction
  together; the Reaction rereads committed state and invokes an idempotent
  delivery Action;
- `companyDigest` is one Job that can be requested through a Mutation,
  dispatched directly by trusted server code, or installed as a recurring
  company schedule.

The Transactional Dispatch and caller-run-as Reaction path is accepted by
ADR-0013 and proof head `3f861861`. ADR-0016 accepts explicit Job dispatch,
durable scheduling semantics, and the shared Workflow checkpoint seam over the
same kernel. Final factory spelling belongs to ticket #21; complete Workflow
breadth remains deferred.

## React to a committed Mutation

The complete application-facing path has one Mutation and one Reaction:

```ts title="src/features/messages.ts"
import { defineMutation, defineReaction } from "#questpie/app";
import { durable, operation, policy } from "questpie";

export const messageSubmitted = defineReaction({
	name: "messageSubmitted",
	input: operation.object({
		messageId: operation.uuid(),
		companyId: operation.uuid(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 8,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "15m",
		jitter: "full",
	}),
	errors: {
		messageUnavailable: operation.error({
			code: "MESSAGE_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, run, attempt, errors }) => {
		ctx.signal.throwIfAborted();

		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: {
				id: true,
				channelId: true,
				authorId: true,
				body: true,
			},
		});

		if (message === null) throw errors.messageUnavailable();

		const delivery = await ctx.actions.delivery.sendMessage(
			{ message },
			{ idempotencyKey: run.effect("deliver-message") },
		);

		await ctx.mutations.messages.recordDelivery({
			messageId: message.id,
			providerMessageId: delivery.providerMessageId,
		});

		await attempt.heartbeat({ completed: "delivery" });

		return {
			kind: "delivered" as const,
			providerMessageId: delivery.providerMessageId,
			attempt: attempt.number,
		};
	},
});

export const submitMessage = defineMutation({
	name: "messages.submit",
	input: operation.object({
		channelId: operation.uuid(),
		body: operation.text({ minimumLength: 1, maximumLength: 20_000 }),
	}),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.create({
			input: {
				companyId: ctx.tenant.id,
				channelId: input.channelId,
				authorId: ctx.principal.id,
				body: input.body,
				createdAt: ctx.operationTime,
				updatedAt: ctx.operationTime,
			},
			select: {
				id: true,
				channelId: true,
				body: true,
				createdAt: true,
			},
		});

		await ctx.dispatch.messageSubmitted({
			messageId: message.id,
			companyId: ctx.tenant.id,
		});

		return { message };
	},
	network: true,
});
```

`ctx.dispatch.messageSubmitted(...)` comes from the separately owned
`messageSubmitted` Reaction Definition. Its argument is exactly that
Definition's decoded input. The accepted Mutation surface returns
`Promise<void>`; durable identity and acceptance receipts remain internal
unless an application exposes them through a separate Operation.

Awaiting dispatch means “this transaction accepted the intent.” It does not
wait for a worker, an email provider, or a broker. Message creation and intent
acceptance commit or roll back together:

```text
messages.submit PostgreSQL transaction
  create Message
  append Change Ledger fact
  accept messageSubmitted intent
  validate Mutation result
  commit all facts or none
                 |
                 v
durable Runtime reconciliation
  claim a short fenced lease
  commit the claim transaction
  create a fresh caller Execution
  run the Reaction outside that transaction
```

If the process stops after commit and before any wake, the intent is still in
PostgreSQL. Reconciliation finds it after restart. If the Mutation rolls back,
there is no Reaction to run. A notification or broker message can reduce
latency, but it is never the durable truth.

The Reaction observes only committed state. It has no Mutation transaction,
write methods, raw database handle, lease mutation API, or ambient System
Authority. Application writes belong in a named Mutation. External effects
belong in a named Action. That split replaces a generic `afterChange` or
fire-and-forget `afterCommit` hook with owners whose failure behavior is
visible.

## Know where every type comes from

No durable callback or generated member depends on an ambient registry:

| Code                               | Exact contextual type source                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `messageSubmitted` handler `input` | the local `operation.object(...)` in that Reaction Definition                                            |
| `runAs: durable.caller(...)`       | the closed caller run-as recipe checked against the application Context contract                         |
| Reaction handler `ctx`             | the concrete generated App Contract, narrowed to Reaction read, nested Mutation, and Action capabilities |
| `ctx.data.messages`                | the generated application's exact Collection map; ordinary Collection Policy still applies               |
| `ctx.actions.delivery.sendMessage` | the nested generated Action capability with that Action's exact input, output, errors, and call options  |
| `run.effect("deliver-message")`    | the Reaction Resource identity, stable `runId`, and local literal effect name                            |
| `attempt.number`                   | the Runtime's physical-attempt contract; it is not part of logical effect identity                       |
| `ctx.dispatch.messageSubmitted`    | the compiled dispatch projection of the `messageSubmitted` Definition                                    |
| Mutation dispatch input            | the Reaction input codec; the accepted Mutation call returns `Promise<void>`                             |
| Reaction result                    | the handler's locally inferred closed output codec, persisted as the terminal result                     |

An unknown durable target, missing payload member, unavailable Collection,
write call on Reaction `ctx`, Action name, or unsupported output value fails in
the editor and compiler. The compiler emits concrete application types; it
does not recursively infer the entire app through the leaf Definition.

The literal passed to `run.effect(...)` is a stable Definition-local identity.
Renaming it is a compatibility change while runs that may retry still exist.
The compiler records its Origin and includes it in deployment checks. The
returned key is opaque and safe to send as a provider idempotency key; it does
not expose Principal data or include the physical attempt number.

## Run every attempt with fresh authority

`durable.caller(...)` does not serialize a Request, cookie, credential, bearer
token, database handle, resolved `ctx`, resolved Context values, Service
instance, or historic allow decision. Dispatch records only a versioned run-as
recipe: non-secret Principal and selected Tenant identity references, the typed
Context input needed to resolve them again, the ordinary Authority class,
causation, the original actor for audit, and bounded locale/trace continuation
where allowed. The stored Tenant reference is an integrity/audit fact, not an
authorization grant: fresh Context Resolution must derive the same selected
Tenant before the attempt can start.

Each attempt then:

1. resolves the current Principal from that reference;
2. runs the current Context Definition from the persisted Context input;
3. creates a fresh immutable Tenant, Authority, deadline, cancellation signal,
   locale, trace context, and execution-scoped Services;
4. applies current Policy to every Collection, nested Mutation, and disclosure;
5. disposes the Execution and its Services after success, failure, cancellation,
   or lease loss.

If Company membership is revoked between attempts, a later attempt does not
reuse the earlier authorization. In this Reaction,
`durable.caller({ whenDenied: "fail" })` makes a current identity, Context, or
Policy denial a safe terminal `run-as-denied` failure; it is not retried and is
not mislabeled as operator cancellation. A Definition may deliberately choose
`whenDenied: "cancel"` when loss of caller authority semantically cancels the
work. Transient infrastructure failure while resolving the same identity can
use the ordinary bounded retry policy, but no retry may cache or elevate the
failed decision. Worker location, missing credentials, and exhausted identity
resolution never upgrade the attempt to System.

The input includes `companyId` even though the originating Execution already
has a Tenant. This makes the Reaction payload independently decodable and lets
the compiler prove that the persisted caller Context agrees with the intended
company. It is not a second authorization proof; current membership remains
Policy data.

Some operational work should not impersonate the initiating user. Use an
explicit service identity instead:

```ts
runAs: durable.service({
	principal: digestWorker,
	context: ({ input }) => ({ companyId: input.companyId }),
}),
```

`digestWorker` is an imported typed service-Principal reference owned by the
application's Auth integration. The callback `input` comes from the owning
durable Definition, and its return must satisfy the generated Context input.
Every attempt resolves that service Principal and Context afresh. An explicit
System recipe is reserved for narrowly compiler-authorized maintenance
Definitions; it is never the default for Reaction, Job, Workflow, direct code,
or a worker process.

## Make external effects safe to retry

Durable execution is at least once. A worker may finish user code but lose its
lease or response before it persists success. QUESTPIE can fence its own
PostgreSQL transitions; it cannot revoke an HTTP request already accepted by
another system.

The hostile sequence is ordinary:

1. `delivery.sendMessage` reaches the provider;
2. the provider creates the message;
3. its response is lost, or the worker dies before saving the receipt;
4. the lease expires and another attempt starts.

Both attempts use `run.effect("deliver-message")`, so the provider sees the
same logical idempotency key. A conforming Action adapter persists or retrieves
the same provider result for the same canonical input. Reusing the key with a
different input is a deterministic conflict.

If a provider has neither idempotency nor a reliable lookup key, the Action
must declare that its effect is at least once or that response loss becomes an
ambiguous terminal state. QUESTPIE then exposes that ambiguity in the run
receipt and Studio. It cannot turn an unknowable external outcome into an
“exactly once” promise.

Do not use `attempt.id` or a random UUID for a logical provider effect. Those
values change on retry and make every delivery a new request. Also do not call
the provider directly from a Mutation: automatic database retry and response
loss would couple an irreversible effect to a transaction that may roll back.

## Define one explicit Job

A Reaction answers “what follows this committed application event?” A Job
answers “run this background command.” The handler is equally small, but the
Job can be dispatched directly, delayed, or installed as a recurring schedule.

```ts title="src/features/company-digest.ts"
import { defineJob } from "#questpie/app";
import { durable, operation } from "questpie";
import { digestWorker } from "../integrations/auth";
import { companyDigestData } from "./company-digest-data";

export const companyDigest = defineJob({
	name: "companyDigest",
	input: operation.object({
		companyId: operation.uuid(),
	}),
	runAs: durable.service({
		principal: digestWorker,
		context: ({ input }) => ({ companyId: input.companyId }),
	}),
	retry: durable.retry({
		maximumAttempts: 6,
		initialDelay: "10s",
		backoff: "exponential",
		maximumDelay: "1h",
		jitter: "full",
	}),
	handler: async ({ input, ctx, run, attempt }) => {
		const digest = await ctx.data.run(companyDigestData, {
			companyId: input.companyId,
			through: run.scheduledFor,
		});

		await attempt.heartbeat({ completed: "query" });
		ctx.signal.throwIfAborted();

		const sent = await ctx.actions.delivery.sendCompanyDigest(
			{ companyId: input.companyId, digest },
			{ idempotencyKey: run.effect("send-digest") },
		);

		return {
			providerBatchId: sent.providerBatchId,
			messageCount: digest.messages.length,
		};
	},
});
```

`run.scheduledFor` is a stable logical timestamp recorded when the run is
accepted. A retry sees the same value; it does not rebuild “today's digest”
from the wall clock of a later attempt. `attempt.heartbeat(...)` is optional
for short Jobs. Here it records bounded, non-secret progress, renews only the
current fenced lease, and observes cancellation before the external batch.

The Job has one inferred persisted result. Dispatch still returns immediately
with an acceptance receipt. The result becomes available only when the logical
run reaches a terminal success state; errors and cancellation have their own
terminal receipts.

### Dispatch it from a client-facing Mutation

Network callers normally request application work through a Mutation. That
keeps admission, Policy, deduplication, and any settings write in one explicit
application contract:

```ts title="src/features/request-company-digest.ts"
import { defineMutation } from "#questpie/app";
import { operation, policy } from "questpie";

export const requestCompanyDigest = defineMutation({
	name: "reports.requestCompanyDigest",
	input: operation.object({
		requestKey: operation.text({ minimumLength: 1, maximumLength: 100 }),
	}),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		const accepted = await ctx.dispatch.companyDigest(
			{ companyId: ctx.tenant.id },
			{ idempotencyKey: input.requestKey },
		);

		return { runId: accepted.runId };
	},
	network: true,
});
```

```ts title="web/request-digest.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({ companyId });
const { runId } = await company.mutations["reports.requestCompanyDigest"]({
	requestKey: `digest:${selectedDate}`,
});
```

The caller cannot choose the service Principal, Context recipe, retry policy,
Queue, lease, or effect key. Repeating the same scoped idempotency key with the
same canonical Job input returns the existing run receipt. Reusing it with
different input fails with a typed idempotency conflict. Key scope includes the
application/environment and durable Resource identity; retention is finite and
reported by the generated contract.

### Dispatch it directly from server code

Trusted server code can use the generated Job map without inventing an HTTP
endpoint:

```ts title="scripts/request-company-digest.ts"
import { createApp } from "#questpie/app";
import { principal } from "questpie";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

const accepted = await app.execution(
	{
		principal: principal.user({ id: principalId }),
		context: { companyId },
	},
	({ jobs }) =>
		jobs.companyDigest.dispatch(
			{ companyId },
			{ idempotencyKey: `manual:${companyId}:${selectedDate}` },
		),
);

console.log(accepted.runId);
await app.close();
```

`jobs.companyDigest` comes from the concrete generated App Contract. Its input,
options, receipt, and declared errors come from `companyDigest`; a phantom Job
or unknown option is a TypeScript error. Direct acceptance uses its own short
PostgreSQL transaction and the same Policy/run-as/idempotency machinery as
Mutation-owned dispatch. It does not synchronously execute the handler.

A Job can be explicitly network-exposed later, but wrapping an application
request in a Mutation is the normal client path. It avoids publishing generic
worker controls and lets the application return the exact receipt it wants.

## Install a recurring schedule without defining a Queue

The same Job can own a recurring schedule configured by application data. This
Mutation stores the company's setting and accepts the schedule change in the
same transaction:

```ts title="src/features/configure-company-digest.ts"
import { defineMutation } from "#questpie/app";
import { operation, policy } from "questpie";

export const configureCompanyDigest = defineMutation({
	name: "reports.configureCompanyDigest",
	input: operation.object({
		cron: operation.cron(),
		timeZone: operation.timeZone(),
	}),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		await ctx.data.companySettings.update({
			key: { companyId: ctx.tenant.id },
			patch: {
				digestCron: input.cron,
				digestTimeZone: input.timeZone,
				updatedAt: ctx.operationTime,
			},
			select: { companyId: true },
		});

		const schedule = await ctx.dispatch.companyDigest.schedule({
			id: `company-digest:${ctx.tenant.id}`,
			cron: input.cron,
			timeZone: input.timeZone,
			input: { companyId: ctx.tenant.id },
		});

		return {
			scheduleId: schedule.scheduleId,
			nextRunAt: schedule.nextRunAt,
		};
	},
	network: true,
});
```

The schedule identity is stable. Reconfiguring the same identity atomically
replaces its future rule; it does not create a second schedule. Each cron tick
accepts one logical Job run with an idempotency identity derived from the
schedule, tick, application/environment, and Job Resource. A scheduler crash,
leader failover, duplicate wake, or Runtime outage cannot create two logical
runs for one tick. A missed due time becomes eligible after recovery according
to the declared catch-up limit.

Removing a future schedule is not the same as cancelling an already accepted
run. The generated schedule surface has an explicit removal command; the run
surface has a separate cancellation command and receipt. V3's `unschedule`
ambiguity does not carry into this contract.

Static application cron can later compile to the same schedule record. It does
not need a second scheduler or `defineQueue`. Runtime-level Queue configuration
owns due ordering, admission, concurrency, fairness, polling, lease claims, and
backpressure. A Job may later request a named concurrency key when a provider
invariant proves the need, but Queue remains operational machinery rather than
an application composition container.

## Understand run, attempt, lease, and effect identity

One word such as “job id” cannot safely serve every lifetime:

| Identity        | Lifetime and meaning                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `dispatchId`    | one immutable acceptance fact, atomic with its owning Mutation or direct-dispatch transaction    |
| `runId`         | one logical Reaction or Job run, stable across retry and lease recovery                          |
| `attemptId`     | one physical handler attempt; every retry or reclaimed lease gets a new value                    |
| `leaseToken`    | opaque fencing value for state transitions by the current worker claim                           |
| `effectKey`     | one logical external effect, stable across attempts and scoped by Resource/run/local effect name |
| `causationId`   | the Operation, dispatch, schedule tick, or later Workflow event that caused the run              |
| `correlationId` | a wider trace/journey grouping that grants no authority                                          |

An acceptance may create `dispatchId` and `runId` together internally; the
public guarantee is that both are stable and inspectable before the transaction
reports success. Duplicate acceptance returns the same logical run. It does not
create a second run and merely hope the handler is idempotent.

The Runtime claims ready work in a short PostgreSQL transaction, records a new
attempt and lease token, then commits before invoking user code. No row lock,
SQL transaction, or pooled connection remains open during the handler or
external Action.

Heartbeat, progress, retry scheduling, cancellation observation, success, and
terminal failure compare both current `attemptId` and `leaseToken`. A stale
worker cannot mark a newer attempt complete. If heartbeat loses ownership,
`ctx.signal` aborts and the handler must stop advancing work. An already
accepted external request still relies on the stable effect key; fencing a
database row cannot recall it.

This is at-least-once physical execution with at-most-one accepted logical run
per scoped idempotency identity. It is not exactly-once arbitrary code.

## Retry and terminal results are explicit

The Definition owns bounded retry. The Runtime persists each failed attempt,
classifies the failure, computes backoff from the compiled policy, writes the
next `availableAt`, and releases the lease in one fenced transition. It never
depends on an in-process timer.

A retry policy defines maximum attempts or an overall deadline, initial delay,
backoff, maximum delay, jitter, and declared permanent failures. Framework
validation, missing Definition version, incompatible payload, explicit Policy
denial, and idempotency conflict are not blindly retried. Transient Action and
database failures retry only when their contracts classify them as safe.

A run ends as one of these public outcomes:

- succeeded with its validated persisted result;
- failed terminally with one safe declared or framework error receipt;
- cancelled after a cancellation request wins the transition;
- ambiguous because an external effect cannot prove whether it completed.

Retry exhaustion creates terminal inspectable state, commonly called a dead
letter. It does not move an opaque broker payload into a second user-managed
Queue. Studio and the generated maintenance surface can inspect the input,
attempts, safe errors, and identity semantics, then perform an explicit action:
retry the existing run where safe, replay as a new run with a new effect scope,
cancel, or acknowledge/discard according to retention policy. Those commands
record operator, reason, and chosen identity behavior.

“Retry” and “replay” are deliberately different. Retry preserves the logical
`runId` and effect keys. Replay creates a new logical run and cannot pretend an
ambiguous provider effect is safe. The UI must never offer one unlabeled button
for both.

## Cancellation and heartbeat are cooperative

Cancellation is a durable request, not process magic:

- before claim, it prevents a handler from starting;
- during an attempt, it aborts `ctx.signal` when the worker observes it;
- after a successful fenced completion, it becomes a no-op with an audit fact;
- after an external provider accepted work, it cannot claim that work was
  recalled unless the provider's Action supports and confirms cancellation.

A running handler must cooperate by using cancellable generated data/Action
calls, checking `ctx.signal`, and heartbeating during long CPU or provider-poll
loops. Heartbeat renews only the matching lease token and may persist a bounded
progress codec. Failure to renew means ownership may have moved; the worker
stops making durable state transitions.

The success-versus-cancel race has one PostgreSQL compare-and-set winner. A
read-then-unconditional-update is insufficient. Every losing request remains
an append-only audit event so Studio can explain why cancellation did not undo
a completed run.

## Results and errors are durable, bounded data

The compiler materializes input, progress, result, and declared error codecs.
Payloads are validated both when accepted and when a worker decodes them. A
stale or malformed record never enters user code. The terminal result is
validated before the fenced success transition.

Durable values are bounded separately from network Operation values. Secrets,
credentials, raw Requests, stack traces, database handles, Service instances,
and unrestricted open JSON do not silently enter run storage or the Execution
Envelope. Definitions declare sensitive paths for encryption/redaction where
the future storage contract permits them; Studio never treats stored payloads
as automatically safe to display.

Mutation-owned Reaction dispatch returns no public receipt. A generated server
observer can later read a typed terminal receipt under the durable Resource's
inspection Policy when a separate accepted surface provides its identity. A
browser receives such status only through an explicitly exposed application
Query or Job exposure; possession of an identity is not authorization.

Result retention, idempotency retention, dead-letter retention, payload erasure,
and audit retention are different policies. Exact defaults remain a proof gate.
Deleting a large payload must not erase the minimal identity and transition
facts required to explain a financial or security-sensitive run.

## See one history in Studio

Every durable transition emits an append-only event with the common Execution
Envelope. Studio correlates:

- originating Query/Mutation, transaction, Change Ledger facts, `dispatchId`,
  causation, and correlation;
- durable Resource identity/version, canonical input digest, `runId`, run-as
  recipe, original actor, current Principal/Tenant/Authority class, and Context
  resolution outcome without credentials;
- schedule identity and tick, due time, priority/admission reason, and Queue
  wait time;
- `attemptId`, Runtime build, worker, lease token/expiry, heartbeat, progress,
  deadline, and cancellation observation;
- retry classification, safe error, computed backoff, next `availableAt`, and
  terminal reason;
- Action identity, redacted effect-key digest, provider correlation/receipt,
  and explicit ambiguity;
- validated result, retention state, and every operator command with actor and
  reason.

Studio reads the same durable state and event family as the Runtime. It does
not edit dispatch, lease, attempt, or dead-letter tables as ordinary Collection
rows. CLI, tests, OpenTelemetry exporters, and a future Cloud consume the same
correlation contract rather than reconstructing separate truths from logs.

A developer can start at the `messages.submit` Mutation, follow its PostgreSQL
transaction to `messageSubmitted` dispatch, inspect every attempt and Action,
and see why the run succeeded, retried, was denied after membership revocation,
lost a lease, became ambiguous, or reached terminal failure.

## Keep Reaction, Job, Action, and Queue distinct

The shared engine does not make the words interchangeable:

| Concept                | Developer meaning                                                               | What it does not mean                                       |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Transactional Dispatch | atomic acceptance of typed future intent by a Mutation                          | handler completion or broker acknowledgement                |
| Reaction               | durable follow-up to an explicit committed application event                    | an in-transaction hook or mutable before/after callback bag |
| Job                    | explicit durable background command, directly or periodically dispatched        | an implicit consequence of every Collection write           |
| Action                 | named external or nondeterministic effect boundary                              | automatically retry-safe transaction code                   |
| Queue                  | Runtime admission, due ordering, concurrency, lease, and backpressure machinery | a required application Definition or source-code module     |

The distinction improves both DX and operations. A reader can tell why work
exists from its Resource kind, while the Runtime reuses one proven durable
spine instead of implementing separate queue, hook, and workflow engines.

## A Workflow builds on the same spine

The accepted Workflow seam persists a multi-step process that can wait, receive
a signal, resume after restart, and expose its history. It reuses durable runs,
attempts, leases, timers, Actions, Mutations, Context Resolution, cancellation,
and the Execution Envelope. Complete public Workflow breadth remains a later
vertical.

The intended minimal publishing experience is:

```ts title="src/features/publish-article.ts"
import { defineWorkflow } from "#questpie/app";
import { operation, workflow } from "questpie";

export const publishArticle = defineWorkflow({
	name: "publishing.publishArticle",
	input: operation.object({
		articleId: operation.uuid(),
		companyId: operation.uuid(),
	}),
	signals: {
		approval: operation.object({
			approvedBy: operation.uuid(),
		}),
	},
	runAs: workflow.caller(),
	handler: async ({ input, ctx, step }) => {
		await step.mutation(
			"request-review",
			ctx.mutations.articles.requestReview,
			{ articleId: input.articleId },
		);

		const approval = await step.waitForSignal("wait-for-approval", {
			signal: "approval",
			timeout: "30d",
		});

		const publication = await step.action(
			"publish",
			ctx.actions.publishing.publishExternally,
			{
				articleId: input.articleId,
				approvedBy: approval.approvedBy,
			},
		);

		await step.mutation(
			"mark-published",
			ctx.mutations.articles.markPublished,
			{
				articleId: input.articleId,
				providerId: publication.providerId,
			},
		);

		return { providerId: publication.providerId };
	},
});
```

The Workflow argument is contextually typed by its local input and signal map;
`ctx` comes from the concrete generated App Contract under the Workflow's
run-as recipe. Each named `step.mutation` references a generated Mutation and
persists its validated result. `step.action` derives a stable effect identity
from Workflow run and step name. `waitForSignal` returns the exact `approval`
codec and uses a durable timer; it does not keep a process or database
transaction asleep.

This shape deliberately has no generic `step.run(async () => arbitraryEffect)`
happy path. Application writes have a Mutation owner, external effects have an
Action owner, and waits have a durable timer/signal owner. A process crash
between an effect and step-result persistence still requires the same Action
idempotency or explicit ambiguity rule as a Job.

Before complete Workflow becomes public, a focused design must prove signal
authorization and deduplication, early-signal buffering, child invocation,
timeouts, compensation, history bounds, continuation, cancellation, result
queries, and code evolution. Every run must store its Workflow semantic
identity, compiled version/build digest, and observed step identities. A
deployment must pin compatible code, use explicit compatibility branches, or
block while live histories require unavailable code. “Replay latest arbitrary
TypeScript” is not a supported promise.

## What QUESTPIE compiles and operates

From one Reaction or Job Definition, the compiler emits:

- exact input, optional progress, terminal result, declared error, run-as,
  retry, schedule, inspection, and generated dispatch contracts;
- one stable Resource identity/version and Origins for handler, effect names,
  generated members, and options;
- canonical payload and identity digests with explicit application/environment
  scope;
- executable binding to the matching Runtime build without startup discovery;
- exact Mutation `ctx.dispatch`, generated direct `jobs`, nested handler
  `ctx.actions`/`ctx.mutations`, and optional client members;
- deployment diagnostics for pending runs whose Definition or executable
  version would become unavailable.

The Runtime owns PostgreSQL dispatch/run/attempt/schedule tables, short claim
transactions, leases and fencing, wake/reconciliation, retry timers,
cancellation, retention, and the Execution Envelope. Changing a Queue adapter
cannot change Transactional Dispatch atomicity, run identity, retry meaning,
deduplication, cancellation, terminal state, or Context reconstruction.
Provider-native priority or broker features are optimizations beneath this
portable semantic contract.

## Know the guarantee

For a supported Reaction or Job, QUESTPIE promises:

1. accepted Mutation dispatch commits atomically with business state;
2. accepted direct, delayed, and cron dispatch has one durable logical identity;
3. a crash or lost wake cannot lose committed work;
4. physical execution is at least once, with stable run and external-effect
   identities across attempts;
5. no PostgreSQL transaction remains open while user handler code runs;
6. every attempt uses a fenced lease and a fresh resolved Execution under its
   explicit run-as recipe and current Policy;
7. retry, backoff, cancellation, heartbeat, result, terminal failure, dead
   letter, and operator transitions are durable and bounded;
8. application writes cross a Mutation boundary and external effects cross an
   Action boundary;
9. generated server/client surfaces use the same typed payload, receipt,
   Policy, identity, and failure meanings;
10. Studio can correlate the originating transaction through every dispatch,
    run, attempt, Action, and terminal result.

The accepted durable contract includes Transactional Dispatch, Reaction,
explicit Job acceptance, delayed and scheduled availability, one shared
run/attempt/lease kernel, checkpoint resume, retry, cancellation, executable
pinning, and safe events. Ticket #19 owns ten-instance scheduler and failover
evidence; ticket #21 owns final spelling. Complete Workflow authorization,
child work, compensation, continuation/history limits, and version evolution
remain proof-blocked.
