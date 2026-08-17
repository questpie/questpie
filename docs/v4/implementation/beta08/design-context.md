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

## Executed evidence

The prescribed red test is
`tests/integration/postgres/beta08-durable-kernel.test.ts`, "a worker crash
after claim cannot let the stale lease holder publish a terminal transition,
and one fact keeps one Reaction". It publishes one Message, claims the run with
a 1,000 ms lease, lets that lease expire, takes the run over from a second
worker, and only then lets the stale holder try to finish.

It was falsified against the unrepaired kernel. Replacing the fenced predicate
`AND current_attempt_id = $3 AND lease_token_digest = $4` with
`AND $3::uuid IS NOT NULL AND $4::text IS NOT NULL` in all three
compare-and-set sites makes it fail at
`tests/integration/postgres/beta08-durable-kernel.test.ts:111`:

```text
expect(stale).toEqual({ status: "fenced", state: null, deadLetter: false })
-   "state": null,       -   "status": "fenced",
+   "state": "succeeded", +   "status": "applied",
```

The stale holder's `succeed` is applied and the run reaches `succeeded` while a
fresh worker still holds it. Restoring the fence turns the same assertion green.

`RUN_AS_DENIED` was falsified the same way. Deleting the
`if (isRunAsDenial(error)) return "RUN_AS_DENIED";` line in
`packages/runtime/src/durable/worker.ts` makes
`tests/integration/postgres/beta08-reaction-worker.test.ts:272` report
`{ outcome: "retryScheduled", failureCode: "HANDLER_FAILED" }` instead of the
permanent denial, so the test proves the classification rather than the shape of
the thrown value. The detection matches the frozen `Error` with a `code` of
`notFound` or `unauthenticated` that `context.error` actually builds; no test
constructs that value by hand.

`VALIDATION_FAILED` is falsified the same way: removing the
`RuntimeCodecError` branch from `classify` turns the permanent
`{ outcome: "failed", failureCode: "VALIDATION_FAILED" }` into
`{ outcome: "retryScheduled", failureCode: "HANDLER_FAILED" }`, so a result
outside its declared codec would be retried to exhaustion. The cancellation
tightening is falsified by deleting `AND NOT cancellation_requested` from
admission and claim, which makes `kernel.admit()` return the cancel-requested
run instead of an empty batch.

Twenty-three PostgreSQL tests carry the slice. Nine kernel cases: stale fence,
concurrent `SKIP LOCKED` claims, retry exhaustion, cancellation race, executable
retirement, cancellation reaping, single-winner maintenance, cross-attempt
effect identity with recovery and conflict, and permanent codec validation.
Nine worker cases: success, refused effect and retry, lost response and
acknowledged ambiguity, revoked Membership, declared Reaction error, recovered
lost response, bounded result, refused network exposure, and terminal effect
conflict. Five protocol cases: fresh install and v3 upgrade, direct-write
rejection, append-only history, B-tree-only with no RLS, and a tampered guard.

Each PostgreSQL file builds the relocated application once and scopes every
assertion by run identity: rebuilding it per test dropped the schema under the
previous test's live application and deadlocked the reset.

Eight claims in this record are deliberately narrower than the accepted contract
allows, because nothing in this slice executes the wider version:

- The 24-hour retry horizon is persisted with every run and is read on every
  retry schedule, where it clamps `available_at`. This slice runs no horizon
  sweep, so a run whose horizon passes while it waits is still bounded only by
  its eight-attempt program.
- `EXECUTABLE_RETIRED` is a claim refusal, not a run failure code. A worker
  without matching executable bytes refuses the claim and consumes no attempt;
  the run stays `ready` for a compatible worker.
- `durable-kernel.json` pins only the budgets this slice enforces: claim batch,
  events per run, payload bytes, result bytes, and the retry horizon. The
  accepted active-attempts-per-Principal, pending-runs-per-Resource, and
  dead-letters-per-Resource budgets are not enforced here, so they are not
  pinned into the compatibility contract the Runtime Build digests. Retention is
  the same: no sweep erases payload, result, idempotency body, or old attempt
  history in this slice, so the artifact carries no retention block.
- The `questpie_internal` guard proves the narrow claim its own comment makes:
  a statement that never opts into the kernel marker is rejected. The
  application connects as the schema owner, so this is a structural guard
  against accidental application and worker writes, not a hostile-role boundary.
  A non-owner role matrix belongs to the slice that introduces one.
- The artifact does not retain executable bytes for nonterminal runs, and
  readiness does not scan `durable_runs.executable_digest` against the current
  build. A run whose executable contract no longer matches is refused at claim
  time, which is narrower claim 2 above and is the only disposition this slice
  implements.
- `RESOURCE_LIMIT` is the explicit failure for a result outside its byte budget.
  The 1,024-event bound is a `durable_event_sequence_bounded` CHECK rather than
  an explicit limit failure; the eight-attempt program keeps it unreachable.
- `IDEMPOTENCY_CONFLICT` for a different payload in the same scope is BETA-06
  behavior, proved by its accepted `f9879efd` evidence. This slice neither
  produces nor tests it.
- External effects cross a `perform`/`recover` callback rather than a generated
  Action, because ADR-0021 defers Action from beta.1 and this slice adds no
  external Action authoring. The durable kernel owns only the effect _identity_
  ledger — reservation, stable identity, receipt, conflict, and ambiguity — so
  the later Action slice replaces the callback with a generated Action call over
  the same ledger rather than competing with a second durable effect surface.

The prescribed `check:changed` loop runs the compile-level
`tests/integration/beta08-reaction.test.ts`; the prescribed red test is a
PostgreSQL concurrency case and runs in the `beta08` PostgreSQL scenario, which
the seconds-long changed loop deliberately excludes.

Measured on PostgreSQL 17 with the reference-local baselines: one 20-run worker
batch at a 405.241 ms median against a 2,500 ms budget, a maximum 168-byte run
result, four events per successful run, 57,779 public declaration bytes, and
21,028 TypeScript instantiations. The nightly contention scenario ran 64 runs
against eight competing workers at 374.261 ms against a 3,000 ms budget, with 64
attempts and zero superseded leases. PostgreSQL 16, 17, and 18 each report 102,
102, and 105 passing tests with zero failures.
