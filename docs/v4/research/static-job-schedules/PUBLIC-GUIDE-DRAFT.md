# Public projection: sweep due tickets every minute

ADR-0043 has a committed, verified formal PASS. The public guide is projected at
`apps/docs/content/docs/v4/scheduled-jobs.mdx`; it preserves the two exact
Team Support Desk fences below. The remaining body is retained draft evidence,
not a second public guide or a new source of product authority.

Projection status: verified. Independent fact, prose, and example reviews,
source adjudication of their findings, and the affected documentation checks
are complete. The [projection evidence](../../implementation/static-schedule-public-projection/EVIDENCE.md)
records that ordinary Product review. Aggregate beta.2 acceptance remains
separate.

## Projection plan

The projection adds the how-to, ordinary Job and navigation links, protocol-v9
deployment guidance, the beta.2 preview inventory entry, portable skill
guidance, and the Team Support Desk setup instructions. The ordinary durable
guide retains shared acceptance, heartbeat, retry, cancellation, and retention
explanation. The new page does not copy its Reaction effect example.

The page body begins below. Its Team Support Desk source files and application
prerequisites must be available to readers when projected.

---

# Sweep due tickets every minute

Run a minute sweep when due times live in your application's rows. In Team
Support Desk, each tick starts one Job that calls `ticket.sweepSla` through a
named Mutation checkpoint. The Mutation advances one due ticket and accepts an
independent follow-up Job in the same transaction.

Use this example inside the Team Support Desk application. It depends on its
Ticket Collection, Collection Operations and Policy, Context, demo identifiers,
and `ticket.slaFollowUp` Job. It is not a standalone application.

## Give the sweep an application identity

The schedule uses a service Principal and the application's existing Context
input. The service needs an active Membership with the `agent` role. This Seed
adds that Membership after the application's identity Seed:

```ts title="src/memberships/sweep-seed.ts"
import { defineSeed, seed } from "questpie";

import { demoIds } from "../demo-ids";
import { memberships } from "./index";

export const supportSweepIdentity = defineSeed({
	name: "teamSupport.sweepIdentity.v1",
	dependsOn: ["teamSupport.identity.v1"],
	steps: [
		seed.insert(memberships, {
			id: demoIds.memberships.sweep,
			organizationId: demoIds.organization,
			principalId: demoIds.principals.sweep,
			role: "agent",
			status: "active",
			createdAt: "2026-09-06T00:00:00.000Z",
			updatedAt: "2026-09-06T00:00:00.000Z",
		}),
	],
});
```

`principal.service({ name })` identifies the caller; it grants no privilege.
The Support Desk Context checks the Membership's organization, Principal, and
active status. Schedule acceptance and every Job attempt resolve current
Context. A removed Membership cannot gain access from the worker's location or
the deployment operator's permissions. Keep credentials out of static schedule
values.

## Put the batch in a named Mutation

The existing `tickets.list` Operation selects open tickets with a non-null due
time, ordered by `slaFollowUpDueAt` and then `id`. Its page limit is one. The
Mutation locks that candidate through `get`, then checks its current status and
due time against the transaction's `ctx.now` before updating it.

