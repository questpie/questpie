# Beta.2 execution breadth

- Status: candidate; no authority projection before executable proof and fresh
  acceptance review
- Date: 2026-08-20
- Scope: Action, Route/Auth composition, Job, cron, and the removal of Workflow
  as a separate public Resource

## Product job

A real QUESTPIE backend must receive provider webhooks and auth callbacks, call
external systems, accept background work now or later, run recurring work, and
resume multi-step work after crashes. These jobs must reuse the accepted
Execution, Policy, Operation, durable, and PostgreSQL kernels rather than create
an Auth framework, Queue product, or second workflow engine.

## Existing authority

This candidate does not reopen decisions that are already sufficient:

- ADR-0015 already accepts Route as the raw Fetch escape hatch and accepts zero
  or one credential resolver that converts provider credentials into Principal.
  Auth schema, migrations, server object, native client, sessions, and UI remain
  application or ordinary Package code.
- ADR-0016 already accepts explicit and delayed Job acceptance, durable cron
  ticks, shared run/attempt/lease state, retry, cancellation, result, retention,
  executable pinning, and append-only events.
- ADR-0019 already fixes the public names `defineAction`, `defineRoute`, and
  `defineJob` and requires one shared durable and Fetch kernel.

The tree implements none of those executable kinds. Generated
`defineAction`, `defineRoute`, `defineJob`, and `defineWorkflow` are all
mapped to `EmptyDefinitionFactory`
(`packages/compiler/src/generate.ts:211`-`:216`, `:254`-`:256`, `:388`), and
the Runtime binding union
contains Query, Mutation, Reaction, Context, and Service only
(`packages/runtime/src/application/bindings.ts:19`-`:37`).

Two decisions remain genuinely open. Action has a reserved factory and design
evidence but no focused accepted runtime contract. Workflow is accepted as a
distinct Resource/factory by ADR-0016 and ADR-0019, while the owner now wants
its useful checkpoint semantics folded into Job.

## Decision

### Route and Auth

Implement ADR-0015 without a new Auth product.

- The compiler owns Route identity, literal method/path, overlap diagnostics,
  limits, Origin, handler binding, direct invocation, and mounting into the one
  generated `app.fetch`.
- Before `ctx.execution`, Route has Request/Response control, Principal,
  parameters, cancellation/deadline, and Route-safe Services. It has no data,
  Query, Mutation, raw database, transaction, or System capability.
- Zero credential resolvers means anonymous ingress. One resolver uses one
  explicit external application Service and returns resolved Principal,
  anonymous, or typed provider failure. It does not decide Tenant, Context,
  Policy, or Authority.
- Better Auth is the reference integration, not a compiler/runtime dependency.
  Its native server object, tables, migrations, endpoints, plugins, sessions,
  cookies, browser client, and UI remain userland. A reference Package may
  compose ordinary Service, credential-resolver, Collection, and Route
  Definitions without privileged ABI.
- A provider outage never silently becomes anonymous. Network and direct Route
  invocation use the same handler/lifetime kernel; direct invocation supplies
  Principal explicitly and never replays credentials.

### Action

Action owns one external or nondeterministic invocation.

- `defineAction` is application-specialized and owns exact name, input, output,
  declared errors, Policy, exposure, limits, Origin, and one handler.
- Action Context contains immutable Execution facts, cancellation/deadline,
  external-effect Services, and generated Query/Mutation callers. Each nested
  Query owns a new snapshot and each nested Mutation owns a new transaction.
- Action Context contains no `ctx.data`, raw database/transaction, dispatch,
  lease, checkpoint mutation, or System elevation.
- One Action invocation never retries automatically. Cancellation cannot prove
  an external system did not accept a request. Provider rejection and unknown
  outcome must map to distinct declared errors where the provider permits that
  distinction.
- Effect Identity is invocation metadata, not author-controlled domain input.
  A direct or browser caller supplies it explicitly; a Reaction or ordinary Job
  can derive it from stable durable identity; `step.action` derives and binds it
  from Job run plus ordered checkpoint name. The Action handler receives the
  exact identity as `effect.id`, and checkpoint authors cannot override it.
  QUESTPIE never claims the provider honored that identity and preserves
  explicit ambiguity when reliable receipt lookup is absent.
