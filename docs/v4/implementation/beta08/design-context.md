# BETA-08 implementation context

- Status: implementation decision record for issue #295
- Base: `141417bc96dcb56ab6ce88a8521a11dd323fe76e`
- Authority: ADR-0013, ADR-0016, ADR-0017, ADR-0021,
  `docs/v4/transactional-dispatch-and-reaction.md`,
  `docs/v4/lifecycle-jobs-and-shared-durable-kernel.md`, and
  `docs/v4/context-and-policy.md`

## Bounded outcome

BETA-08 executes the Reaction that BETA-06 already accepts. One exact committed
message-published fact creates one causally deduplicated Reaction, and a worker
records a Policy-current result.

BETA-06 stopped at intent. `questpie_internal.pending_reaction_intents` carries
an origin-unique row whose `state` is constrained to exactly `'pending'`, and
`ReactionProjectionV1` carries identity, input codec, and origin with no handler
and no run state. Nothing advances either. This slice adds the durable kernel
that does, and nothing else.

The tracer starts from one committed Message publication, lets a worker claim
the resulting run, kills that worker after the claim commits and before the
handler finishes, and requires that the stale lease holder can no longer publish
a terminal transition while a fresh worker completes the run exactly once
against current Policy.

## What this slice does not add

No generic Job client, no Workflow steps, no schedules, and no external Action
authoring. Job and Workflow are separate capability projections over the same
run; ADR-0016 assigns them their own slices. `defineJob` stays a discovery-only
Definition kind here.

## One kernel, one state machine

ADR-0016 lowers Job, Reaction, and Workflow to one PostgreSQL state machine:

```text
accept -> ready/delayed -> claim(attempt, lease) -> running
running -> retry/delay | waiting | succeeded | failed
any nonterminal -> cancellation request -> cancelled
```

This slice implements that machine and drives only its Reaction projection
through it. Acceptance identity, run, attempt, lease and fence, retry,
cancellation, result, retention, executable compatibility, and append-only
events have one owner, so a later Job or Workflow slice adds a capability
projection rather than a second durable runtime.

## Identities

Eight identities, each with one lifetime, exactly as ADR-0013 fixes them:

| Identity     | Lifetime                                                       |
| ------------ | -------------------------------------------------------------- |
| dispatch     | one immutable acceptance fact                                  |
| run          | one logical Reaction across retry and lease recovery           |
| attempt      | one physical handler attempt                                   |
| lease token  | opaque ownership fence for one claim                           |
| effect       | Resource, run, and literal effect name, stable across attempts |
| cancellation | one durable cancellation request                               |
| causation    | the Operation or dispatch that caused the run                  |
| correlation  | wider observation grouping, never authority                    |

Correlation is deliberately not authority anywhere in this slice. Every
authority decision reads dispatch, run, attempt, or lease token.

## Acceptance stays atomic and needs no second key

`ctx.dispatch.messageSubmitted(input)` remains `Promise<void>` inside the
Mutation transaction. The Message, Message Event, Change Ledger fact,
transactional audit, dispatch and run state, and the Mutation result receipt
share one PostgreSQL transaction, and rollback leaves none of them.

The scoped idempotency identity is derived, not authored: application,
environment, durable Resource, and a key from the originating Mutation call plus
the static dispatch slot. The author passes no second dispatch key. The same
canonical payload returns the existing byte-identical receipt and the same
logical run; a different payload in the same scope fails
`IDEMPOTENCY_CONFLICT`.

This is what makes "one Reaction per fact" structural rather than a discipline.
There is no independent producer: no API accepts a hand-built Reaction, so two
rows for one fact are not a mistake to avoid but a state the schema cannot
represent.

`LISTEN`/`NOTIFY` is a wake hint only. A crash after commit and before wake
leaves a ready run that reconciliation discovers, exactly as the BETA-07 wake
contract already tolerates an absent hint.

## Claim, lease, and fence

A worker admits at most 64 ready rows per batch. Each individual claim takes
`FOR UPDATE SKIP LOCKED`, writes one attempt and a 30,000 ms lease, and commits
**before** the handler runs. A long handler heartbeats every 10,000 ms against a
300,000 ms attempt deadline.

