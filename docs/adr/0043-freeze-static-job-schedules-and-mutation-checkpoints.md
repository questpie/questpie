# ADR-0043: Freeze static Job schedules and Mutation checkpoints

- Status: Proposed
- Date: 2026-09-06
- Owners: durable execution, compiler, deployment
- Ticket: #365; blocks beta.2 acceptance #364

## Context

ADR-0016, ADR-0017, and ADR-0026 already place static schedules and closed
checkpoints on one Job Resource and one PostgreSQL durable kernel. They do not
settle autonomous producer identity, calendar evaluation, missed ticks, or
deployment activation. The current compiler rejects non-null schedules and the
current Job Context cannot call a Mutation.

The concrete consumer is a minute sweep. A static Job calls one named Mutation;
that Mutation processes a bounded page of application-owned due rows, accepts
independent Jobs, and advances application due times in one transaction. The
owner selected one latest catch-up run after downtime. Dynamic schedule CRUD,
Action checkpoints, signals, sleep, child work, and workflows are not required.

This is a candidate contract, not implementation or acceptance evidence. The
linked decision map records source findings and the proof still required.

## Candidate decision

### One authored schedule, existing execution authority

An application-owned Job may declare one optional static `schedule` with exactly
`cron`, `execution`, and `input`, all required when the schedule is present. `execution`
has exactly `principal` and `context`: a statically authored
`principal.service({ name })` and the exact input of the application's existing
Context. `input` uses the Job's existing codec. Empty inputs are explicit `{}`;
there are no omission overloads or implicit identity choices.
No duplicate Context or Job schema, schedule name, slot identifier, tenant,
Policy, credential, callback, or `runAs` override is authored in the schedule.

The compiler validates and canonicalizes the service identity, Context input,
and Job input. Compilation validates values, not current database authority.
At tick acceptance the producer resolves an ordinary Execution through the
existing Context. Its service Principal is the accepting caller; existing
`durable.caller({ whenDenied: "fail" })` retains its meaning for every producer.
Direct and Mutation-owned acceptance keep their existing callers unchanged.
Every physical attempt resolves fresh Context and current Policy. Worker
placement, activation privileges, and lack of an HTTP request grant no System
authority. A service actor must receive ordinary application permissions.

The compiled schedule artifact is server/deployment data. It is not projected
to the browser client, OpenAPI, MCP, public examples, or observation payloads.
Static values are not a place to store credentials.
The first slice does not add Package-owned Job factories or a Package binding
for application Context. Unsupported Package schedule authoring is rejected;
it must not widen Context input to `unknown` or ask for a duplicate schema.

### Calendar and one latest catch-up

The first slice evaluates UTC calendar time only. Omitted timezone means UTC,
never the Runtime host's local zone; no timezone member is published yet. Civil
time and DST remain a later additive calendar decision. Application-owned
schedules may already encode their own business calendar in the sweep.

The cron grammar has exactly five numeric fields: minute `0–59`, hour `0–23`,
day of month `1–31`, month `1–12`, and day of week `0–6` with Sunday zero. Each
field admits `*`, a number, an ascending inclusive range, or a comma-separated
list. A positive step may follow `*` or a range; it starts at that range's lower
bound, does not carry between fields, and cannot exceed the field's cardinality.
At least one of the two day fields must normalize to its complete allowed set.
There is no hidden OR/AND choice when both day fields are restricted: compilation
rejects that expression. Names, aliases, seconds, years, wrapping ranges,
Sunday seven, and special tokens are rejected. An expression with no possible
Gregorian calendar match is rejected rather than stored forever dormant.

Canonical sorted field sets own calendar semantics, not the source spelling.
Equivalent expressions produce the same program bytes. PostgreSQL owns the
observed current instant; the evaluator uses only UTC integer calendar fields
and those canonical sets. Runtime clocks, locale, ICU, and wake timing do not
choose a scheduled instant. Evaluation must have a finite work bound independent
of the number of missed minutes; a minute-by-minute outage scan is insufficient.