- Reaction's beta.1 callback-shaped effect adapter is a compatibility bridge,
  not a second public effect system. The Action slice must route authored
  external effects through generated Actions and narrow or internalize that
  callback surface.

### Job, cron, and checkpoints

QUESTPIE exposes one `Job` Resource over the accepted durable kernel. It does
not expose `Workflow`, `defineWorkflow`, a Workflow client, or a second
state-machine vocabulary.

- A Job can be accepted explicitly, after a delay, or by a durable cron
  schedule. Mutation acceptance joins the Mutation transaction. Other server
  acceptance uses a short dedicated transaction. Every acceptance has a scoped
  idempotency identity and returns a stable run receipt.
- Cron is a compiler-owned schedule attached to a Job, not an authored
  scheduler Resource. Each scheduled instant derives one stable tick identity;
  concurrent schedulers accept it once. Removing a schedule stops future ticks
  and never cancels an accepted run.
- An ordinary Job may perform all work in its handler. A Job that needs crash-
  resumable orchestration uses the same handler's closed checkpoint helper.
  There is no mode switch, second lease, second worker, or wrapper Runtime.
- The helper admits only named generated Mutation, named generated Action,
  durable sleep, and typed signal wait commands. It never accepts an arbitrary
  callback such as `step.run(async () => ...)`.
- Every checkpoint stores its ordered unique name and canonical command digest.
  Mutation commands retain stable Mutation Call Identity; Action commands
  retain stable Effect Identity plus receipt or explicit ambiguity. Code outside
  a checkpoint may be re-entered and owns no external effect or application
  write.
- Checkpoint-bearing Job histories pin Job identity, semantic version,
  executable digest, and observed command identities. Incompatible code refuses
  the run; latest-code replay is forbidden.
- Typed signals, cancellation, child work, compensation, continuation/history
  limits, and multi-version evolution remain explicit capability questions.
  Beta.2 must close signals, cancellation, history limits, and one rolling-
  version matrix. Child work and compensation may remain deferred if the
  absence is typed and documented.
- Browser code receives no generic Job controls. Applications expose selected
  request, status, cancel, and signal behavior through ordinary Policy-protected
  Query and Mutation Operations.

## Candidate authoring shape

The proof must compare this small surface against the existing separate
Workflow factory and against an optional mode/builder. The leading shape keeps
one Job handler and one durable helper:

```ts
export const publishArticle = defineJob({
	name: "articles.publish",
	version: 1,
	input: codec.object({ articleId: codec.uuid() }),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({ maximumAttempts: 8 }),
	signals: {
		approval: codec.object({ approvedBy: codec.uuid() }),
	},
	async handler({ input, ctx, run }) {
		await run.step.mutation(
			"request-review",
			ctx.mutations.articles.requestReview,
			{ articleId: input.articleId },
		);
		const approval = await run.step.waitForSignal("approval-gate", {
			signal: "approval",
			timeout: "30d",
		});
		return run.step.action("publish", ctx.actions.articles.publish, {
			articleId: input.articleId,
			approvedBy: approval.approvedBy,
		});
	},
});
```

The candidate chooses `version` on every Job so ordinary and checkpointed work
remain one Definition shape; an ordinary Job pays no checkpoint storage or
replay protocol merely because it has a semantic version. `signals` is an
optional closed structural map. Its keys contextually type `waitForSignal`,
while the checkpoint name remains a separate stable ordered identity. The
prototype proves this spelling is coherent, not that its authoring friction is
already measured. Compiler materialization of version 1 remains a permissible
implementation simplification if measurement shows a real cost without
weakening stored identity, digest, or version behavior.

## Compared interfaces

`alternatives-prototype.ts` compiles all three materially different KISS
surfaces. None is dismissed as impossible; the choice follows the product
boundary:

| Surface           | Resources/factories | Definition/handler shapes | Promotion from ordinary work                         |
| ----------------- | ------------------- | ------------------------- | ---------------------------------------------------- |
| one unified Job   | 1 / 1               | 1 / 1                     | start using the closed `step` helper                 |
| separate Workflow | 2 / 2               | 2 / 2                     | replace Resource, factory, projection, and handler   |
| explicit Job mode | 1 / 1               | 2 / 2                     | change the discriminant and contextual handler shape |

