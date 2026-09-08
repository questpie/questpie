# Durable work and observability

Read [durable Reactions and Jobs](https://questpie.com/docs/v4/durable-reactions)
and [OpenTelemetry](https://questpie.com/docs/v4/opentelemetry) before adding
work that outlives a request or exporting telemetry.
For static schedules, deployment activation, or Mutation checkpoint recovery,
also read [scheduled Jobs](https://questpie.com/docs/v4/scheduled-jobs). Its
complete examples use the Team Support Desk reference application.

## Choose the owner of work

- Use a Mutation for transactional PostgreSQL state changes.
- Use an Action for one caller-requested external effect. Supply a stable
  caller-owned `effectKey`.
- Accept a Job when work must be durable, delayed, retryable, or checkpointed.
- Prefer accepting a Job directly for new application-owned follow-up work.
  Use a Reaction only when the required source is an already committed fact
  projected into durable follow-up work.

Job is the single checkpointed durable-work abstraction in beta.2. Design each
attempt for replay. Reauthorize with fresh Context and Policy, treat
`ctx.signal` as the stop request, and use Runtime-owned Effect Identity with a
provider idempotency contract for external effects. An ambiguous provider
outcome stays ambiguous; do not turn it into success or retry automatically.

Accept Mutation-owned durable intent in the Mutation transaction. Commit makes
it eligible; rollback publishes and runs nothing. A cancellation request is
durable state, while a worker that has already crossed an external boundary
must still report the true outcome.

## Schedule a bounded sweep

Keep dynamic due times in application rows. Author one application-owned Job
with `schedule: { cron, execution: { principal, context }, input }`. All three
members are required. Use `principal.service({ name })`, the application's
existing Context input, and the Job's existing input codec; empty inputs are
explicit `{}`. Grant the service actor ordinary application permissions.
Compilation validates static values, not current Membership or Policy.

Cron uses five numeric fields in UTC. At least one day field must cover its
whole allowed set. Names, seconds, wrapping ranges, Sunday seven, impossible
calendars, and a timezone option are unsupported. Schedules belong to
application Jobs, not Package-owned Job factories. Keep the compiled static
recipe on the server; it contains no credentials and creates no browser,
OpenAPI, or MCP schedule surface.

Make the Job call a bounded named Mutation that selects and locks due rows,
rechecks current state and `ctx.now`, accepts ordinary Jobs, and advances due
times in the same transaction. Follow the exact Team Support Desk example
rather than inventing another schedule schema or dispatch kernel.

## Preserve checkpoint identity and authority

Use only `ctx.run.step.mutation(name, ctx.mutations.<qualified.name>, input)`
for a Job checkpoint. The generated reference is non-callable and owns input,
output, and declared-error inference. Keep its name, reference, input, and
order stable for retained runs. Names are nonempty ASCII letters, digits, `-`,
or `_`, at most 64 bytes. There are at most 64 unique ordered checkpoints and
one command in flight; await each command before starting another.

The checkpoint uses one stable Mutation Call Identity across attempts. The
Mutation commits application writes, Job acceptance, Change Ledger, and its
result receipt in its own transaction. A separate fenced transaction binds
checkpoint completion to that receipt. Crash recovery repeats the same
command through the existing receipt path, not the application write.

Recovery resolves fresh Context and Mutation admission. These checks may deny
recovery after commit. If they allow it, the originally authorized immutable
receipt returns without rerunning the handler, lifecycle, or Collection
Policy. Collection-only revocation does not make that historical result a new
read. Keep the original Runtime Build available for retained work; the latest
handler is not a recovery substitute.

Changed commands, duplicate/reordered names, truncated successful history, and
missing or changed required receipts fail closed with `CHECKPOINT_INVALID`.
History/input limits use `RESOURCE_LIMIT`. Declared Mutation errors keep their
type and permanently fail the attempt with `REACTION_ERROR`; catching one does
not permit another step or a successful return. Existing retryable failures
use the Job's declared policy. Cancellation may race a commit and does not
prove rollback. The worker joins all started step promises before settlement.

Checkpoint history stays with its run; Mutation receipts have no expiry or
pruning path. Checkpoint input and receipt result each permit at most 1 MiB of
canonical UTF-8 data. Short checkpoint transactions are bounded at five
seconds, while the Job's existing attempt and result limits still apply.
This capability adds no Action checkpoint, Service, callback step, timer,
signal, direct Job acceptance, or Workflow Resource.

## Activate explicitly during an authorized deployment

Follow the application's deployment procedure. Runtime requires exact protocol
v9. Stop incompatible Runtimes before migration. Existing v8 needs
`--allow-non-rolling-protocol-v9`; supported v6/v7 needs both
`--allow-non-rolling-protocol-v8` and `--allow-non-rolling-protocol-v9` on
`questpie migration apply`. Fresh databases need neither. Both required flags
are checked before protocol mutation, but the version upgrades commit
separately: a failed v9 upgrade can leave a valid committed v8 upgrade. Repair
forward with incompatible processes stopped.

After build, migration, and required Seeds, explicitly run
`questpie schedule activate --expect-revision <revision>`. Use `0` only for
first activation. Keep revisions as decimal text. Recover response loss by
repeating the same request against the same artifacts. On
`SCHEDULE_ACTIVATION_STALE`, inspect the returned head before deliberately
issuing a new request; never auto-read-and-retry or force an activation.

Startup does not activate schedules. The normal durable worker poll reconciles
the active set; a custom host owns that existing poll and shutdown loop.
New/changed schedules start after the activation minute. An unchanged program
keeps its frontier. After downtime only the latest missed matching instant is
accepted; earlier unaccepted ticks are coalesced, not replayed. Existing runs
retain their independent attempts, retries, and cancellation state.

To remove a schedule, remove its member, rebuild, and activate the desired set.
An empty set stops future tick acceptance without cancelling accepted work.
Re-adding starts after the new activation; rollback content uses a new
revision. Activation and producer transactions share the lock, are bounded at
10 seconds including lock wait, and roll back frontier/tick/acceptance
together. The set permits at most 64 schedules and 262,144 canonical artifact
bytes. Producer failure does not block already accepted durable work.

## Observe without changing semantics

Runtime observation emits bounded, disclosure-safe envelopes. It is lossy
operational evidence, not authorization, durable truth, or application state.
Handlers remain ordinary and do not receive a tracer or span API.

Install the exact peer package `questpie-opentelemetry` and configure the
official OpenTelemetry SDK at application startup. The adapter consumes the
Runtime observation contract; it does not add a second lifecycle, query,
realtime, or durable kernel. Keep exporter endpoints and authentication in
deployment configuration, never in source or generated contracts.

Telemetry export failure must not fail application work. Use application
results, the Change Ledger, Job state, and database receipts for correctness;
use telemetry to diagnose what happened.