Reconciliation captures PostgreSQL `clock_timestamp()` once after acquiring
its activation lock and floors it to a UTC minute. It selects the latest
matching instant in `(frontier, observedMinute]`. A clock regression never moves
the frontier backward. It accepts at most
one Job per schedule in that transaction and advances the frontier through the
examined time. Older unaccepted matching instants are deliberately coalesced;
they are not accepted runs. No match advances only the frontier. A new/changed
schedule starts strictly after its activation time, with no pre-activation
backfill: its initial frontier is the floored activation minute, excluding that
minute even if activation occurs exactly on the minute boundary. An unchanged
schedule keeps its frontier across deployment changes.

The frontier, selected tick identity, and ordinary Job acceptance commit together.
Context denial, acceptance failure, cancellation, or rollback advances none of
them. The next bounded reconciliation again chooses the latest due instant;
there is no separately queued retry for every failed producer tick. Once a Job
has been accepted, its existing attempt/retry/cancellation contract applies.
Catch-up never merges, cancels, or rekeys already accepted Jobs.

### Explicit activation and three different identities

Runtime boot reads deployment state; it cannot activate a schedule set. Otherwise
an old Runtime restart could restore a removed schedule. Schema migration is not
schedule activation either: a cron-only edit must not require invented DDL.

The proposed deployment command is `questpie schedule activate --expect-revision
<revision>`. It verifies the local generated artifact and existing application/
protocol binding, then performs one application-scoped PostgreSQL transaction.
Revision zero means no activation yet. Revisions are PostgreSQL `bigint` values
from zero through `9223372036854775807`, encoded as decimal text, not JavaScript
numbers. Overflow fails before any state change. The expected revision
is mandatory; there is no force, blind upsert, or automatic read-and-retry mode.

Three facts stay separate:

| Fact                  | Identity and purpose                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Desired schedule set  | Compiler content digest; may repeat on rollback.                                                                        |
| Activation occurrence | Application plus monotonic revision; never reused.                                                                      |
| Logical tick          | Application, Job Resource identity, and scheduled UTC minute; excludes revision, recipe, tenant, and executable digest. |

The request identity derives from application, expected revision, and target
digest; callers author no additional idempotency key. Activation locks the
application head and looks up that immutable request receipt before comparing
the expected revision. Exact replay returns its historical receipt plus current
head without mutation; inconsistent stored request material fails closed.
Only a new request compares the expected revision, validates/installs the
immutable target catalog, increments the revision, switches the active set, and
records its receipt atomically. Its activation time is captured once from
PostgreSQL after acquiring the lock, not from a pre-lock transaction timestamp.
A previously unsuccessful stale request fails
even when its target digest happens to match the current content.

Stale-activation output contains only the safe mismatch class and current
revision/set digest. An operator may deliberately use that revision for a new
activation. The command never does so automatically. Loss of a response is
recovered by repeating the exact request, not by assuming rollback.

A deliberate rollback activates older content at a new revision. A delayed
A-to-B request cannot overwrite an A-to-C-to-A rollback merely because A's
content hash matches again. A per-Job program digest binds Job identity,
canonical cron sets, service Principal identity, canonical Context-input bytes,
and canonical Job-input bytes. It excludes handler execution compatibility.
Activation transfers a frontier only between the immediately previous and new
active sets when that Job's program digest is equal. New, changed, and
removed-and-readded programs begin after the new activation time; a historical
catalog entry is not a reusable frontier.

Each producer transaction locks and revalidates the active head before tick
acceptance. It may use only its verified active set and the currently recorded
frontier/lower bound. Cached pre-activation work cannot bypass this check.
Activation/removal and tick acceptance serialize through the same owner. If
tick acceptance commits first, the accepted run survives. If removal commits
first, even an already-due unaccepted tick is suppressed. No history is drained
from a removed program. PostgreSQL tick uniqueness also prevents old and new
configurations from accepting the same logical minute twice.

