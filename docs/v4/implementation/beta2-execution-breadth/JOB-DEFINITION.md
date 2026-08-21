# Job Definition and projection boundary

- Status: implementation recommendation; not acceptance authority
- Date: 2026-08-21
- Authority: ADR-0016 as superseded by ADR-0026, the accepted beta.2 execution-
  breadth proof, and the EB-04 through EB-08 implementation queue
- Scope: the smallest coherent `defineJob` member set, normalized contract, and
  generated handler projection
- Non-goals: changing an ADR, selecting cron/DST semantics, publishing signals,
  adding child work or compensation, or defining a browser Job client

## Outcome

Implement one Job Definition and one handler shape. The recommended authored
member set is:

```ts
defineJob({
	name,
	version?,
	input,
	output,
	runAs,
	retry,
	errors?,
	signals?,
	schedule?,
	handler,
});
```

The compiler materializes omitted `version` as `1`; `output`, `runAs`, and
`retry` remain required. `errors`, `signals`, and `schedule` normalize to empty
or absent values without creating another Definition mode. The Definition has
no `policy`, `network`, `effects`, `idempotency`, `mode`, `steps`, Queue, or
Workflow member.

This is the narrow recommendation to prove, not a claim that all spellings are
already Accepted. ADR-0026 fixes one Job Resource, the closed checkpoint
language, stored semantic version, cron ownership, and the absence of generic
browser control. It explicitly permits compiler materialization of version 1
([ADR-0026:55-80](../../../adr/0026-freeze-action-and-unify-checkpointed-work-in-job.md)).
It does not pin every factory member.

## Why a reconciliation is required

The accepted records agree on ownership but expose three incompatible member
sets:

- the compile-only prototype requires authored `version`, allows optional
  `output`, `signals`, and `schedule`, and omits `runAs`, `retry`, and `errors`
  ([type-prototype.ts:176-229](../../prototypes/beta2-execution-breadth/type-prototype.ts));
- the accepted decision's example adds `runAs` and `retry`, and says version 1
  may instead be compiler-materialized
  ([DECISION.md:133-175](../../prototypes/beta2-execution-breadth/DECISION.md));
- the public lifecycle page is explicitly provisional, uses `runAs` and
  `retry`, omits both `version` and `output`, and requires a stable run receipt
  from acceptance
  ([lifecycle-jobs-and-shared-durable-kernel.md:45-73](../../lifecycle-jobs-and-shared-durable-kernel.md)).

The prototype also exposes callable generated Mutations and Actions directly on
`JobContext` ([type-prototype.ts:169-174](../../prototypes/beta2-execution-breadth/type-prototype.ts)),
while the accepted decision says code outside a checkpoint owns no application
write or external effect
([DECISION.md:110-123](../../prototypes/beta2-execution-breadth/DECISION.md)).
Those claims cannot both be enforced if the members are ordinary callable
Operation functions.

## Fixed behavior versus provisional spelling

| Concern                       | Status                                                 | Narrow resolution                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource identity             | **Fixed**                                              | One `job:<qualified-name>` Resource and one `defineJob`; no Workflow alias, mode, builder, or second runtime.                                                                      |
| `name` and `handler`          | **Fixed**                                              | One exact name and one inline handler/executable slot. Promoting work to checkpoints does not replace either.                                                                      |
| `input`                       | **Fixed**                                              | Required runtime codec. Durable payload bytes must be decoded through the compiled contract.                                                                                       |
| semantic version              | **Fixed behavior; provisional authored spelling**      | Store a positive integer on every run. Recommend `version?: number`, normalized to `1`; omitted and explicit `1` produce identical normalized bytes.                               |
| `output`                      | **Fixed validation need; provisional spelling**        | Require a runtime codec in the first production tracer. Optional output is deferred until a proof can materialize an exact runtime codec rather than infer only a TypeScript type. |
| `runAs`                       | **Fixed behavior; recommended existing spelling**      | Require the existing `DurableRunAsDefinition`. Every attempt reconstructs a fresh run-as Execution; no worker authority default.                                                   |
| `retry`                       | **Fixed behavior; recommended existing spelling**      | Require the existing bounded `DurableRetryDefinition`; do not invent Job-only retry syntax or implicit unbounded defaults.                                                         |
| `errors`                      | **Provisional**                                        | Optional closed declared-error map normalized to `{}`. A proof must distinguish permanent declared failure from retryable infrastructure/handler failure before publication.       |
| `signals`                     | **Fixed closed capability; provisional until EB-08**   | Optional codec map normalized in ASCII key order. It types signal references but publishes no signal ingress before authorization, deduplication, bounds, and restart cases pass.  |
| `schedule`                    | **Fixed owner; provisional value grammar until EB-05** | Optional `{ cron, timeZone }` attached to Job. Cron/DST/missed-tick semantics require their own proof; no Scheduler Resource is introduced.                                        |
| Definition-level `policy`     | **Absent**                                             | Job has no browser producer. Applications expose chosen request/status/cancel/signal behavior through Policy-protected Query and Mutation Operations.                              |
| Definition-level idempotency  | **Absent**                                             | Idempotency material belongs to each acceptance call or stable schedule tick, not to the reusable Job Definition.                                                                  |
| arbitrary checkpoint callback | **Absent**                                             | Only named generated Mutation, named generated Action, durable sleep, and typed signal wait are admitted.                                                                          |

