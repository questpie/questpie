# Durable work and observability

Read [durable Reactions and Jobs](https://questpie.com/docs/v4/durable-reactions)
and [OpenTelemetry](https://questpie.com/docs/v4/opentelemetry) before adding
work that outlives a request or exporting telemetry.

## Choose the owner of work

- Use a Mutation for transactional PostgreSQL state changes.
- Use an Action for one caller-requested external effect. Supply a stable
  caller-owned `effectKey`.
- Accept a Job when work must be durable, delayed, retryable, or checkpointed.
- Use a Reaction when a committed application event should accept durable
  follow-up work.

Job is the single checkpointed durable-work abstraction in beta.2. Design each
attempt for replay. Reauthorize with fresh Context and Policy, treat
`ctx.signal` as the stop request, and use Runtime-owned Effect Identity with a
provider idempotency contract for external effects. An ambiguous provider
outcome stays ambiguous; do not turn it into success or retry automatically.

Accept Mutation-owned durable intent in the Mutation transaction. Commit makes
it eligible; rollback publishes and runs nothing. A cancellation request is
durable state, while a worker that has already crossed an external boundary
must still report the true outcome.

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