Removal installs a set without that schedule; no public per-schedule mutation
surface is added. Activating an empty set disables future schedule acceptance
without cancelling any run. Schedule changes alone must not invalidate the
execution contract of already accepted Jobs. Schedule program, execution
compatibility, and executable bytes need independent compiler bindings; merely
removing one property from a combined digest is not proof of that guarantee.

### Minimum named-Mutation checkpoint

The generated Job Context gains only `ctx.run.step.mutation(name, reference,
input)` and non-callable references at `ctx.mutations.<qualified.name>` using
the existing nested Operation-name projection. The input,
output, and declared-error types come from the named Mutation. There is no
callback step, direct Mutation call, Query capability, Service, Action, direct
Job acceptance, database facade, or transaction facade added to Job Context.

Checkpoint names are nonempty ASCII letters/digits/`-`/`_`, at most 64 bytes.
Names are unique within a run and ordered by invocation. The proposed first
history cap is 64 checkpoints per run, with one in-flight command. Concurrent
step calls fail before the second command is dispatched. Ordinary Jobs that
never use a checkpoint allocate no checkpoint history.
The private command captures the verified reference and codec-canonical input
before its first await; later author mutation cannot change dispatched material.

Before dispatch, a short lease-fenced transaction reserves or verifies the next
ordered checkpoint. Its canonical command digest binds the named Mutation,
canonical input, and required contract/executable compatibility. One Mutation
Call Identity derives from immutable run identity and ordered checkpoint
identity, never from attempt number or fresh random material. The same identity
is retained after crash, cancellation, or a response-unknown outcome.

The existing named Mutation executor owns its own transaction: fresh authority,
Policy, application writes, Job acceptance, Change Ledger, and result receipt.
After it commits, a separate fenced transaction completes the checkpoint by
binding that committed receipt and validated outcome. Do not merge the two
transactions to hide the commit-before-checkpoint crash window. The checkpoint
is not a second Mutation result ledger.

Recovery re-enters the handler and verifies the same ordered command. The same
Mutation Call Identity reaches the existing receipt path and cannot repeat a
committed application write. Changed input/command, renamed, reordered,
duplicate, or truncated history fails closed. A returned handler must have
consumed its recorded history before it may settle successfully. No automatic
latest-code replay or fallback command is allowed.
An ordinary handler failure before reaching its recorded steps keeps its original
failure and existing retry policy. Incomplete history prevents a successful
return; it does not replace a failed handler with a permanent history error.

Receipt recovery enters the same Mutation executor with fresh Context and
Operation admission. It returns the originally authorized immutable result
without rerunning the handler, lifecycle, or Collection row/Field Policy,
preserving ADR-0011 exact-result replay. A Context or Operation-admission denial
can prevent recovery after commit; the write remains committed even if the Job
cannot complete its checkpoint. A Collection-only permission change does not
retroactively hide that stored result while Context and admission still allow
replay. This is historical result recovery, not a newly authorized Collection
read. No raw-receipt shortcut, System elevation, or new disclosure gate is added.

A declared Mutation failure rolls back and has no committed result receipt.
This minimum slice rejects with the same declared error and dooms further
checkpoint progress and successful settlement of that Physical Attempt, even
if the handler catches the error. Reservation, dispatch, completion-unknown,
concurrency, cancellation, and incomplete-history failures likewise prevent
later checkpoint dispatch and successful settlement in that attempt. An already
dispatched Mutation may still commit. The reserved command and stable Call
Identity remain available to the existing Job failure policy. Declared errors
remain permanent `REACTION_ERROR` failures; catching one does not make it
retryable. Only retryable failures re-enter the reserved command in a later
bounded attempt with fresh Context; no retry loop runs inside the helper. Completion never
stores a second copy of a success or failure result. Catch-and-continue after a
failed Mutation step is outside this minimum slice.
The worker owns every started step promise, including an unawaited one. It
closes step admission and joins pending work before terminal settlement and
Execution cleanup. An already-observed cancellation keeps its original reason;
synthetic incomplete-history failures cannot replace it. Joining still uses
the existing bounded execution and transaction cancellation owners.