The separate Workflow shape is the incumbent and gives the strongest nominal
separation, but duplicates public identity and generated projection over the
same worker and durable state. The mode union correctly rejects mixed
combinations, but makes a capability increase into a Definition-shape change.
The unified Job keeps one meaning: accepted background work may use zero or
more closed durable commands. Runtime history, not an author-selected mode,
records whether checkpoints exist.

## Authority projection boundary

The executable scan discovers 43 current authority files containing the broad
word `Workflow`/`Workflows` or `defineWorkflow`. `PROJECTION.json` classifies 40
for post-PASS projection and three as ordinary lowercase process-language
exemptions: the schema workflow in the docs index, compiler workflow in the
data grammar, and repair workflow in schema lifecycle. A benign exemption is
rejected if its bytes contain a durable Workflow product marker. Accepted proof
artifacts and raw review records outside this current-authority universe remain
historical evidence; the later authority projection must supersede their
current conclusions without rewriting the reviewed bytes.

## Ownership

| Concern                            | Owner                                                 |
| ---------------------------------- | ----------------------------------------------------- |
| request bytes and response         | Route                                                 |
| credential verification            | application auth provider through credential resolver |
| caller identity                    | Principal produced at ingress                         |
| application scope                  | Context Resolution                                    |
| authorization                      | Policy                                                |
| one external invocation            | Action                                                |
| provider idempotency/receipt       | provider plus explicit Action contract                |
| durable acceptance and run         | Job/Reaction durable kernel                           |
| cron tick identity                 | PostgreSQL schedule state                             |
| checkpoint identity/history        | Job durable history projection                        |
| application writes in durable work | named Mutation checkpoint                             |
| external effects in durable work   | named Action checkpoint                               |
| observability                      | Execution Envelope and append-only durable events     |

## Design proof gate

Ratification requires one focused proof that:

1. compiles exact Action, ordinary Job, cron Job, and checkpointed Job
   declarations with negative capability tests;
2. executes one state model demonstrating ordinary completion without
   checkpoint history, crash/resume without a second Mutation write, explicit
   Action ambiguity and receipt recovery, cron tick deduplication and removal,
   and incompatible command-digest refusal;
3. keeps checkpoint name separate from typed signal name and admits no
   arbitrary callback checkpoint;
4. compiles and compares this one-Job surface with a separate Workflow Resource
   and an explicit Job mode/builder;
5. classifies every Workflow-bearing current-authority file and rejects both an
   omitted marker-invisible file and a false-benign product exemption; and
6. receives one fresh stateless Opus-medium `PASS` before ADR, glossary,
   public-doc, gate, and implementation-ticket projection.

The model proves that the contract is coherent; it does not claim that the
Runtime already implements it.

## Implementation acceptance gate

The resulting slices must still:

1. prove that a Job using zero checkpoints pays no second runtime or history
   protocol;
2. crash after real PostgreSQL Mutation and Action checkpoint boundaries and
   resume without duplicate application writes or blind external retry;
3. reject renamed, reordered, digest-changed, and semantic-version-incompatible
   checkpoint histories;
4. race cron tick acceptance across ten instances and prove one accepted run;
5. remove a schedule while preserving already accepted work;
6. drive early and duplicate signal delivery, wait, timeout, cancellation, and
   bounded history;
7. prove direct/network Action parity and preserve ADR-0015/P6 as the pinned
   Route/Auth prerequisite rather than restating it;
8. show generated client inclusion for network Actions and exclusion for Route
   and generic Job controls; and
9. measure declarations, TypeScript instantiations, PostgreSQL scenarios, load,
   and rolling compatibility.

## What would overturn this decision

- Keep a separate Workflow Resource only if the prototype shows one Job
  interface necessarily exposes invalid capability combinations or cannot
  preserve exact contextual typing without disproportionate complexity.
- Add core Auth only if two materially different auth providers cannot compose
  through Service + credential resolver + Route without duplicating authority
  or migration behavior.
- Add a separate cron/scheduler Resource only if more than one real scheduling
  owner is required; syntax preference is insufficient.
- Let Action retry only if the retry owner can prove stable Effect Identity,
  provider convergence, cancellation, and ambiguity without duplicating the
  durable kernel. Ordinary Action invocation does not meet that bar.