```ts title="src/tickets/sla-sweep.ts"
import { codec, durable, operation, policy, principal } from "questpie";

import { defineJob, defineMutation } from "#questpie/app";

import { demoIds } from "../demo-ids";

export const sweepSla = defineMutation({
	name: "ticket.sweepSla",
	network: false,
	input: codec.object({}),
	output: codec.object({
		processed: codec.integer({ minimum: 0, maximum: 1 }),
	}),
	policy: policy.authenticated(),
	errors: {
		invalidTicket: operation.error({ code: "SLA_TICKET_INVALID", status: 422 }),
	},
	issueMappings: { tickets: { invalidReference: "invalidTicket" } },
	handler: async ({ ctx }) => {
		const due = await ctx.data.tickets.list({ first: 1, after: null });
		let processed = 0;
		for (const candidate of due.nodes) {
			// A nested get locks the row and reads fresh Policy/state after waiting.
			const current = await ctx.data.tickets.get({ key: { id: candidate.id } });
			if (
				current === null ||
				current.status !== "open" ||
				current.slaFollowUpDueAt === null ||
				current.slaFollowUpDueAt.getTime() > ctx.now.getTime()
			)
				continue;
			const advanced = await ctx.data.tickets.update({
				key: { id: current.id },
				values: {
					lastSlaFollowUpAt: ctx.now,
					slaFollowUpDueAt: new Date(ctx.now.getTime() + 60 * 60 * 1000),
				},
			});
			// Ticket afterWrite accepts the ordinary follow-up Job in this transaction.
			if (advanced !== null) processed++;
		}
		return { processed };
	},
});

export const sweepSlaJob = defineJob({
	name: "ticket.sweepSla",
	input: codec.object({}),
	output: codec.object({
		processed: codec.integer({ minimum: 0, maximum: 1 }),
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
	schedule: {
		cron: "* * * * *",
		execution: {
			principal: principal.service({ name: demoIds.principals.sweep }),
			context: {
				organizationId: demoIds.organization,
				membershipId: demoIds.memberships.sweep,
			},
		},
		input: {},
	},
	handler: ({ ctx }) =>
		ctx.run.step.mutation("due-tickets", ctx.mutations.ticket.sweepSla, {}),
});
```

The generated Current App Contract infers the checkpoint input and result from
`ctx.mutations.ticket.sweepSla`. That value is a non-callable reference; pass it
to `ctx.run.step.mutation`. The schedule's `context` uses the existing Context
schema, and its `input` uses the Job's input codec. There is no second schedule
schema to declare. Empty inputs remain explicit `{}`.

On success, `processed` is zero or one. An updated Ticket records
`lastSlaFollowUpAt` and moves `slaFollowUpDueAt` forward by one hour. Its existing
`afterWrite` accepts `ticket.slaFollowUp` before the Mutation commits. A
rollback preserves neither the update nor that acceptance. One ticket per tick
is this example's deliberate batch bound; it does not clear a large overdue
backlog in one run.

The five cron fields are minute, hour, day of month, month, and day of week,
evaluated in UTC. `* * * * *` matches every minute. There is no seconds field or
timezone option. Do not restrict both day fields: at least one must cover its
complete allowed set.

## Activate the schedule during deployment

Stop the previous Runtime processes before upgrading a protocol-v8 installation
to protocol v9. This is a non-rolling cutover. In the application directory,
with the deployment database connection configured, run `questpie build`,
then `questpie migration apply --allow-non-rolling-protocol-v9`, then
`questpie seed apply`. Migration does not activate the schedule.

For an existing v6/v7 installation, supply both
`--allow-non-rolling-protocol-v8` and `--allow-non-rolling-protocol-v9` to
`questpie migration apply`. Each upgrade keeps its own transaction: if v8
commits and v9 later fails, the database stays at valid v8. Keep incompatible
Runtimes stopped and repair forward; a failed command does not promise that
every preceding upgrade rolled back. A fresh database needs no cutover flags.

For the first activation, run
`questpie schedule activate --expect-revision 0`. The receipt contains
`acceptedRevision: "1"` and the current head. Keep revisions as decimal text.
For later deployments, supply the revision you intend to replace. A stale
revision returns `SCHEDULE_ACTIVATION_STALE` with the current revision and set
digest; inspect the competing deployment before issuing a new request. If the
response was lost, repeat the exact request against the same built artifacts
to recover its receipt.

Start the new Runtime with `questpie start`. Its existing Job worker reconciles
the active schedule before admitting durable work. A custom host must keep
polling its existing `app.durable.worker()` and own shutdown. Startup alone
never activates or restores a schedule.

A newly activated schedule starts after its activation minute. After downtime,
the producer accepts only the latest matching missed minute. Earlier
unaccepted ticks are skipped; already accepted Jobs keep their own retries and
cancellation state. Due tickets stay in application rows for later sweeps.