Failed fenced reservation or observed lease loss/cancellation prevents new
command dispatch. A dispatch racing an unobserved loss/cancellation may still
commit; the short reservation transaction does not lock authority throughout
the Mutation. Stable Call Identity and the existing receipt prevent duplicate
application writes in that race. A valid successor recovers through the same
receipt. Every history advance is fenced against the current attempt; a stale
holder cannot complete a checkpoint even if its Mutation finishes later. Retry
remains the Job's existing bounded policy and horizon, not another retry loop
inside the helper. Cancellation does not assert that a Mutation rolled back.

Current Mutation receipts have no expiry/pruning path. This slice retains that
property and retains checkpoint history with its run, including the exact
application/tenant/Operation/Principal/Call Identity and canonical input digest
needed to identify its receipt. Completed history still refers to that receipt;
there is no second stored result copy. Any future retention change must preserve
receipts needed for replay of incomplete or completed retained history; retry
horizon is not a receipt expiry or permission to erase unresolved history.
Completion retains a digest of the canonical successful receipt bytes as well
as its transaction identity. Replaying completed history requires that exact
receipt inside the existing Mutation transaction, after fresh Context and
admission and before any receipt claim. A missing or changed receipt fails
closed; it cannot be treated as permission to rerun the Mutation. No application,
network, or generated client call option exposes this private replay requirement.

### Failure, limits, and observation

Malformed cron, unknown members, invalid static values, and impossible calendar
programs are compiler diagnostics at authored Origins. Runtime artifact,
activation, command-compatibility, and history-bound failures fail closed before
the corresponding new work. Context and Operation failures retain existing
typed nondisclosure. SQL details, actor identifiers, Context/input values, and
exception messages do not enter framework failures or telemetry.

Durable operational facts record activation revisions, frontier progress,
selected scheduled instants, accepted run links, and checkpoint transitions.
They use existing operational authorization; observation cannot become scheduler
truth. The existing durable failure-code enum gains only `CHECKPOINT_INVALID`;
there are no new observation fields, actor/input payloads, or OTel attributes.
Producer failures remain distinguishable from failures of accepted runs.

The existing worker poll reconciles its verified active schedule set before
ordinary run admission. There is no new timer owner, elected leader, or second
worker. Same-worker overlapping producer polls join one in-flight reconciliation.
Worker drain and Runtime cancellation abort producer work, and admission checks
drain again after joining it. A producer failure does not prevent already
accepted Jobs and Reactions from running. The next ordinary poll may reconcile
again; the producer has no nested retry loop.

The server worker trace adds a separate `producer` result: `active` or `inactive`
with bounded `accepted`/`examined` counts; `failed` with only
`SCHEDULE_PRODUCER_FAILED`; or `draining`. It contains no failed Principal,
Context, input, SQL state, or exception message. `questpie start` drives the
existing worker poll loop. A custom host owns that same loop and its shutdown,
as it already does for ordinary Jobs. Neither host activates schedules at boot.

The candidate's fixed work bounds are:

| Boundary                                                | Limit                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Static desired set                                      | 64 scheduled Jobs; 262,144 canonical artifact bytes                     |
| Calendar search                                         | At most 146,097 UTC days; at most 1,440 minute-of-day candidates        |
| Activation or producer transaction                      | 10 seconds, including lock wait; caller cancellation may end it earlier |
| One reconciliation                                      | At most 64 programs and one accepted tick per program                   |
| Checkpoint history                                      | 64 ordered unique names; one in-flight command                          |
| Checkpoint reservation, load, or completion transaction | 5 seconds; attempt cancellation may end it earlier                      |
| Checkpoint input and Mutation receipt result            | 1 MiB canonical UTF-8 bytes each, preserving existing Mutation limits   |

