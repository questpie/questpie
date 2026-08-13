# Durable execution primary-source research

- Status: research evidence; no acceptance authority
- Date: 2026-08-12
- Scope: Transactional Dispatch, Reaction, Job, and the later Durable Workflow
- Sources: PostgreSQL, Temporal, Inngest, Trigger.dev, Cloudflare Workflows,
  and Stripe first-party documentation only

This report asks what QUESTPIE must own to advance work after a committed
Mutation without losing it, duplicating logical work accidentally, or granting
a worker ambient authority. It does not select another product's architecture
and does not freeze public syntax. Where it shows a QUESTPIE-shaped interface,
the example is a design implication to test, not an accepted API.

## Executive conclusion

The credible contract has three progressively richer layers over one durable
PostgreSQL spine:

1. A Mutation writes business data and immutable dispatch intent in the same
   PostgreSQL transaction. Either both commit or neither exists.
2. A Reaction or Job has one stable logical run, zero or more separately
   identified attempts, a recoverable lease, bounded retry policy, explicit
   cancellation state, and a durable terminal result. Delivery is at least
   once; user effects must be idempotent or explicitly compensatable.
3. A later Workflow adds named durable steps, timers, signals, history, and an
   evolution rule. It reuses Job attempts, leases, retry, cancellation,
   external Action, and Execution machinery rather than creating another
   runtime.

The most important negative conclusion is that a Queue claim, a lease, or a
memoized step cannot make an arbitrary external effect exactly once. If a
provider accepts a request and its response is lost, the Runtime cannot know
whether the effect happened. It must retry with the same logical effect
identity against an idempotent provider API, inspect provider state, or enter an
explicit ambiguous/manual state. Stripe documents this exact reason for
idempotency keys: a connection failure can be retried with the same key without
creating a second object, and the provider returns the saved result for that
key. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)

## The developer jobs the design must make simple

The current design-fiction Mutation already shows the right producer-facing
shape:

```ts
export const submitMessage = defineMutation({
	name: "messages.submit",
	input: submitMessageInput,
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.create({
			input: {
				channelId: input.channelId,
				body: input.body,
				authorId: ctx.principal.id,
			},
			select: { id: true },
		});

		await ctx.dispatch.messageSubmitted({ messageId: message.id });
		return message;
	},
});
```

The author should not manually open an outbox table, publish after commit, or
construct an Execution Envelope. `ctx.dispatch.messageSubmitted` is generated
from a separately owned durable Definition and inserts typed intent into the
Mutation transaction. Its awaited result means **intent was accepted into this
transaction**, not that the handler has already run.

The matching durable Definition still needs focused interface design. Whatever
syntax wins, it must make these jobs visible without exposing the queue engine:

```ts
// Illustrative contract shape, not accepted syntax.
export const messageSubmitted = defineReaction({
	name: "messages.submitted",
	input: operation.object({ messageId: operation.uuid() }),
	runAs: reaction.caller(),
	retry: reaction.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, attempt }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		});

		await ctx.actions.deliverMessage(
			{ message },
			{ idempotencyKey: attempt.effect("deliver-message") },
		);
	},
});
```

This sketch carries five requirements, not five final names:

- the payload codec and generated dispatch member come from one Definition;
- the run-as strategy is declared, durable, and inspectable;
- retry belongs to the durable handler, not to an ambient worker default;
- application reads use the normal generated, Policy-aware `ctx`;
- an external effect crosses a named Action boundary and receives a stable
  logical-effect key, not an attempt-specific random key.

Normal authors should not configure `SKIP LOCKED`, lease columns, heartbeat
tables, advisory locks, or worker polling. Those are Runtime implementation and
Studio evidence. Advanced scheduling, concurrency, and deduplication options
earn public surface only when a real application invariant needs them.

## 1. PostgreSQL can make dispatch atomic with business state

### Source facts

