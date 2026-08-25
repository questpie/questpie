# Collection DX and durable-work redesign

- Status: agreed design candidate; not acceptance authority
- Date: 2026-08-25
- Scope: Collection CRUD and lifecycle, Structural Query authoring, Query and
  Mutation projection, Policy across execution modes, and one Job primitive
- Supersession target: relevant public clauses of ADR-0011, ADR-0013,
  ADR-0016, ADR-0019, ADR-0022, and ADR-0026

This record consolidates the DX decisions reached while testing v4 against a
real Autopilot migration. It is the index for three focused records:

- [Collection, Query, lifecycle, and Policy](./COLLECTION-QUERY-POLICY-REDESIGN.md)
- [One Job primitive and named triggers](./JOB-TRIGGER-REDESIGN.md)
- [Whole-framework DX audit](./HOLISTIC-DX-AUDIT-2026-08-25.md)

It deliberately does not edit `SPEC.md`, `CONTEXT.md`, Accepted ADRs, public
documentation, or implementation gates. Those change together only after a
focused superseding proof and acceptance.

## Outcome

```text
Collection
  schema + relations + constraints
  canonical internal CRUD
  Policy + fixed lifecycle
  automatic Change Ledger facts

Structural Query
  reusable static read shape

Query / Mutation
  explicit application interface

Job
  explicit, delayed, scheduled, or change-triggered durable work
```

The target public model has no Collection Operation Set, automatic Collection
network exposure, public Reaction, Event Resource, Queue Resource, Scheduler
Resource, or Workflow Resource.

## Consolidated decisions

1. Every Collection always has one compiler-generated, Policy-aware internal
   CRUD kernel.
2. Generated `ctx.data.<collection>` capabilities do not depend on an authored
   public CRUD helper.
3. A named Mutation composes the same CRUD kernel and cannot bypass Policy,
   lifecycle, constraints, transaction ownership, or Change Ledger capture.
4. Collection does not define its client interface. Remove
   `defineCollectionOperations` and its Collection-operation `network` and
   string Field input lists; do not introduce the proposed Collection `api`
   block or Collection-level network flag.
5. Applications publish ordinary named Queries and Mutations. Operation-level
   `network` remains provisional exposure spelling.
6. Field provenance defines the possible create/update surface; Collection
   Policy decides per-Execution authority over that surface.
7. A Structural Query is a reusable static read value, not a Resource. It owns
   parameter codecs and selection once. One-use plans stay inline;
   pass-through Queries inherit input and output without an authored handler.
8. Policy is transport-neutral. HTTP, direct, nested, recompute, worker, cron,
   Studio, and tests use the same decision for equivalent Execution facts
   against the same relational snapshot.
9. Server location is not authority. Every Job attempt reconstructs a fresh
   run-as Execution and evaluates current Context and Policy.
10. Collection owns one fixed, unavoidable lifecycle. General hook registries,
    hook priorities, external effects in a transaction, and lossy callbacks are
    rejected.
11. Normalization should feel like ordinary TypeScript, but purity requires an
    enforceable compiler/evaluator seam rather than merely omitting Services.
    JavaScript lifecycle receives one PostgreSQL-derived transaction time;
    static SQL assignments may additionally use a database `now` operand.
12. Job is the target one public durable-work Resource. Remove
    `defineReaction` and Reaction dispatch only after Job gains the committed
    causation/effect guarantees, replacement tracer, and rolling compatibility
    bridge. Do not introduce an Event-plus-Job relay meanwhile.
13. A Job may be accepted explicitly, transactionally, after a delay, by cron,
    or later by a Collection change trigger.
14. One Job may own multiple stable named trigger slots. Every trigger produces
    the same one Job input type; it does not create a union handler input.
15. Trigger-specific idempotency and causation are compiler-owned. Retry keeps
    the same Durable Run.
16. Route owns webhook protocol and accepts a Job after verification. A webhook
    is not a native Job trigger.
17. Mutation never directly publishes to an external broker. It transactionally
    accepts a Job; a Job Action checkpoint crosses the broker seam after commit.
18. PostgreSQL remains durable authority. `LISTEN/NOTIFY` and brokers may only
    accelerate or integrate without becoming correctness authority.

## Public concept budget

The target executable family is:

```ts
import {
	defineQuery,
	defineMutation,
	defineAction,
	defineRoute,
	defineJob,
} from "#questpie/app";
```

Structural schema, codecs, Collection builders, and Policy helpers remain
ordinary imports from `questpie`. There is no public import for
`lifecycle.fact`, `defineCollectionOperations`, `defineReaction`,
`defineEvent`, Workflow, Queue, or Scheduler.

## Invariants retained unchanged