Reusing `runAs`, `retry`, and the declared-error vocabulary is a deepening of
the existing durable seam, not a second Job language. The executed Reaction
factory already requires exact input/output codecs, run-as, retry, and supports
an optional declared-error map
([reaction/declarations.ts:97-129](../../../../packages/compiler/src/reaction/declarations.ts)).
Its normalizer already produces canonical declared errors, run-as, retry, and
one handler slot
([reaction/index.ts:119-165](../../../../packages/compiler/src/reaction/index.ts)).
Job and Reaction still retain distinct causes and Context projections.

## Recommended public projection

The target generated shape is conceptually:

```ts
type JobDefinition<Name, Input, Output, Errors, Signals> = Readonly<{
	readonly kind: "job";
	readonly identity: `job:${Name & string}`;
	readonly name: Name;
	readonly version: number;
	readonly input: Codec<Input>;
	readonly output: Codec<Output>;
	readonly runAs: DurableRunAsDefinition;
	readonly retry: DurableRetryDefinition;
	readonly errors: Errors;
	readonly signals: Signals;
	readonly schedule: Readonly<{ cron: string; timeZone: string }> | null;
	readonly handler: JobHandler<Name, Errors, Signals>;
}>;
```

The authored factory makes `version`, `errors`, `signals`, and `schedule`
optional only where the normalizer has one canonical materialization. The
returned Definition is total: it always contains version 1 or the authored
version, an empty error map, an empty signal map, and `schedule: null`.

The handler receives:

- immutable Principal, Authority, Tenant, values, signal, and deadline from one
  fresh Execution;
- generated Query callers, because repeating a read does not manufacture a
  business write;
- `run.id`, `run.scheduledFor`, and the closed `run.step` projection;
- attempt number and cooperative heartbeat;
- declared error factories.

It receives no Service bag, raw database, transaction/data facade, System
elevation, Queue/lease mutation, or generic browser controls. Generated
Mutation and Action members inside a Job are **command references**, not
directly callable functions. They become executable only when passed to
`run.step.mutation` or `run.step.action`. That keeps the accepted syntax such as
`run.step.mutation("request-review", ctx.mutations.articles.requestReview,
input)` while making the stated no-write/no-effect-outside-checkpoint boundary
type-falsifiable.

This command-reference restriction is provisional. ADR-0026 fixes which
checkpoint commands exist but not how their generated references are spelled
([ADR-0026:66-75](../../../adr/0026-freeze-action-and-unify-checkpointed-work-in-job.md)).
It must pass the type proof below before projection. If ordinary Jobs need a
non-checkpointed write or external effect, the replacement proposal must name
its stable Mutation Call Identity or Effect Identity and its crash window; a
plain callable member is insufficient.

## Recommended normalized contract

The compiler-owned normalized record should be exact and total:

```ts
{
	format: "questpie.job-definition-contract",
	version: 1,
	name,
	semanticVersion,
	input,
	output,
	declaredErrors,
	runAs,
	retry,
	signals,
	schedule,
	executableSlots: ["handler"],
}
```

Rules:

1. reject every unknown authored member;
2. normalize omitted semantic version to `1`, then require a positive safe
   integer;
3. normalize input, output, error payloads, and signal payloads through the one
   codec contract producer;
4. canonicalize signal keys by ASCII order and reject duplicates or invalid
   Resource/member names at their authored Origin;
5. normalize omitted errors/signals to empty records and schedule to `null`;
6. include semantic version, signal codecs, schedule bytes, and handler contract
   in the executable/contract digest;
7. keep acceptance idempotency keys and schedule tick identities out of the
   Definition contract; they are runtime facts;
8. emit no browser-client Job member.

EB-04 may exercise the same total contract with empty signals and a null
schedule. EB-05 drives schedule execution. EB-06 and EB-07 drive Mutation and
Action command references. EB-08 is the first slice allowed to publish signal
ingress. This preserves one Definition shape without claiming later runtime
paths early. The slice order and required crash/ten-instance cases are already
recorded in [README.md:146-253](./README.md).

## Hostile type and projection proof