`COMMIT` makes all changes in the transaction visible and durable together.
[PostgreSQL `COMMIT`](https://www.postgresql.org/docs/current/sql-commit.html)
This is sufficient to make an insert into a framework-owned dispatch table
atomic with Collection writes, Change Ledger rows, and other Mutation state.
No distributed transaction is needed while all of those facts live in the
same PostgreSQL transaction.

PostgreSQL `NOTIFY` follows transaction completion: a notification issued in a
transaction is delivered only if that transaction commits. PostgreSQL also
describes `NOTIFY` as simple interprocess communication and recommends storing
structured data in tables, with the notification prompting listeners to inspect
the table. Identical notification payloads in one transaction can be folded,
the payload is bounded, and a full notification queue can make a notifying
transaction fail at commit.
[PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html)

`LISTEN` is session-local and has an initialization race. PostgreSQL prescribes
committing `LISTEN`, reading durable database state in a new transaction, and
then processing later notifications; the initial read may overlap early
notifications.
[PostgreSQL `LISTEN`](https://www.postgresql.org/docs/current/sql-listen.html)

### QUESTPIE implications

- The durable truth is a dispatch row written by the Mutation, not an
  `afterCommit` callback, in-memory promise, `NOTIFY` payload, Redis message, or
  broker acknowledgement performed after the database commit.
- A process crash after commit but before any wake loses no work. Startup and
  periodic reconciliation scan durable ready state.
- Wake delivery is an optimization. It may be duplicated, delayed, coalesced,
  or absent without changing correctness.
- Issuing `NOTIFY` inside the business transaction couples notification-queue
  exhaustion to business commit failure. A first tracer should compare that
  operational cost with a best-effort post-commit wake plus mandatory polling;
  neither design may use notification receipt as the durable checkpoint.
- Dispatch payload, Definition identity/version, run-as recipe, causation,
  schedule, and idempotency facts must be immutable or append-only after
  acceptance. Mutable delivery state belongs in separate run/attempt fields or
  events.
- A dispatch insert should have a database uniqueness constraint for its
  logical acceptance identity. Application-level `check then insert` is not a
  concurrency guarantee.

## 2. `SKIP LOCKED` is a claim primitive, not a delivery guarantee

### Source facts

`SELECT ... FOR UPDATE SKIP LOCKED` skips rows that another transaction cannot
lock immediately. PostgreSQL explicitly says this produces an inconsistent
view unsuitable for general queries but useful for multiple consumers of a
queue-like table.
[PostgreSQL locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

At PostgreSQL's default Read Committed isolation, each command sees a snapshot
as of that command's start. Later commands in the same transaction can see
newer commits; more complex search/update logic can observe results that need
careful concurrency reasoning. Repeatable Read fixes the transaction snapshot
but can still produce serialization anomalies, while Serializable can abort a
transaction with a serialization failure that the application must retry.
[PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

PostgreSQL advisory locks have different lifetimes. Transaction-level advisory
locks are released automatically when the transaction ends. Session-level
locks survive rollback and remain until explicit release or session end.
[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)

### QUESTPIE implications

A worker can claim ready rows in a short transaction using a shape equivalent
to:

1. select due, unleased work in deterministic priority/order with `FOR UPDATE
SKIP LOCKED`;
2. atomically write `leaseOwner`, `leaseToken`, `leaseExpiresAt`, and a new
   `attemptId`;
3. commit the claim transaction;
4. only then execute user code outside the database transaction.

The worker must not keep a PostgreSQL transaction or row lock open for the
duration of arbitrary user code or an external request. A short lock serializes
the claim; the persisted lease recovers work after the claiming process dies.

Every claim increments or replaces an opaque fencing token. Completion,
heartbeat, retry scheduling, and terminal writes compare both `attemptId` and
the current lease token. A stale worker whose lease expired must be unable to
mark a newer attempt complete. The external provider still needs its own
idempotency mechanism because a database fencing token cannot revoke a request
already accepted outside PostgreSQL.

`SKIP LOCKED` does not promise fairness, priority by itself, or exactly-once
execution. The query needs an explicit due/priority/order key, bounded batch
size, and starvation tests. A reconciler must find work skipped by every wake.

Advisory locks should not be the source of run state:

- a transaction-level advisory lock disappears before user code if the claim
  transaction is correctly short;
- a session-level lock ties correctness to a pool connection and does not honor
  rollback semantics;
- neither records retry, cancellation, terminal failure, or lease history for
  Studio.

They may be useful for narrow coordinator elections after proof, but not as a
replacement for durable row state and fencing.

## 3. Identity must separate intent, run, attempt, and effect

Temporal separates a business-meaningful Workflow ID from a system-generated
Run ID and guarantees at most one open execution for a Workflow ID in one
namespace. It also documents explicit reuse/conflict policies and warns that a
Run ID changes across retry/continue/reset chains, so code should not use the
current Run ID for logical choices.
[Temporal Workflow ID and Run ID](https://docs.temporal.io/workflow-execution/workflowid-runid)

Trigger.dev likewise scopes idempotency keys and returns the original run
handle when the same task/key is triggered again. Its documentation shows why
scope and retention are semantic decisions rather than implementation details:
the same string can mean per-parent-run, per-attempt, or global deduplication,
and keys expire.
[Trigger.dev idempotency](https://trigger.dev/docs/idempotency)

### Proposed QUESTPIE identity model

| Identity         | Lifetime and job                                                                    |
| ---------------- | ----------------------------------------------------------------------------------- |
| `dispatchId`     | One immutable intent accepted in a Mutation or direct durable-dispatch transaction. |
| `runId`          | One logical Reaction/Job/Workflow run; stable across retries and lease recovery.    |
| `attemptId`      | One physical handler attempt; new after retry or lease expiry.                      |
| `leaseToken`     | Fences state writes from an obsolete worker claim.                                  |
| `effectKey`      | Stable identity for one logical external Action effect across attempts.             |
| `workflowStepId` | Stable Definition-local name/identity for one durable step.                         |
| `signalId`       | Deduplicates one external message accepted into Workflow history.                   |
| `causationId`    | Points to the operation/change/dispatch/signal that caused this fact.               |
| `correlationId`  | Groups a larger end-to-end application journey without granting authority.          |

The logical `runId` must not be regenerated on retry. An Action effect key must
not include `attemptId`, or every retry becomes a new provider request. A useful
default is derived from environment/application identity, durable Definition
identity, `runId`, and a compiler- or author-stable local effect name. User
input can contribute only through a canonical, non-secret digest when the
effect's business identity genuinely requires it.

Every idempotency key needs a declared scope and retention story. “Same key” is
meaningless without saying same Resource, application/environment, run, step,
or all time. Reuse with a different canonical payload must fail rather than
silently returning an unrelated prior result. Human identifiers and PII should
not appear in keys or operational names; Temporal separately warns that
workflow and message identifiers are visible in UI, logs, and history.
[Temporal identifier privacy](https://docs.temporal.io/workflow-execution/workflowid-runid)

### Response-loss rule

The following sequence is an unavoidable hostile case:

1. an attempt calls an external Action;
2. the provider commits the effect;
3. the response is lost or the worker crashes before persisting success;
4. the lease expires and another attempt runs.

The second attempt must reuse the same `effectKey`. Stripe's official contract
shows the desired provider behavior: the same idempotency key returns the first
saved result and rejects incompatible parameter reuse.
[Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
When a provider offers no idempotency or lookup key, QUESTPIE cannot safely
pretend otherwise. The Action must declare an at-least-once effect, implement
read-before/write compensation, or surface an ambiguous result requiring
operator/domain resolution.

## 4. Retry is attempt policy, not a promise to repeat arbitrary code safely

### Source facts

Temporal retries Activities by default with exponential backoff while Workflow
Executions do not retry by default. It directs failure-prone and
non-deterministic work such as API calls into Activities, and supports maximum
attempts, interval bounds, and non-retryable failure classes.
[Temporal retry policies](https://docs.temporal.io/encyclopedia/retry-policies)

Temporal also states that an Activity may execute more than once when it fails
to report completion, even though completed Activities are not re-executed
during Workflow replay. It therefore tells authors to make writing Activities
idempotent.
[Temporal Activity idempotency](https://docs.temporal.io/activity-definition#idempotency)

Inngest persists completed step results and retries a failed step independently,
then exposes failure handling after retry exhaustion. Its own documentation
still requires retried code to be idempotent, including the response-lost case.
[Inngest error handling and retries](https://www.inngest.com/docs/guides/error-handling)

### QUESTPIE implications

- A durable Definition has a compiled retry policy: maximum attempts and/or
  overall deadline, initial delay, backoff, maximum delay, jitter strategy, and
  declared non-retryable errors. Hidden infinite retry is a poor first default.
- Attempt state distinguishes `scheduled`, `leased`, `running`, `succeeded`,
  `retry_scheduled`, `failed_terminal`, and `cancelled` (exact storage labels
  remain internal). “Error” is one attempt fact; “terminal failure” is the run
  decision after policy is exhausted or a permanent error occurs.
- Retry scheduling writes a durable `availableAt` and error summary before the
  lease is released. Scheduling uses a database/runtime-owned clock, never an
  unpersisted in-process timer.
- A manual replay is a new explicit transition. Studio must say whether it
  preserves the original `runId`/effect identities, creates a new run, or
  resumes a Workflow history. A generic “retry” button with unspecified
  semantics is unsafe.
- Internal Collection writes should occur through Mutations and can use their
  database uniqueness/invariant contracts. External effects belong to Actions
  with explicit effect identity.
- Handler code must receive `attempt.number`, deadline/cancellation, and an
  idempotency/effect helper as owned operands. It must not receive raw lease
  mutation methods.

## 5. Cancellation and heartbeat are cooperative state machines

Temporal requires long-running Activities to heartbeat for timely failure
detection and for cancellation delivery. Its TypeScript docs say an Activity
receives cancellation at a later opportunity and must cooperate with cleanup.
[Temporal heartbeat and cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation),
[Temporal Activity definition](https://docs.temporal.io/activity-definition)

Inngest is equally explicit that cancelling a run does not stop the currently
executing step; it prevents scheduled work or progression between later steps.
[Inngest cancellation](https://www.inngest.com/docs/features/inngest-functions/cancellation)

### QUESTPIE implications

- `cancelRequestedAt` and terminal `cancelledAt` are different facts.
- Cancellation prevents an unstarted attempt from being claimed and prevents
  the next step/retry from being scheduled. A running handler receives an
  aborted signal and must cooperate; an already accepted external request
  cannot be recalled by changing a PostgreSQL row.
- Heartbeat renews only the matching current lease token, may persist bounded
  progress, and observes cancellation. Heartbeat failure causes the worker to
  stop advancing durable state because ownership may have moved.
- Short Jobs can rely on bounded lease duration plus cancellation checks.
  Long-running Actions need heartbeat or a provider polling/checkpoint design.
- A cancellation race with successful completion needs one database transition
  rule. The proof must pin whether success that commits before cancellation
  wins, while later cancellation becomes a no-op with an audit event.
- Compensation is not database rollback. It is explicit durable forward work,
  can retry, can itself fail, and needs its own effect identities and operator
  state.

## 6. Scheduling and concurrency need durable, named semantics

Trigger.dev distinguishes queued/waiting runs from actively executing work and
supports task-specific or shared queue concurrency. Inngest also defines
concurrency over active step execution rather than sleeping or waiting runs.
[Trigger.dev concurrency and queues](https://trigger.dev/docs/queue-concurrency),
[Inngest concurrency](https://www.inngest.com/docs/guides/concurrency)

### QUESTPIE implications

- `availableAt` is durable scheduling state. Worker restarts, clock changes,
  and missed wakes cannot lose it.
- Concurrency limits count active leased/running attempts, not scheduled Jobs,
  timers, or waiting Workflows.
- The first public option should likely be a bounded concurrency key plus
  limit only when an external-provider or per-Tenant use case proves it.
  `Queue` remains an operational scheduling surface, not a source-composition
  container authors must instantiate for every Job.
- Ordering, priority, and concurrency are separate. A priority sort does not
  guarantee FIFO under `SKIP LOCKED`, retries, or heterogeneous runtimes.
- Schedule creation itself needs idempotency. A cron tick or delayed dispatch
  must not create two logical runs after a scheduler failover.
- Tenant-fairness, global caps, and per-Resource caps are Runtime admission
  concerns. Their current values and blocked reasons must be visible in Studio.

## 7. Every attempt starts a fresh Execution from durable run-as intent

The v3 evidence already shows the failure to avoid: Job and Workflow attempts
created fresh scopes but hard-coded system access and did not reconstruct
caller Tenant, Principal, locale, or resolved application context. V4 should
persist neither a Request nor a mutable `ctx`.

### Required contract

Each durable intent declares a run-as strategy whose durable representation is
small, versioned, and auditable:

- **caller**: persist non-secret Principal identity/reference and the
  transport-neutral Context selector required to reconstruct Tenant; each
  attempt resolves fresh Context and rechecks current Policy;
- **service**: resolve a named application workload Principal with bounded
  Authority and Tenant derivation;
- **system**: an explicit trusted Definition capability, never inferred from
  missing request data or worker execution.

The dispatch record also retains the original actor/Principal and causation for
audit even when the chosen execution identity is a service or System Authority.
Actor history does not itself grant access.

This makes revocation meaningful. A caller-run Reaction whose membership was
removed can fail authorization on a later attempt instead of replaying an old
allow decision. The durable vertical must decide whether that is a terminal
denial, a retryable Context-resolution failure, or a Definition-specific
branch; it must never silently elevate to System.

Nested synchronous operations inherit the attempt's immutable Execution and
still run their own Policies. A retry creates a new Execution Scope and fresh
execution-scoped Services. It reuses durable run identity, not Service
instances, database handles, ambient storage, or cached Policy decisions.

## 8. Reaction and Job share machinery but not meaning

The Runtime can store and advance both with the same dispatch, run, attempt,
lease, retry, cancellation, and event tables. The public concepts still earn
different jobs:

| Concept                | Application meaning                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Transactional Dispatch | Mutation-owned atomic acceptance of typed future intent.                                                    |
| Reaction               | Durable follow-up to committed application state/change, normally created by a Mutation.                    |
| Job                    | Explicit durable background command that may be dispatched directly, scheduled, or called by orchestration. |
| Queue                  | Operational admission, ordering, concurrency, and lease surface.                                            |
| Action                 | External/nondeterministic effect boundary invoked by an attempt.                                            |

A Reaction should receive an explicit typed change/event payload selected by
its Definition, not a mutable before/after hook object and not an unrestricted
transaction. It observes committed state in a fresh Execution. If it needs an
atomic application write, it calls a Mutation; if it needs an external effect,
it calls an Action.

A Job may be started outside a business Mutation, but its durable acceptance
still needs one owned transaction and idempotency contract. A fire-and-forget
network request to a worker is not accepted durable work.

The compiler should lower generated CRUD/Mutation dispatch members to the same
internal intent program as custom durable Definitions. It should not generate a
second hidden hooks queue or runtime registry.

## 9. Workflow should add history and waits over the same spine

### What the primary sources establish

Temporal recovers a Workflow by replaying a durable Event History and requires
Workflow code to issue the same durable commands in the same sequence. A code
change that changes command ordering can make an existing history
non-deterministic.
[Temporal Workflow execution](https://docs.temporal.io/workflow-execution),
[Temporal determinism](https://docs.temporal.io/workflow-definition#deterministic-constraints)

Temporal's history is an append-only, durably persisted log used for crash
recovery and debugging. It has explicit size/event limits and uses
Continue-As-New to bound long histories.
[Temporal Event History](https://docs.temporal.io/workflow-execution/event)

Temporal offers two evolution strategies: patch branches that keep old
histories replay-safe, or versioned worker deployments that pin a Workflow to
the code version where it started. Auto-upgrading code still needs replay-safe
changes.
[Temporal TypeScript versioning](https://docs.temporal.io/develop/typescript/workflows/versioning),
[Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)

Inngest and Cloudflare show another useful authoring family: named steps persist
their successful result so a later retry can skip them. Cloudflare also exposes
durable sleep, external event waits, instance lifecycle, and restart from a
named step.
[Inngest execution model](https://www.inngest.com/docs/learn/how-functions-are-executed),
[Cloudflare Workflows guide](https://developers.cloudflare.com/workflows/get-started/guide/),
[Cloudflare Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)

Cloudflare buffers an event sent after instance creation even if the Workflow
has not reached the matching wait yet. Temporal exposes typed Signals/Updates
against a running Workflow and records durable message effects in its model.
[Cloudflare events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/),
[Temporal Workflow message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)

### QUESTPIE implications

QUESTPIE should not casually promise transparent replay of arbitrary TypeScript.
The focused Workflow design must choose and prove its model. A coherent leading
direction is:

- named durable Workflow steps lower to ordinary Job attempts;
- successful step result/error metadata is appended to Workflow history;
- code outside a step may be re-entered after restart and therefore cannot own
  external effects or unrecorded nondeterminism;
- timers are durable rows/history events, not sleeping worker processes;
- signals have typed codecs, stable `signalId`, authorization at delivery,
  append-only acceptance, buffering semantics, and exactly-one consumption by
  the chosen wait/handler;
- every external call is an Action step with a stable effect key;
- internal transactional changes are Mutation steps;
- compensation is an explicit sequence of durable Mutation/Action steps, not
  an automatic rollback claim;
- history and payload bytes have explicit limits, with a continuation/archive
  story before unbounded Workflow is documented.

Workflow evolution cannot remain implicit. At minimum, each run stores the
Workflow Definition semantic identity, compiled contract/version digest, and
the step identities it has observed. Before public Workflow release, QUESTPIE
must choose one of:

1. pin running instances to a deployed Runtime build until completion;
2. compile explicit compatibility/patch branches;
3. allow only compiler-proven replay-compatible changes;
4. fail deployment when live histories require unavailable code.

The first durable tracer can omit public Workflow authoring while preserving
these identities and the append-only history seam. It must not claim that a
mutable handler name plus latest deployed code is sufficient.

## 10. Observability is part of correctness

Durable execution is not understandable from text logs alone. Temporal records
scheduled, started, completed, failed, timed-out, and cancellation events in
history. Trigger.dev exposes run state plus individual attempts. Cloudflare
exposes queued/running/paused/errored/terminated/complete/waiting instance
states.
[Temporal Event History](https://docs.temporal.io/workflow-execution/event),
[Trigger.dev runs](https://trigger.dev/docs/runs),
[Cloudflare Workflow instance status](https://developers.cloudflare.com/workflows/build/workers-api/)

QUESTPIE's append-only Execution Envelope family should let Studio correlate:

- originating operation, transaction, Change Ledger facts, and `dispatchId`;
- durable Definition identity/version and `runId`;
- run-as strategy, current Principal/Tenant/Authority class, and original actor
  without secret credential material;
- `attemptId`, worker/runtime build, lease token/expiry, heartbeat, deadline,
  and cancellation observation;
- retry policy decision, safe error class/details, next `availableAt`, and
  terminal reason;
- Action identity and redacted `effectKey`, provider request/correlation ID,
  ambiguous-response state, and persisted result receipt;
- Workflow step/timer/signal/history identity and code-version decision.

Runtime tables remain source-of-truth state; events make transitions explainable
and exportable. Studio must not allow an operator to edit lease/run tables as
ordinary Collection data. Operator actions such as cancel, retry, replay,
terminate, or compensate are typed maintenance commands that append who, why,
and what identity semantics they selected.

## Hostile proof matrix

| Case                                                                           | Required invariant/evidence                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Mutation rolls back after dispatch call                                        | No business rows, Change Ledger facts, or dispatch intent persist.                                                             |
| Process dies after database commit and before wake                             | Reconciler later discovers and advances the committed intent exactly once as one logical run.                                  |
| Wake is duplicate, folded, delayed, or absent                                  | Same durable state/result; no extra logical run.                                                                               |
| Two workers claim the same ready set                                           | Each run has at most one current lease token; `SKIP LOCKED` batches do not create duplicate logical runs.                      |
| Worker dies immediately after claim commit                                     | Lease expiry makes work eligible again; new `attemptId`, same `runId`.                                                         |
| Old worker resumes after lease was stolen                                      | Every heartbeat/completion write with the stale token is rejected.                                                             |
| Handler completes while lease heartbeat is partitioned                         | State transition is fenced; any duplicate external call uses the same `effectKey`.                                             |
| Provider succeeds, response is lost                                            | Retry reuses the same provider idempotency key or run becomes explicitly ambiguous; never claim exactly once without evidence. |
| Same dispatch idempotency key, same payload                                    | Return the existing logical run/receipt; do not enqueue a second run.                                                          |
| Same key, different canonical payload                                          | Deterministic conflict; never return an unrelated existing run.                                                                |
| Retryable error                                                                | Append failed attempt, compute bounded backoff, persist `availableAt`, release lease.                                          |
| Declared permanent error                                                       | No further automatic attempt; durable terminal failure and safe error receipt.                                                 |
| Retry budget exhausted                                                         | One terminal transition; failure notification/compensation is itself durable and idempotent.                                   |
| Cancellation before claim                                                      | No handler starts.                                                                                                             |
| Cancellation during handler                                                    | Abort is observed cooperatively; no next step/retry starts; already accepted external effect is not described as undone.       |
| Success races cancellation                                                     | One deterministic database winner and an audit event for the losing request.                                                   |
| Heartbeat arrives from wrong attempt/token                                     | No lease extension or progress mutation.                                                                                       |
| Scheduled time passes while all workers are down                               | Run becomes claimable after restart without duplicate schedule firing.                                                         |
| Tenant membership revoked between attempts                                     | Fresh Context/Policy denies or follows the Definition's explicit denial strategy; no System fallback.                          |
| Direct Job dispatch and HTTP-triggered dispatch use equivalent Execution facts | Same Policy meaning, run-as reconstruction, idempotency, and result contract.                                                  |
| Worker process leaks execution-scoped Service                                  | Disposal proof after success, retryable failure, terminal failure, cancellation, and crash recovery boundary.                  |
| External Action incorrectly called from Mutation                               | Compile/runtime boundary rejects external capability in transaction-owned `ctx`.                                               |
| Reaction tries to observe uncommitted state                                    | Impossible by construction: intent advances only after commit and handler gets a fresh Execution.                              |
| Queue is continuously busy with higher-priority work                           | Starvation/fairness budget is measured; old due work cannot disappear behind `SKIP LOCKED`.                                    |
| Runtime deploy removes a Definition with pending runs                          | Deployment gate reports/blocklists orphaned Definition/version; work is not silently dropped.                                  |
| Workflow restarts after each durable step                                      | Prior completed results are reused; external effects are not repeated with a new identity.                                     |
| Signal arrives before matching Workflow wait                                   | Declared buffering rule delivers it later once, subject to signal deduplication and Policy.                                    |
| Same signal is delivered twice                                                 | Stable `signalId` yields one accepted history fact/effect.                                                                     |
| Workflow code changes with live history                                        | Pin/patch/proof/deployment gate handles it; no implicit latest-code replay.                                                    |
| Workflow timer matures during outage                                           | Durable timer produces one eligible continuation after recovery.                                                               |
| Compensation partly fails                                                      | Original failure and compensation progress remain inspectable; compensation retries independently and never rewrites history.  |
| Postgres notification queue is exhausted                                       | Business-commit behavior matches the chosen wake design and is covered by an operational alert/test.                           |
| Database time moves or app host clock differs                                  | Lease and schedule comparisons use the owned database/runtime clock contract.                                                  |
| Error/payload contains secret or PII                                           | Durable payload, idempotency key, logs, envelope, and Studio projection redact or reject it according to compiled codecs.      |

## Concrete design decisions supported by this research

These conclusions are strong enough to carry into the focused design ticket:

1. Keep `ctx.dispatch.<name>(payload)` as Mutation-owned typed intent
   acceptance; do not expose an outbox API to application authors.
2. Store durable intent in PostgreSQL in the same transaction as business state.
3. Treat `NOTIFY`/Redis as wake hints and require scanning reconciliation.
4. Model stable run identity separately from attempt and lease identity.
5. Make delivery explicitly at least once. Require idempotent Action effects or
   explicit ambiguity/compensation semantics.
6. Use short PostgreSQL claim transactions and persisted fenced leases; never
   hold the database transaction while user code runs.
7. Give every durable Definition explicit run-as, retry, cancellation, and
   terminal-result ownership. Never default workers to System Authority.
8. Start every attempt in a fresh Execution and re-run current Context
   Resolution/Policy.
9. Keep external effects behind Action and application transactions behind
   Mutation.
10. Build Workflow later from the same run/attempt/lease spine with named
    steps, durable timers/signals/history, and an explicit evolution rule.
11. Make Studio transitions typed, append-only, and identity-aware rather than
    raw queue-table edits.

## Questions this report deliberately leaves open

- exact `defineReaction`, `defineJob`, `defineWorkflow`, retry, concurrency, and
  run-as syntax;
- whether one dispatch intent immediately owns its `runId` or produces it during
  a separate acceptance transition;
- the default retry budget/backoff and which errors are compiler-declared;
- exact lease/heartbeat durations and adaptive tuning;
- whether the first Runtime uses database triggers or explicit Mutation
  insertion for every Reaction class;
- the first wake design (`NOTIFY` in the business transaction versus
  best-effort post-commit wake plus polling);
- fairness and per-Tenant concurrency grammar;
- durable result retention, payload encryption, and deletion/GDPR behavior;
- whether caller run-as persists a Principal reference, a signed identity fact,
  or a Definition-specific resolver input;
- Reaction selection/filter grammar over committed Change Ledger facts;
- Workflow authoring model, signal conflict policy, continuation, history
  archival, version pinning/patching, and compensation syntax;
- operator retry versus replay semantics after terminal or ambiguous failure.

Each belongs to the focused durable vertical and must be shown as a complete
end-application API before authority/public docs change.

## Primary source ledger

- [PostgreSQL `COMMIT`](https://www.postgresql.org/docs/current/sql-commit.html)
- [PostgreSQL `SELECT` locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL explicit/advisory locking](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
- [PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html)
- [PostgreSQL `LISTEN`](https://www.postgresql.org/docs/current/sql-listen.html)
- [Temporal Workflow execution](https://docs.temporal.io/workflow-execution)
- [Temporal Workflow definition and determinism](https://docs.temporal.io/workflow-definition)
- [Temporal Workflow/Run identity](https://docs.temporal.io/workflow-execution/workflowid-runid)
- [Temporal Event History](https://docs.temporal.io/workflow-execution/event)
- [Temporal retry policies](https://docs.temporal.io/encyclopedia/retry-policies)
- [Temporal Activity definition/idempotency](https://docs.temporal.io/activity-definition)
- [Temporal TypeScript cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation)
- [Temporal TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal TypeScript Workflow versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [Inngest execution model](https://www.inngest.com/docs/learn/how-functions-are-executed)
- [Inngest retries and terminal failures](https://www.inngest.com/docs/guides/error-handling)
- [Inngest cancellation](https://www.inngest.com/docs/features/inngest-functions/cancellation)
- [Inngest concurrency](https://www.inngest.com/docs/guides/concurrency)
- [Trigger.dev idempotency](https://trigger.dev/docs/idempotency)
- [Trigger.dev concurrency and queues](https://trigger.dev/docs/queue-concurrency)
- [Trigger.dev runs](https://trigger.dev/docs/runs)
- [Cloudflare Workflows guide](https://developers.cloudflare.com/workflows/get-started/guide/)
- [Cloudflare Workflow events](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
- [Cloudflare Workflow Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
