# Lifecycle jobs and the shared durable kernel

ADR-0016 preserves the useful v3 lifecycle and background-work jobs while
assigning each one a v4 owner. It adds no general hook catalogue and no second
durable runtime.

## Implemented subset

ADR-0043 implements static UTC Job schedules and only the named-Mutation
checkpoint on that kernel. Explicit revision-fenced activation owns schedule
changes; the existing worker reconciles one latest missed tick. A checkpoint
uses `ctx.run.step.mutation(name, ctx.mutations.<qualified.name>, input)` and
recovers through the existing Mutation result receipt with fresh Context and
Operation admission. It does not acquire Query, Action, Service, sleep, signal
or child-Job capabilities.

The wider checkpoint vocabulary below records the ADR-0016/0026 architectural
boundary, not the beta.2 shipped surface. Action checkpoints, durable timers,
signals, child work and compensation remain later verticals. The exact current
bounds, cutover and failure semantics are in ADR-0043 and the public
[scheduled-Job guide](../../apps/docs/content/docs/v4/scheduled-jobs.mdx).

## Lifecycle mapping

| V3 job           | V4 owner                                                                                           | Forbidden failure mode                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `beforeValidate` | runtime codecs plus Collection `normalize` and `validate` Lifecycle Programs                       | ambient I/O before the write transaction and ambiguous error order |
| `beforeChange`   | trusted values, candidate Policy, and Policy-aware transactional `check`                           | stale pre-transaction reads or an overpowered callback             |
| `afterChange`    | pre-commit bounded `afterWrite`; Job acceptance or Action for durable/external work                | external effects in the transaction or crash-lossy in-memory work  |
| `afterRead`      | selection/output codec, closed projection, or named Query; there is no `afterRead` lifecycle phase | failure after a committed write that falsely resembles rollback    |

Reaction is therefore not a replacement name for every hook. Pure input work,
database-backed validation, bounded transactional work, result projection, and
durable post-commit work retain different owners. Lifecycle TypeScript is
compiled into a phase-capability-checked canonical program and never invoked as
arbitrary callback JavaScript.

## One kernel, three meanings

The compiler emits distinct Job and Reaction Resource projections. A Job gains
the closed checkpoint projection when its handler uses it. The Runtime lowers
both Resources and Job checkpoints to one PostgreSQL state machine:

```text
accept -> ready/delayed -> claim(attempt, lease) -> running
                    running -> retry/delay | waiting | succeeded | failed
                    any nonterminal -> cancellation request -> cancelled
```

Acceptance identity, run, attempt, lease/fence, retry, cancellation, schedule,
result, retention, executable compatibility, and append-only events have one
owner. Capability projections preserve application meaning:

- Job is explicitly dispatched work with a scoped idempotency key;
- Reaction is derived from one exact committed fact with stable causation and
  no independent producer;
- Job checkpoints add history, durable timers, typed signals, and pinned
  semantic versioning to the same run without another Resource.

Queue names the operational scheduling and lease surface. It is not an authored
Definition or a fourth application runtime.

## Job acceptance

The provisional complete server path is intentionally narrow:

```ts
import { defineJob } from "#questpie/app";
import { codec, durable } from "questpie";

export const companyDigest = defineJob({
	name: "reports.companyDigest",
	input: codec.object({ companyId: codec.uuid() }),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1s",
		backoff: "exponential",
	}),
	async handler({ input, ctx, attempt }) {
		await attempt.heartbeat({ completed: 1 });
		return { companyId: input.companyId, actorId: ctx.principal.id };
	},
});
```

A server Execution or Mutation can accept the Job with an explicit scoped
idempotency key and optional delay. Acceptance returns a stable run receipt; it
does not execute the handler inline. Browser callers request this work through
an application-authored Mutation. Removing a recurring schedule prevents
future tick acceptance but does not cancel a run already accepted from a tick.

## Job checkpoint boundary

A checkpointed Job uses a closed projection rather than a generic callback
recorder:

```ts
await step.mutation("request-review", mutations.articles.requestReview, {
	articleId: input.articleId,
});
const approval = await step.waitForSignal("wait-for-approval", {
	signal: "approval",
	timeout: "30d",
});
const publication = await step.action(
	"publish",
	actions.publishing.publishExternally,
	{ articleId: input.articleId, approvedBy: approval.approvedBy },
);
```

Each unique ordered name and command digest is durable. A Mutation step keeps
one Mutation Call Identity and persisted validated result. An Action step keeps
one Effect Identity and receipt or explicit ambiguity. Sleep and signal wait
write durable timer/signal state. There is no `step.run(async () => ...)`, and
an attempt or lease is never application-mutable.

Live histories pin the Job semantic version and executable digest. A
worker without compatible bytes refuses the claim. Latest-code replay is not a
compatibility strategy.

## Authority and visibility

Every Physical Attempt creates a fresh ordinary Execution under the persisted
run-as recipe, resolves Context once, checks current Policy, and disposes its
execution Services. PostgreSQL is the only durable truth. The accepted
Execution Envelope and Studio expose safe append-only acceptance, attempt,
lease, retry, cancellation, step, signal, ambiguity, and terminal transitions;
they never expose credentials, raw payloads, resolved Context, Service state,
or lease mutation controls.

The generated browser client contains no generic durable control plane.
Applications expose only the Policy-protected request/status/cancel/signal
Operations they choose.

## Evidence and remaining edges

The exact reviewed proof input is
`fa2960083c94f824d7c0f4d005a9aec01babb978`; acceptance evidence is recorded at
`71463e99a70481b0950ae18d1ff409c034c1b158`. One fresh stateless Claude Opus
review at medium effort returned `PASS`.

The proof exercises explicit, delayed, and scheduled Job acceptance;
committed-fact Reaction causation; lease recovery and stale-worker fencing;
shared retry/cancellation; Job checkpoint resume, ordering, signals,
effect crash recovery, and executable pinning; exact negative client and
capability types; and bounded declaration/editor cost. It inherits P5 as the
PostgreSQL and fresh run-as authority.

Ticket #19 must still prove concurrent schedulers, ten compatible instances,
arbitrary routing, crashes, and rolling deployment. ADR-0019 owns final
factory and export spelling. Full Job checkpoint breadth remains deferred until
its authorization, child-work, compensation, continuation/history-limit, and
multi-version matrices pass.