These are finite first-slice bounds, not throughput promises or new authoring
configuration. The Job's existing attempt deadline, retry horizon and result
bound still apply. A reconciliation timeout rolls back its entire frontier/tick/
acceptance transaction; it cannot publish partial acceptance.

Reference, history, command compatibility and required-receipt corruption produce
the permanent durable code `CHECKPOINT_INVALID`. The history/input size cap uses
`RESOURCE_LIMIT`. Invalid input still rejects the authored checkpoint promise
with the same safe `PROTOCOL_UNSUPPORTED` Operation failure as direct invocation.
Declared Mutation errors retain their declared type and doom that attempt.
Activation's safe classes are `SCHEDULE_ARTIFACT_INVALID`,
`SCHEDULE_ACTIVATION_STALE`, `SCHEDULE_REVISION_OVERFLOW`, and
`SCHEDULE_STATE_INVALID`; only the stale class may include the current revision
and desired-set digest. The deployment CLI also returns only
`SCHEDULE_ARGUMENTS_INVALID`, `SCHEDULE_DATABASE_NOT_READY`, or
`SCHEDULE_ACTIVATION_FAILED` for argument, readiness, or other activation failure.
PostgreSQL failures are not printed as diagnostics.

Activation verifies complete generated checksums and the existing Runtime Build
inventory before opening a database connection. It treats generated executable
files as bytes, not code to execute. It then verifies application, schema,
migration and protocol readiness and calls the same activation owner once.
It requires the deployment database connection, not an unrelated realtime HMAC
key, ingress Principal, Context execution, or application Service startup.
There is no generated `durable.schedules` management API.

Acceptance is blocked until executable evidence verifies finite calendar-search,
schedule-count, transaction-time, history/result-byte, and reconciliation-work
bounds and the exact safe failure projections. Existing Mutation and Job bounds
remain in force; the Mutation's 100 accepted-Job-command cap is not a checkpoint
cap. No unmeasured throughput, exactly-once physical execution, or production
readiness claim follows from this candidate.

## Supersession ledger

If accepted, this ADR adds the missing schedule producer/calendar/activation
contract to ADR-0016/0017/0026 and fixes the subset of named-Mutation checkpoint
semantics above. Latest-only catch-up explicitly qualifies scheduled acceptance:
unaccepted missed calendar instants may be coalesced. It preserves one durable
kernel, ordinary Policy, independently identified accepted ticks, Mutation
ownership, and retained executable compatibility.

The provisional `{ cron, timeZone }` example and combined schedule/handler digest
recommendation in the EB Job Definition workbench are replaced only for this
slice. Named-zone support, general checkpoint breadth, and browser controls do
not become public by implication. The old beta.2 manifest excludes Cron and
must be replaced after this vertical; ADR-0039 remains Proposed.

SPEC, CONTEXT, public documentation, skills, and the ADR index must not describe
this decision as Accepted before a committed verified formal PASS. The beta.2
Fable reviewer exception does not apply to this ticket.

## Required falsification

- Real generated authoring/types: exact inferred inputs/outcomes, static
  service recipe, no duplicated schemas, forged/callable references rejected.
- Canonical artifacts and relocation: equivalent cron bytes, invalid syntax,
  independent schedule versus execution compatibility, tampered cross-pins.
- PostgreSQL 17 with ten contenders: one tick/run, activation CAS and response
  loss, A-to-B-to-A, both removal lock orders, changed recipe, first activation,
  retained unchanged frontier, rollback, cancellation, and missing wakes.
- Existing Mutation kernel: crash after commit before checkpoint completion,
  one write/receipt, revoked Context/admission, explicit Collection-only
  revocation replay behavior, stale lease, replay mismatch, caught step failure,
  truncated history, command bounds, byte bounds, and receipt retention.
- Team Support Desk and Collaboration through generated execution, real worker
  restart and PostgreSQL/browser tracers; no generic browser Job surface.

The decision map and proof evidence must distinguish model falsification from
actual compiler/Runtime integration. A model PASS alone cannot accept this ADR.
