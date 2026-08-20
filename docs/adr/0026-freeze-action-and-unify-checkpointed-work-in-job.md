# ADR 0026: Freeze Action and Unify Checkpointed Work in Job

- Status: Accepted
- Date: 2026-08-21

## Context

ADR-0015 already owns raw Route ingress and application-composed credential
resolution without a framework Auth product. ADR-0016 and ADR-0019 accepted one
PostgreSQL durable kernel but projected ordinary background work as `Job` and
checkpointed work as a second `Workflow` Resource and `defineWorkflow` factory.
Action had a reserved factory and design evidence but no focused accepted
runtime contract.

Job and Workflow did not own different runtime truth. Both used the same run,
attempt, lease, retry, cancellation, schedule, timer, signal, history, result,
retention, and executable-compatibility state. Keeping two Resources made an
ordinary Job change public identity, generated projection, Definition shape,
and handler shape merely because it began using a durable checkpoint.

## Decision

QUESTPIE freezes Action and exposes one Job Resource for ordinary, scheduled,
and checkpointed background work.

### Route and Auth remain composed

- ADR-0015 remains unchanged: zero or one application credential resolver
  produces Principal through an explicit Service. Context Resolution derives
  application scope and Policy authorizes.
- Better Auth or another provider remains ordinary application or Package
  composition through Service, credential resolver, Collection, and Route.
  QUESTPIE owns no Auth schema, migrations, server, session, client, or UI.

### Action owns one external invocation

- `defineAction` owns exact input, inferred output with an optional output pin,
  declared errors, Policy, exposure, limits, Origin, cancellation, and explicit
  ambiguous outcome.
- Action Context has immutable Execution facts, external-effect Services, and
  generated Query and Mutation callers. It has no data or transaction facade,
  raw database, durable run/checkpoint control, or System elevation.
- Ordinary Action invocation never retries automatically. Provider rejection
  and an unknowable outcome remain distinct declared errors where the provider
  permits the distinction.
- Effect Identity is invocation metadata, not trusted domain input. A direct
  invocation supplies explicit stable idempotency material; Runtime scopes the
  internal identity to the Action and caller context. Reaction or Job derives
  it from durable identity. A Job Action checkpoint binds it from Job run plus
  ordered checkpoint name and exposes that exact identity to the Action
  handler. Application input cannot replace the stored identity.
- QUESTPIE does not claim a provider honored idempotency. Without reliable
  receipt lookup, an external outcome may remain ambiguous.

### One Job owns checkpoint orchestration

- QUESTPIE exposes `defineJob` and no Workflow Resource, `defineWorkflow`,
  Workflow client, compatibility alias, or second workflow runtime.
- Job, Reaction, and their internal projections retain one PostgreSQL durable
  run/attempt/lease kernel. Reaction remains a distinct committed-fact Resource
  accepted by ADR-0013; this decision does not rename or remove it.
- A Job may be accepted explicitly, transactionally from a Mutation, after a
  delay, or from a compiler-owned durable cron schedule. Every scheduled
  instant has one stable tick identity. Removing a schedule stops future ticks
  and preserves accepted runs.
- An ordinary Job may use no checkpoints and then creates no checkpoint
  history. The same handler can use a closed `step` helper without changing
  Resource, factory, worker, lease, or Definition mode.
- The helper admits only named generated Mutation, named generated Action,
  durable sleep, and typed signal wait. It never admits an arbitrary callback.
  Checkpoint name is a stable ordered identity distinct from signal name.
- Checkpoint history retains Job identity, semantic version, executable digest,
  ordered checkpoint name, canonical command digest, stable Mutation Call
  Identity, and stable Action Effect Identity plus receipt or explicit
  ambiguity. Incompatible code refuses claim; latest-code replay is forbidden.
- Every Job has a stored semantic version. The compiler may materialize version
  1 when the author omits it; this must not weaken compatibility records.
- Browser code receives no generic Job controls. Applications expose selected
  request, status, cancel, and signal behavior through ordinary
  Policy-protected Query and Mutation Operations.

## Supersession

This ADR supersedes only the separate Workflow projection of ADR-0016,
ADR-0019, ADR-0022, and current specification, glossary, capability-map,
product, gate, public-documentation, design-fiction, visual, research-wayfinder,
and beta planning surfaces. Their pinned proofs and review records remain
immutable historical evidence.

The shared durable semantics accepted by ADR-0016 remain current; they now
belong to Job checkpoints. ADR-0013 Reaction and ADR-0015 Route/Auth composition
remain current.

## Consequences

- The public executable family loses `defineWorkflow`; `defineJob` gains the
  closed checkpoint projection.
- Cron is a Job schedule, not another Resource or scheduler abstraction.
- Promoting background work to durable multi-step orchestration does not change
  its public identity or handler shape.
- Implementation still must prove PostgreSQL crash windows, ten-instance cron
  races, signal authorization/deduplication, cancellation, bounded history,
  direct/network Action parity, client boundaries, rolling compatibility, and
  declaration/load budgets.
- Child work and compensation remain absent until a focused proof shows they
  belong in the closed Job checkpoint language.

## Rejected alternatives

- Keep Workflow as a second Resource and generated factory over the same
  durable kernel.
- Add an explicit ordinary/checkpointed Job mode or builder with two Definition
  and handler shapes.
- Add a generic `step.run(async () => ...)` callback.
- Add a core Auth product or provider registry.
- Add a separate Cron, Queue, or Scheduler Definition.

## Acceptance

The candidate at `fe05d61c4fec878cc72d19c9254ab098f48531dc` received a
fresh stateless Opus-medium `PASS` after two preserved `BLOCKED` repair rounds.
The verified acceptance record is committed at `173db46e` in
[`beta2-execution-breadth/REVIEW-03.json`](../v4/prototypes/beta2-execution-breadth/REVIEW-03.json).