Every heartbeat and every terminal transition compares both the current attempt
and the lease token. After lease expiry another worker creates a new attempt and
a new token, and from that moment the stale worker cannot heartbeat, publish
success, schedule a retry, or win a cancellation race. That is the fence, and it
is the single property the prescribed red test attacks.

Multiple worker processes are the premise, not a later goal. Claim, lease,
fence, and `SKIP LOCKED` exist only because more than one process competes for
the same row; concurrent claims are the first hostile case.

## Fresh caller authority

Acceptance persists only Context input, the ordinary Authority class, Principal,
Tenant, and original-actor references. It persists no credential, request,
resolved Context, Service, database handle, or System fallback.

Every physical attempt builds one fresh root Execution, resolves Context once,
and evaluates current Policy evidence. Revoking the caller's Membership before
an attempt makes that attempt terminal with `RUN_AS_DENIED`. Worker location and
Queue ownership grant no authority.

This is the same invariant BETA-07 had to repair: an earlier decision is not
authority for a later disclosure. Here the later action is a handler rather than
a frame, and the rule is identical.

## Retry, cancellation, and effects

The declared retry program is eight attempts, 1,000 ms exponential backoff, a
900,000 ms cap, full jitter, and an 86,400,000 ms horizon. Validation errors,
declared Reaction errors, and run-as denial are permanent and are not retried.
Exhaustion and permanent failure create a safe inspectable dead letter.

Cancellation before claim prevents the handler outright. Cancellation during a
handler writes durable intent, is observed by the heartbeat, and competes with
success through one fenced compare-and-set transition, so exactly one of the two
wins. Cancellation cannot recall an external request a provider already
accepted, and this slice does not pretend otherwise.

An Action call never runs inside the Mutation or the claim transaction. Every
attempt uses the same stable effect identity for the same logical effect, so a
provider idempotency receipt can recover a lost response. Reusing an effect
identity with different canonical input conflicts. Without idempotency or a
reliable lookup contract a lost response becomes `ambiguous`: QUESTPIE claims
at-least-once delivery with stable identity, and does not claim exactly-once
effects.

## Budgets

| Budget                        | Accepted default |
| ----------------------------- | ---------------: |
| active attempts per Principal |               16 |
| claim batch                   |               64 |
| pending runs per Resource     |          100,000 |
| dead letters per Resource     |           10,000 |
| events per run                |            1,024 |
| payload bytes                 |          262,144 |
| result bytes                  |          262,144 |
| retry horizon                 |    86,400,000 ms |
| attempt history               |          30 days |
| idempotency identity          |           7 days |
| terminal payload and result   |           7 days |

Limit failure is `RESOURCE_LIMIT`. Retention may erase payload, result,
idempotency body, and old attempt history, and preserves the minimal dispatch,
run, causation, correlation, terminal, and audit identities needed to explain
the work. The changed loop stays under 5 s.

## Events and database boundary

Each durable transition appends an event carrying sequence, timestamp, Resource,
dispatch, run, attempt, lease-token digest, causation, correlation, kind, and a
safe error code where applicable. Events carry no raw payload, credential,
secret, or stack trace.

A run stores its Runtime Build identity and required executable digest. The
artifact keeps matching executable bytes while any nonterminal run references
them, and readiness fails when those bytes are missing or incompatible. Drain
stops new claims, then lets current claims finish or leases expire.

Direct application and worker writes to run, attempt, event, and dispatch state
are rejected. Every index stays B-tree with no expression or partial index, no
table enables RLS, and this slice adds no Index authoring authority and makes no
RLS claim.

## Evidence discipline carried from BETA-07

BETA-07 took four rounds, and three of them shipped a test that proved something
other than what it claimed, because each injected a construct the production
path cannot produce: a failure class outside its declared union, a branch the
staging precondition can never admit, and an `instanceof` test against a value
built with no class at all.

This slice therefore holds two rules from the start. Every repair is falsified
against the unrepaired code, and the exact assertion that fails is recorded with
it. Every sentence in this record must trace to a path some test executes; where
a limit or a refusal is claimed, a hostile case drives it rather than a comment
asserting it.