- PostgreSQL durable truth and lossy wake separation;
- deterministic static composition and exact Resource identity;
- generated App Contract as the exact whole-application type source;
- Policy as the sole authored authorization model;
- Query snapshot and Mutation transaction ownership;
- stable Mutation Call Identity and result receipts;
- Change Ledger capture and reconciliation;
- one durable run/attempt/lease/fence/checkpoint kernel;
- Action Effect Identity and explicit ambiguity;
- application-composed credentials and provider-agnostic Auth;
- no raw SQL, ambient System elevation, or generic browser Job controls.

## Open details

- exact lifecycle phase and Field provenance spellings;
- nested filters, Relation loading, pagination, and to-many bounds;
- possible Operation-level `network` rename;
- exact Job acceptance, delay, trigger, matcher, and run-as spellings;
- bulk-write, delete, and soft-delete trigger semantics;
- Job fan-out, child work, and compensation;
- complete output-codec inference;
- custom scalar, storage, operator, index, PostGIS, full-text, and pgvector
  Package seams.

These details must preserve the smaller mental model or prove that another
concept earns its interface cost.

## Adversarial corrections

The first independent read-only reviews found acceptance blockers in the
current implementation and in earlier examples:

- generated Query declarations advertise Collection `get`, while Runtime Query
  projection currently exposes neither that member nor a real generated
  `data.run` implementation;
- multiple reads in one Query currently open separate read-only transactions,
  so the accepted one-snapshot guarantee is not yet realized;
- removing Collection Operation Sets currently removes the only producer of
  Mutation Collection plans; automatic CRUD is a new kernel, not a rename;
- authored `update`, `delete`, and `list` Collection Operation members receive
  types and Resource identities but are silently excluded from PostgreSQL
  lowering; unsupported members need a diagnostic or real plans;
- the first Job slice can persist a `ready` Job, but the worker admission digest
  set contains only Reactions, so the run receives no worker outcome;
- a Job-only application emits `durable-kernel.json` while leaving
  `durableCompatibilityDigest` null and therefore fails Runtime artifact decode;
- one Mutation currently admits only one durable intent and generated Job
  `dispatch(input)` has no public idempotency key or delay contract;
- arbitrary trigger and lifecycle callbacks cannot claim deterministic purity;
- raw Route already exposes `ctx.execution`; Job acceptance belongs on the
  resulting Execution view rather than the raw Route view;
- protocol v7 has a checksum-gated migration, but its in-place table/column
  renames are not a dual-name rolling bridge. It needs a proven compatibility
  strategy or an explicit non-rolling cutover;
- realtime recompute and the v3 Channel jobs it must replace remain a separate
  migration gap and need a later tracer rather than being implied by Query DX.

These are repair requirements, not reasons to restore the rejected public
concepts.

## Delivery and supersession sequence

1. Repair the Job-only artifact digest mismatch and rerun fresh Standards and
   Spec reviews against the exact repaired boundary.
2. Stop public ossification of the current one-slot `dispatch(input)` Job
   projection. Finish one coherent ordinary Job vertical: `accept`, explicit
   and Mutation-owned multi-key identity, delay, worker execution, settlement,
   retry, cancellation, and recovery.
3. Repair generated/runtime capability parity and make one Query root own one
   read-only repeatable-read transaction across all its plans.
4. Prove automatic internal CRUD, Field provenance, fixed lifecycle, and
   explicit named Operation exposure in focused Kernel slices.
5. Prove pass-through Query inference from closed parameterized Structural
   Queries and static selections.
6. Add cron with stable trigger epochs and explicit run-as recipes.
7. Replace the collaboration Reaction with accepted and executed Job work;
   retain legacy Reaction execution until nonterminal runs drain or expire.
8. Defer Collection triggers until lifecycle, bulk-write, deletion,
   nondisclosure, and exact captured-fact semantics close.
9. Build one substantial reference application with CRUD, joined Query,
   lock/CAS Mutation, Route, Action, Job, Policy, lifecycle, restart recovery,
   and generated client usage. Treat every workaround as framework evidence,
   not application precedent.
10. Use that application for one concentrated whole-framework DX pass, then
    port the same representative slices into Autopilot and measure deletion,
    types, SQL, Policy behavior, and migration complexity.
11. Close the realtime/Channel migration gap with its own tracer.
12. Run Standards, Spec, and formal acceptance review, then update `SPEC.md`,
    `CONTEXT.md`, ADRs, public docs, gates, and handoff together.

Workflow orchestration is deliberately outside this sequence. QUESTPIE must
emit deterministic contracts, diagnostics, generated types, and runnable gates
that an agent can consume, but it does not own swarm scheduling, session
recovery, review routing, or autonomous delivery policy. Those belong to the
Autopilot product and may later drive QUESTPIE development through the same
ordinary repository interfaces used by a human.

The proof must cover direct/network/nested/worker parity, nondisclosure,
rollback and response-loss windows, crash recovery, duplicate trigger races,
rolling compatible builds, TypeScript negatives, and package relocation.
