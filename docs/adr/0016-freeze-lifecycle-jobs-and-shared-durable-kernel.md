# ADR 0016: Freeze Lifecycle Jobs and the Shared Durable Kernel

> The separate Workflow Resource/factory clauses are historical and superseded
> by [ADR-0026](./0026-freeze-action-and-unify-checkpointed-work-in-job.md).
> Their checkpoint, timer, signal, history, and compatibility semantics remain
> current as the closed Job checkpoint projection. Reaction remains distinct.

- Status: Accepted; separate Workflow projection superseded by ADR-0026
- Date: 2026-08-13

## Context

V3 exposed useful `beforeValidate`, `beforeChange`, `afterChange`, and
`afterRead` jobs, plus explicit Jobs and compact Workflow authoring. Its hook
callbacks ran with ambiguous transaction and retry ownership, while Queue,
Workflow, and post-change work could drift into separate execution engines.
ADR-0011 and ADR-0013 already fix the transaction-owned lifecycle and the
PostgreSQL run/attempt/lease spine. The remaining question is how the useful
jobs compose without restoring a hook catalogue or creating three runtimes.

## Decision

QUESTPIE accepts an explicit lifecycle mapping and one durable kernel with
three capability-scoped authoring projections.

- `beforeValidate` jobs map to runtime codec validation, closed pure
  normalization and validation, or named Mutation validation when application
  reads or branching are required. An ambient pre-transaction callback is not
  accepted.
- `beforeChange` jobs map to closed server Value Programs for ordinary
  Collection Operations or a named Mutation for reads, cross-Collection
  invariants, branches, and declared errors. Arbitrary pre-transaction work is
  rejected because it can observe stale state and has no clear capability
  boundary.
- `afterChange` jobs map to transaction-joined Mutation work, audit writes, and
  exact durable dispatch derived from the committed fact. External effects do
  not run in the Mutation; lossy in-memory after-commit work is forbidden.
- `afterRead` jobs map to selection, output codecs, a closed pure projection,
  or a named Query inside its owned read snapshot. A transform after a write
  commits cannot turn a committed success into an apparent rollback.
- Job, Reaction, and Workflow are distinct compiler Resources over one internal
  PostgreSQL durable run/attempt/lease/history kernel. They share acceptance,
  retry, cancellation, scheduling, fencing, result, retention, executable
  pinning, and append-only operational transitions.
- Job means explicitly dispatched durable work. A server Execution or Mutation
  can accept it now or after a delay with a scoped idempotency key. A durable
  schedule produces independently deduplicated ticks. Removing a schedule
  stops future ticks and never cancels an already accepted run.
- Reaction means durable work created only from one exact committed application
  fact. Its causation and acceptance identity derive from the transaction,
  fact, Resource, and static dispatch slot. The author cannot supply a second
  deduplication key or dispatch a Reaction independently.
- Workflow means the same Durable Run with a checkpoint/history projection.
  Its closed commands are named generated Mutation, named generated Action,
  durable sleep, and typed durable signal wait. A generic callback step such as
  `step.run` is not accepted.
- A Workflow checkpoint records an ordered unique step name and canonical
  command digest. Mutation steps retain one stable Mutation Call Identity;
  Action steps retain one stable Effect Identity and receipt or explicit
  ambiguity across crash recovery. Code outside a checkpoint may be re-entered
  and owns no effect, clock, random value, or application write.
- Every live Workflow history records Definition identity, semantic version,
  executable digest, and observed step identities. The Runtime pins compatible
  executable bytes; it never replays history against arbitrary latest code.
- The generated browser client has no generic Job, Reaction, Workflow, Queue,
  lease, or worker-control surface. Applications expose selected request,
  status, cancellation, and signal jobs through ordinary Policy-protected Query
  and Mutation Operations. Server producers are capability-scoped.

The accepted public spellings remain provisional until ticket #21 consolidates
all factories and exports. This ADR does not silently expand ADR-0009's six
Current App Contract factories.

## Consequences

- Queue remains the operational scheduler and lease surface, not a Definition
  or composition container.
- PostgreSQL owns run, attempt, lease, schedule, timer, signal, history, result,
  and retention truth. A notification or broker can only accelerate a durable
  transition.
- Every attempt uses the ADR-0013 fresh run-as Execution and current Policy
  contract. Worker placement, missing credentials, or lease ownership never
  grants System Authority.
- The complete Workflow product remains a later vertical. Signal
  authorization, child work, compensation, continuation/history limits, and a
  multi-version evolution matrix must pass before public Workflow release.
- Ticket #19 owns concurrent scheduler races and ten-instance rolling-
  deployment proof. This decision makes no singleton-leader or HA claim beyond
  the shared PostgreSQL state-machine seam.
- The implementation proof must tighten cancellation so a cancel-requested
  expired run does not start a needless recovered attempt, and must directly
  exercise nondeterministic replay mismatch and append-only event assertions.

## Rejected alternatives

- A general `before*`/`after*` lifecycle Resource with hook priority or ordering.
- Separate Job, Reaction, and Workflow queues or state machines.
- One universal durable builder whose kind switch admits explicit Reaction
  dispatch, Job steps, Workflow lease mutation, or arbitrary callback effects.
- A Workflow implemented as a Job wrapper with a second lease or worker
  authority boundary.
- Generic browser worker controls or a Queue-backed client API.
