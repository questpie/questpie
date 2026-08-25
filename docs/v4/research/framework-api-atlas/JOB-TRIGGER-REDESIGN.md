# One Job primitive and named triggers

- Status: supporting design candidate
- Parent: [Collection DX and durable-work redesign](./COLLECTION-DX-AND-DURABLE-WORK-REDESIGN.md)

## Converge on Job without Event indirection

Eventually remove public `Reaction`, `defineReaction`, and
`ctx.dispatch.<reaction>` from the target model. Do not introduce a separate
Event Resource merely to connect committed work to a Job. For ordinary
background work that relay would duplicate Job input, retry, run-as, result,
worker, and durable state:

```text
Mutation -> Event codec -> Event payload -> Job codec -> Job payload
```

The direct model is:

```text
Mutation -> transactional Job acceptance
```

`Job` is the one public durable-work Resource. Existing PostgreSQL
run/attempt/lease/fence/retry/cancellation/history/checkpoint guarantees remain.

The first integrated slice intentionally persists a `ready` Job, while worker
admission still resolves only Reaction projections and therefore cannot produce
a Job outcome. A Job-only application also currently emits a durable artifact
with a null compatibility digest, which Runtime rejects. Repair that exact
blocker first. The next coherent closure must then claim, execute, settle,
retry, cancel, and recover an actual Job before any public trigger interface
freezes.

Reaction cannot disappear by renaming it. It currently owns committed
causation, Effect Ledger access, and `run.effect` semantics that ordinary Job
does not yet preserve. Replacement requires those guarantees or an explicit
superseding contract.

## Acceptance modes

A Job may be accepted:

- explicitly by a server Execution;
- transactionally by a Mutation;
- after a delay;
- by a compiler-owned cron trigger;
- later, by a compiler-owned Collection change trigger.

Mutation-owned acceptance writes business rows, Change Ledger facts, Mutation
receipt, and Job acceptance in one transaction:

```ts
await ctx.jobs.notifyTaskAssigned.accept(
	{
		taskId: task.id,
		assigneeId: input.assigneeId,
	},
	{
		idempotencyKey: `task-assigned:${task.id}:${input.assigneeId}`,
	},
);
```

There is one Job input codec and no intermediate Event codec. Explicit
acceptance requires bounded canonical idempotency material and returns a stable
literal-Job run receipt. Reusing the same identity and canonical request returns
the same receipt; changing input, absolute `notBefore`, or run-as material
conflicts. One Mutation may accept multiple independently keyed Jobs. This
supersedes the current single shared Mutation intent slot, whose identity is
derived from Mutation call identity and slot rather than an authored key.

## Multiple stable named triggers

Multiple triggers do not imply a union handler input. Every trigger produces
the Job's one exact input. Named object members give each trigger stable
artifact, diagnostic, idempotency, and causation identity:

```ts
export const processTask = defineJob({
	name: "tasks.process",

	input: {
		taskId: field.uuid(),
		assigneeId: field.uuid(),
	},

	triggers: {
		nightlyRepair: {
			cron: "0 2 * * *",
			timeZone: "Europe/Bratislava",
			runAs: repairServicePrincipal,
			input: {
				taskId: job.literal(repairTaskId),
				assigneeId: job.literal(repairActorId),
			},
		},
	},

	async handler({ input, ctx, run }) {
		// One exact input type regardless of trigger.
	},
});
```

This is structural direction, not frozen syntax. Trigger input and matching
must be closed deterministic compiler programs, or separately pinned
executables with defined conflict/failure semantics. An arbitrary callback can
capture clock, randomness, environment, imports, or mutable state and cannot
prove ten-scheduler convergence.

Collection matching remains deferred until lifecycle semantics close `before`,
`after`, bulk writes, deletes, cascades, soft deletes, filtering, raw external
writes, and nondisclosure. The first Job vertical needs explicit,
Mutation-owned, delayed, and cron acceptance.

## Identity and authority

| Acceptance source | Stable identity material                           |
| ----------------- | -------------------------------------------------- |
| explicit          | Job identity plus caller-scoped key                |
| Collection change | Job identity, trigger slot, and Change Ledger fact |
| cron              | Job identity, trigger slot/epoch, and UTC instant  |
| retry             | existing Durable Run identity                      |
| checkpoint        | Durable Run identity and ordered checkpoint name   |

