# ADR 0013: Freeze Transactional Dispatch and Reaction

- Status: Accepted
- Date: 2026-08-13

## Context

QUESTPIE needs durable follow-up after a committed Mutation without a lossy
post-commit callback, user-authored outbox, long database transaction, ambient
worker authority, or exactly-once claim for arbitrary external effects. One
identity cannot safely mean acceptance, logical work, physical execution,
lease ownership, and provider effect at the same time.

## Decision

QUESTPIE accepts a minimal durable Reaction vertical over PostgreSQL.

- A Mutation writes typed `ctx.dispatch.target(input)` intent in its owning
  transaction. Business rows, Change Ledger facts, transactional audit,
  dispatch/run state, and the Mutation result receipt commit or roll back
  together. Wake signals are hints; durable ready state owns recovery.
- `defineReaction` is an application-specialized factory from the Current App
  Contract. One exported Definition owns one static inline handler, exact
  input/result/error codecs, explicit caller run-as, bounded retry, and literal
  effect names.
- Dispatch, logical run, physical attempt, lease token, effect, cancellation,
  causation, correlation, and terminal receipt identities remain distinct.
  Scoped duplicate acceptance returns the same logical run and receipt;
  changed canonical input conflicts.
- A worker claims ready work in a short PostgreSQL transaction with
  `FOR UPDATE SKIP LOCKED`, persists a new attempt and opaque fencing token,
  and commits before user code. Heartbeat, retry, timeout, cancellation,
  success, and terminal failure compare the current attempt and token.
- Every attempt constructs one fresh root Execution and resolves its declared
  Principal, Tenant, transport-neutral Context input, and current Policy once.
  A worker process, region, Queue, missing credential, or failed resolution
  cannot imply System Authority.
- Physical execution is at least once. `run.effect("literal")` derives one
  stable effect identity across attempts. A provider must offer idempotency or
  reliable receipt lookup; otherwise response loss becomes an explicit
  ambiguous terminal outcome.
- Retry, exponential backoff, full jitter, attempt timeout, cancellation,
  dead-letter inspection, concurrency, payload/result bytes, history, retry
  horizon, and retention are finite. A stale lease holder cannot publish
  success or schedule another retry.
- A nonterminal run pins the Runtime Build and digest of the executable bytes
  it requires. Readiness fails for missing or incompatible bytes. Drain stops
  new claims before finishing or expiring owned leases.
- Durable Execution Events are append-only and safe by construction. They
  carry correlation identities and safe error codes, not credentials, raw
  payloads, secrets, or stack traces.

## Consequences

- Application authors define a Reaction beside the Mutation that dispatches
  it. They do not define an outbox Collection, Queue module, broker topic, or
  post-commit hook.
- External effects cross generated Action boundaries and execute outside both
  the Mutation and lease-claim transactions. Application writes from a
  Reaction cross generated Mutation boundaries.
- Cancellation is cooperative and fenced. It cannot recall an external effect
  that a provider already accepted.
- The accepted P3 Mutation call type remains unchanged. Durable acceptance is
  transaction-owned internal state unless an application explicitly returns a
  receipt through a later Operation.
- Job remains a distinct later vertical. Direct, delayed, scheduled, status,
  result, cancellation, failover, and retention behavior must pass together
  before `defineJob` becomes authority. Workflow remains later still.
- P5 adds only ordinary B-tree indexes, emits no RLS, and makes no database RLS
  enforcement claim.

## Rejected alternatives

- Fire-and-forget after-commit callbacks, in-memory timers, or `NOTIFY` as
  durable authority.
- Holding the Mutation or claim transaction open while user code or a provider
  call runs.
- Reusing one “job id” for dispatch, run, attempt, lease, and effect lifetime.
- Inheriting worker System Authority or persisting credentials, requests,
  resolved Context, Services, or database handles.
- Using attempt identity or a random value as provider idempotency identity.
- Claiming exactly-once arbitrary code or unknowable provider effects.
- Treating Queue as an application composition container or accepting partial
  Job/Workflow syntax before its complete vertical passes.