To remove this schedule, remove the Job's `schedule` member, rebuild, and
activate that desired set with the expected revision. Removing every schedule
activates an empty set. This stops future tick acceptance and preserves already
accepted runs. Keep the executable artifacts needed to run those retained Jobs.

## Keep the checkpoint stable across attempts

`"due-tickets"` identifies the ordered checkpoint within the Durable Run. Its
Mutation Call Identity stays stable across attempts. A crash after the Mutation
commits but before checkpoint completion can therefore recover the same
receipt without repeating the Ticket update or follow-up Job acceptance.

Keep the checkpoint name, Mutation reference, input, and order stable for a
retained run. Changed payloads, renamed or reordered steps, and missing or
changed recorded receipts fail closed with `CHECKPOINT_INVALID`. A successful
handler must consume its recorded history. Names allow ASCII letters, digits,
`-`, and `_`, with at most 64 bytes. A run supports 64 unique ordered names and
one step in flight; await each step before starting the next.

Receipt recovery still enters fresh Context and Mutation admission. If either
denies access, the Job cannot finish that checkpoint even though the write may
already be committed. When those checks allow replay, the receipt returns the
original immutable result without rerunning the handler, lifecycle, or
Collection Policy. A later Collection-only permission change does not turn
that historical result into a new Collection read.

A declared Mutation error rolls back its transaction and permanently fails the
Job with the existing `REACTION_ERROR` code. Catching it does not permit another
step or a successful return. Retryable failures use this Job's bounded retry
policy; the checkpoint helper adds no retry loop. Cancellation can race an
already dispatched Mutation, so cancellation does not prove rollback. Its
stable Call Identity remains the recovery identity for a valid successor.

This Job capability covers named Mutation checkpoints only. It provides no
external-effect Action, Service, timer, signal, callback step, or workflow
surface. Keep external provider work outside this sweep example.

---

## Internal verification and provenance

The two TypeScript fences are exact copies of the named Team Support Desk
source files. `tests/integration/static-schedule-docs-draft.test.ts` checks
that equality and compiles the extracted files in an isolated copy of the
application against its generated App Contract. This checks authoring and
artifact generation, not database execution or formal acceptance.

Facts read from source rather than executed by this documentation task:

- Batch ordering and limit: `fixtures/team-support-desk/src/tickets/sla-query.ts`
  and `tickets/operations.ts`; one open, non-null-due candidate ordered by due
  time and ID. The Mutation rechecks the clock after locking.
- Identity and privilege: `fixtures/team-support-desk/src/execution.ts`,
  `memberships/sweep-seed.ts`, and `tickets/policy.ts`; the ordinary Context validates an
  active Membership, and the application grants its `agent` role.
- Atomic follow-up: `fixtures/team-support-desk/src/tickets/index.ts` `afterWrite`
  accepts `ticket.slaFollowUp` with a stable Mutation-derived key.
- CLI arguments and receipts: `packages/questpie/cli/questpie.ts`,
  `cli/schedule.ts`, and `packages/runtime/src/durable/schedule/contract.ts`.
  Deployment commands were not executed by this docs-only task.
- Calendar, activation, latest-only catch-up, checkpoint recovery, cancellation,
  and finite limits: Proposed ADR-0043 and the candidate source under
  `packages/runtime/src/durable/`; runtime evidence belongs to the existing
  PostgreSQL candidate suites, not this compile check.
- Permanent versus retryable failure: `packages/runtime/src/durable/worker.ts`
  and `postgres-database-terminal.ts` retain `REACTION_ERROR` as permanent.

The owner-selected tradeoff is one latest catch-up run, with dynamic due times
kept in application data. Proposed ADR-0043 records that intent. The how-to
therefore promises a bounded sweep and receipt recovery, not backlog completion
or exactly-once physical handler execution.

The acceptance prerequisite is complete. Final deployment wording, public
example parity, and independent documentation reviews belong to the projection
status above. No additional product choice is requested by this retained draft.