Trigger adapters may own different trusted run-as recipes while the handler
still receives one generated Job Context. Payload cannot choose Principal,
Tenant, Authority, or Context. Each physical attempt reconstructs a fresh
Execution and current Policy. Retry remains Job-wide unless evidence requires
a narrower trigger override. Trigger rename, deletion, and version activation
must define an epoch so rolling builds assign each tick or fact exactly once.
The current Job slice supports caller-owned run-as only; cron and trusted
service-principal recipes remain target behavior.

## Webhook adapter

A webhook is not a native Job trigger. Route owns HTTP parsing, signature
verification, credentials, response status, streaming, and provider protocol.
After verification it accepts a Job with the provider's stable identity:

```ts
export const stripeWebhook = defineRoute({
	path: "/webhooks/stripe",
	method: "POST",

	async handler({ request, ctx }) {
		const stripeEvent = await verifyStripeWebhook(request);

		await ctx.execution(
			{
				principal: stripeServicePrincipal,
				context: { accountId: stripeEvent.accountId },
			},
			(execution) =>
				execution.jobs.processStripeEvent.accept(stripeEvent.data, {
					idempotencyKey: stripeEvent.id,
				}),
		);

		return new Response(null, { status: 202 });
	},
});
```

## External broker adapter

A Mutation must not publish directly to Kafka, NATS, SNS, or another broker.
Database commit and broker acceptance do not share one ordinary PostgreSQL
transaction:

```text
Mutation transaction
  -> business write
  -> durable Job acceptance
  -> commit
  -> Job Action checkpoint
  -> external broker
```

PostgreSQL remains durable authority. `LISTEN/NOTIFY` or a broker may accelerate
wake-up or serve an explicit integration, but losing it cannot lose accepted
work.

Broker publication must cross a named Action checkpoint. If the provider has
no idempotency or receipt lookup and the response is lost, the checkpoint ends
in explicit ambiguity; Job retry cannot pretend the publish did not happen.

A future Event Resource must pass the deletion test. It is justified only by a
real requirement for an independently inspectable or replayable domain event
stream, unknown subscribers, or external event-log semantics. Background work
alone does not justify Event-plus-Job payload duplication.

## Removed and retained concepts

Remove:

- `defineReaction` and Reaction-specific codecs;
- `ctx.dispatch.<reaction>`;
- separate Queue, Scheduler, Workflow, or worker runtime abstractions;
- direct external broker publication inside Mutation.

Do not introduce ordinary `defineEvent` or `ctx.events.emit` indirection merely
to relay work into Job. No such public v4 Resource currently exists.

Retain:

- `defineJob` for ordinary and checkpointed work;
- explicit and Mutation-owned acceptance;
- delay, retry, cancellation, leases, fencing, and history;
- named Mutation and Action checkpoints;
- cron as a Job trigger;
- PostgreSQL reconciliation and lossy wake acceleration;
- generic browser Job controls remaining absent.

Public Reaction authoring disappears only after an additive protocol/build
bridge proves old and new compatible instances. Existing nonterminal
`reaction:*` runs keep their legacy internal executable projection until they
drain or expire; they are never silently renamed to `job:*`.

Protocol v7 has a checksum-gated migration, but its current in-place physical
renames are not an additive dual-name bridge. The Job worker closure must
either prove rolling coexistence or declare and enforce a non-rolling cutover
before any new build writes.

## Proof obligations

The superseding tracer must prove:

- Mutation rollback removes Job acceptance;
- response loss returns the same run receipt;
- duplicate explicit, cron, and change-trigger races converge;
- each trigger maps to the one exact Job input codec;
- trigger identity and run-as cannot be forged by payload;
- retry and restart preserve the same Durable Run;
- stale workers cannot settle or schedule further work;
- checkpoint Mutation and Action identities survive crash recovery;
- rolling compatible builds retain executable and trigger compatibility;
- broker wake loss cannot lose accepted work;
- generated server and browser capability negatives remain exact.
- an accepted Job is claimed, executed, settled, retried, cancelled, and
  recovered by the worker rather than remaining permanently `ready`;
- old/new builds coexist through an additive protocol bridge or startup blocks
  before writes under an explicitly non-rolling cutover;
- checkpoint drift, broker response loss, and legacy Reaction drain preserve
  their existing incompatibility and ambiguity guarantees.