The focused proof must compile real generated declarations, not a hand-written
lookalike, and include these positive and negative controls:

| Case                                                                                                            | Required result                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| minimal ordinary Job with required output/run-as/retry                                                          | compiles; normalizes to version 1, empty errors/signals, null schedule                        |
| same Job with explicit `version: 1`                                                                             | produces the same normalized contract and digest                                              |
| explicit positive version greater than 1                                                                        | compiles and changes semantic-version compatibility bytes                                     |
| missing `output`                                                                                                | fails at the authored Definition until executable output-codec inference is separately proved |
| zero, negative, fractional, or unsafe version                                                                   | fails at the exact version member                                                             |
| unknown `mode`, `workflow`, `steps`, `policy`, `network`, `effects`, or `idempotency` member                    | fails as outside the Job contract                                                             |
| ordinary handler calls a generated Mutation or Action reference directly                                        | TypeScript failure; the reference is not callable                                             |
| named Mutation/Action reference passed through the matching `run.step` command                                  | compiles with exact input/output inference                                                    |
| Mutation reference passed to `step.action`, or Action reference to `step.mutation`                              | TypeScript failure                                                                            |
| arbitrary `step.run`, callback command, Query checkpoint, child Job, or compensation                            | absent member/type failure                                                                    |
| undeclared signal or wrong signal payload                                                                       | TypeScript failure at the signal name or payload                                              |
| checkpoint name reused, reordered, renamed, or paired with changed command/input digest                         | runtime compatibility refusal, not latest-code replay                                         |
| domain input field named `effectKey` attempts to replace checkpoint Effect Identity                             | TypeScript/runtime refusal; identity remains run plus ordered checkpoint name                 |
| handler reaches Services, raw data/transaction/database, System elevation, lease mutation, Request, or Response | absent member/type failure                                                                    |
| generated browser client attempts Job dispatch/status/cancel/signal                                             | absent member/type failure                                                                    |
| Package Job refers to an application-only Query/Mutation/Action                                                 | Package-isolation diagnostic                                                                  |
| omitted file/relocated source changes Origin or binding pointer                                                 | projection or binding verification failure, never ambient lookup                              |

The proof also measures declaration bytes, TypeScript instantiations, and
completion members for an ordinary Job and a Job with the maximum accepted
signal/command surface. A green marker scan is not type evidence: at least one
known-positive generated Job must compile, and every negative must fail for its
intended diagnostic.

## What remains deliberately open

- The exact Job acceptance caller spelling, delay spelling, stable receipt type,
  and scoped idempotency option need a separate direct/Mutation acceptance
  proof. The public lifecycle page specifies their behavior, not an exact
  generated method signature
  ([lifecycle-jobs-and-shared-durable-kernel.md:69-73](../../lifecycle-jobs-and-shared-durable-kernel.md)).
- Cron grammar, IANA time-zone validation, DST gap/overlap behavior, missed-tick
  catch-up, and catch-up bounds belong to EB-05. Its fixed invariants are one
  stable tick per scheduled instant, ten-instance convergence, and removal that
  preserves accepted work ([README.md:172-191](./README.md)).
- Signal authorization, deduplication, wrong-codec/late delivery, restart,
  cancellation, and history bounds belong to EB-08
  ([README.md:237-253](./README.md)).
- Output inference may replace required `output` only when the compiler can
  materialize and validate the exact runtime codec. Inferring a TypeScript type
  alone is not enough for persisted result bytes.
- Declared Job errors remain provisional until the worker proof fixes which
  classes are permanent, retryable, or terminal without copying Reaction-
  specific error codes.

## What would overturn this recommendation

- Make authored `version` required if declaration/editor measurements show that
  omission hides meaningful compatibility changes, or if omitted and explicit
  version 1 cannot produce identical stored/digest bytes.
- Make `output` optional only after executable evidence materializes an exact
  runtime codec for every accepted inference case and rejects unsupported cases
  at the authored Origin.
- Replace command references with callable generated Operations only if a proof
  gives every out-of-checkpoint Mutation and Action a stable stored logical
  identity, closes the commit/provider response-loss window, and preserves the
  claim that re-entered code owns no write or effect.
- Add Definition-level Policy only if a Job gains an independent untrusted
  producer that cannot be represented by an ordinary Policy-protected Query or
  Mutation. Worker placement or a browser convenience is not such a producer.
- Split Workflow back out only if one Job interface necessarily exposes invalid
  combinations or cannot preserve exact contextual typing without
  disproportionate declaration/runtime complexity. Shared durable state or
  syntax preference alone does not meet that bar.
- Add child work, compensation, or a generic callback only after a focused proof
  gives it bounded history, cancellation, identity, compatibility, and crash-
  recovery semantics inside the closed Job language.
